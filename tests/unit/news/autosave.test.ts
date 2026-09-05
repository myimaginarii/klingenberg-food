import { describe, expect, it } from 'vitest'

import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_IDLE,
  autosaveNext,
  autosaveSnapshot,
  autosaveStatusLine,
  type AutosaveEvent,
  type AutosavePhase,
} from '@/lib/news/autosave'

/**
 * The autosave machine — phase 9B. Every property the phase brief demands is an
 * assertion here: debounce restarts on typing, unchanged content is not saved, one
 * save is in flight at a time, a response that is not the in-flight save's decides
 * nothing, a conflict stops the machine without hiding, and "Gemt" is only said
 * about a confirmed save.
 */

function run(events: AutosaveEvent[], from: AutosavePhase = AUTOSAVE_IDLE) {
  const commands: string[] = []
  let state = from

  for (const event of events) {
    const step = autosaveNext(state, event)
    state = step.state
    commands.push(step.command)
  }

  return { state, commands }
}

describe('debounce', () => {
  it('waits for the person to stop rather than saving per keystroke', () => {
    const { state, commands } = run([
      { kind: 'redigeret' },
      { kind: 'redigeret' },
      { kind: 'redigeret' },
    ])

    expect(commands).toEqual(['planlaeg', 'planlaeg', 'planlaeg'])
    expect(state).toEqual({ kind: 'venter' })
  })

  it('saves once when the timer fires on changed content', () => {
    const { state, commands } = run([{ kind: 'redigeret' }, { kind: 'tid', aendret: true }])

    expect(commands).toEqual(['planlaeg', 'gem'])
    expect(state).toEqual({ kind: 'gemmer', redigeretUndervejs: false })
  })

  it('does not save unchanged content — the no-op rule', () => {
    const { state, commands } = run([{ kind: 'redigeret' }, { kind: 'tid', aendret: false }])

    expect(commands).toEqual(['planlaeg', 'ingen'])
    expect(state).toEqual({ kind: 'hvile' })
  })

  it('ignores a timer that no state planned — a cancelled debounce decides nothing', () => {
    expect(run([{ kind: 'tid', aendret: true }]).commands).toEqual(['ingen'])
  })

  it('keeps a debounce interval a person can outtype', () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(1000)
  })
})

describe('one save in flight', () => {
  it('never issues a second save while one runs; edits mark the run instead', () => {
    const { state, commands } = run([
      { kind: 'redigeret' },
      { kind: 'tid', aendret: true },
      { kind: 'redigeret' },
      { kind: 'redigeret' },
    ])

    expect(commands).toEqual(['planlaeg', 'gem', 'ingen', 'ingen'])
    expect(state).toEqual({ kind: 'gemmer', redigeretUndervejs: true })
  })

  it('reschedules after the response when edits arrived during the save', () => {
    const { state, commands } = run([
      { kind: 'redigeret' },
      { kind: 'tid', aendret: true },
      { kind: 'redigeret' },
      { kind: 'svar', resultat: 'gemt' },
    ])

    // The older response versions the next attempt but never claims the newer
    // edits were saved: the machine goes back to waiting, not to "Gemt".
    expect(commands[3]).toBe('planlaeg')
    expect(state).toEqual({ kind: 'venter' })
  })

  it('a response with no save in flight decides nothing — the stale-response rule', () => {
    const settled = run([{ kind: 'redigeret' }, { kind: 'tid', aendret: true }, { kind: 'svar', resultat: 'gemt' }])
    expect(settled.state).toEqual({ kind: 'gemt', live: false })

    const stale = autosaveNext(settled.state, { kind: 'svar', resultat: 'fejl' })
    expect(stale.state).toEqual(settled.state)
    expect(stale.command).toBe('ingen')
  })
})

describe('outcomes', () => {
  const saving: AutosavePhase = { kind: 'gemmer', redigeretUndervejs: false }

  it('says Gemt only for a confirmed save, and says live truthfully', () => {
    expect(autosaveNext(saving, { kind: 'svar', resultat: 'gemt' }).state).toEqual({
      kind: 'gemt',
      live: false,
    })
    expect(autosaveNext(saving, { kind: 'svar', resultat: 'gemt_live' }).state).toEqual({
      kind: 'gemt',
      live: true,
    })
  })

  it('a conflict stops the machine, and later edits do not restart it', () => {
    const conflicted = autosaveNext(saving, { kind: 'svar', resultat: 'konflikt' })
    expect(conflicted.state).toEqual({ kind: 'konflikt' })

    const after = autosaveNext(conflicted.state, { kind: 'redigeret' })
    expect(after.state).toEqual({ kind: 'konflikt' })
    expect(after.command).toBe('ingen')
  })

  it('a vanished article stops the machine the same way', () => {
    const gone = autosaveNext(saving, { kind: 'svar', resultat: 'vaek' })
    expect(gone.state).toEqual({ kind: 'vaek' })
    expect(autosaveNext(gone.state, { kind: 'redigeret' }).command).toBe('ingen')
  })

  it('a failure or incomplete form does not stop the machine — the next edit retries', () => {
    const failed = autosaveNext(saving, { kind: 'svar', resultat: 'fejl' })
    expect(failed.state).toEqual({ kind: 'fejl' })
    expect(autosaveNext(failed.state, { kind: 'redigeret' }).command).toBe('planlaeg')

    const invalid = autosaveNext(saving, { kind: 'svar', resultat: 'ugyldig' })
    expect(invalid.state).toEqual({ kind: 'ufuldstaendig' })
    expect(autosaveNext(invalid.state, { kind: 'redigeret' }).command).toBe('planlaeg')
  })
})

describe('the status line', () => {
  it('says 1s’s words for a saved draft, and the honest version for a live save', () => {
    expect(autosaveStatusLine({ kind: 'gemt', live: false })?.text).toBe('Gemt for lidt siden')
    expect(autosaveStatusLine({ kind: 'gemt', live: true })?.text).toContain('på hjemmesiden')
  })

  it('never hides a conflict, and tells the person their text is theirs to keep', () => {
    const line = autosaveStatusLine({ kind: 'konflikt' })

    expect(line?.tone).toBe('alert')
    expect(line?.text).toContain('Nogen andre har rettet')
    expect(line?.text).toContain('ikke gemt')
  })

  it('marks problems as alert and bookkeeping as quiet — never colour alone', () => {
    expect(autosaveStatusLine({ kind: 'fejl' })?.tone).toBe('alert')
    expect(autosaveStatusLine({ kind: 'vaek' })?.tone).toBe('alert')
    expect(autosaveStatusLine({ kind: 'gemmer', redigeretUndervejs: false })?.tone).toBe('quiet')
    expect(autosaveStatusLine({ kind: 'hvile' })).toBeNull()
  })
})

describe('the snapshot', () => {
  it('is equal exactly when every field is equal', () => {
    const fields = { title: 'A', displayDate: '2026-09-01', category: 'Lukket', body: '{"a":1}' }

    expect(autosaveSnapshot(fields)).toBe(autosaveSnapshot({ ...fields }))
    expect(autosaveSnapshot(fields)).not.toBe(autosaveSnapshot({ ...fields, title: 'B' }))
  })

  it('cannot be fooled by content shifting between fields', () => {
    expect(autosaveSnapshot({ title: 'AB', displayDate: '', category: '', body: '' })).not.toBe(
      autosaveSnapshot({ title: 'A', displayDate: 'B', category: '', body: '' }),
    )
  })
})

describe('the limiter refusal (phase 13B)', () => {
  const saving: AutosavePhase = { kind: 'gemmer', redigeretUndervejs: false }

  it('is a refusal, not a failure and not a stop: the text stays and the next edit tries again', () => {
    const refused = autosaveNext(saving, { kind: 'svar', resultat: 'for_mange' })
    expect(refused.state).toEqual({ kind: 'for_mange' })
    expect(refused.command).toBe('ingen')

    const edited = autosaveNext(refused.state, { kind: 'redigeret' })
    expect(edited.state).toEqual({ kind: 'venter' })
    expect(edited.command).toBe('planlaeg')
  })

  it('goes straight back to waiting when the person kept typing during the refused save', () => {
    const dirty: AutosavePhase = { kind: 'gemmer', redigeretUndervejs: true }
    const refused = autosaveNext(dirty, { kind: 'svar', resultat: 'for_mange' })
    expect(refused.state).toEqual({ kind: 'venter' })
    expect(refused.command).toBe('planlaeg')
  })

  it('says so as an alert, without a count or a window, and promises the text is kept', () => {
    const line = autosaveStatusLine({ kind: 'for_mange' })
    expect(line?.tone).toBe('alert')
    expect(line?.text).toContain('Dine ændringer er stadig her')
    expect(line?.text).not.toMatch(/\d/)
  })

  it('recovers after the window: a later successful save is reported as saved', () => {
    const { state } = run(
      [
        { kind: 'svar', resultat: 'for_mange' },
        { kind: 'redigeret' },
        { kind: 'tid', aendret: true },
        { kind: 'svar', resultat: 'gemt' },
      ],
      saving,
    )
    expect(state).toEqual({ kind: 'gemt', live: false })
  })
})
