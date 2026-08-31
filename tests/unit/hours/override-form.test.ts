import { describe, expect, it } from 'vitest'

import {
  encodeOverrideEcho,
  OVERRIDE_ERROR_FIELD,
  OVERRIDE_FORM,
  OVERRIDE_ROW_FORM,
  readOverrideForm,
  readOverrideVersionDate,
} from '@/app/(admin)/admin/aabningstider/override-forms'
import {
  decodeOverrideProblems,
  describeOverrideContent,
  describeOverrideDay,
  describeOverridePending,
  describeOverrideRemoval,
  describeOverrideState,
  emptyOverrideForm,
  isOverrideKind,
  OVERRIDE_CONTENT_FIELDS,
  OVERRIDE_ERROR_MESSAGES,
  OVERRIDE_KIND_LABELS,
  OVERRIDE_KINDS,
  overrideContentEqual,
  overrideDraftWrite,
  overrideErrorField,
  overrideErrorFor,
  overrideFormValues,
  overrideIsPending,
  overrideLifecycle,
  overrideStateBadge,
  toOverrideDraft,
  type OverrideContent,
  type OverrideFormValues,
} from '@/lib/hours/override-form'
import { openingHoursOverrideDraft } from '@/lib/schemas/opening-hours'

/**
 * The one-off opening-hours override's domain — phase 8B; §4, §5, §6, §7e items 6 and 7.
 *
 * The parsing, delta and wording layer, asserted on its own: a date and a kind become a
 * row's content, or become Danish messages bound to the control that is wrong, and never
 * become a guess.
 *
 * **This is deliberately not a second copy of the phase-2 time matrix.** Whether a
 * published override makes a day open or closed, what it does to the next opening, what it
 * does to §7b's sold-out reset and how it behaves across Copenhagen's two daylight-saving
 * transitions are asserted in `tests/unit/hours/engine.test.ts` and
 * `tests/unit/menu/sold-out.test.ts`, against the pure engine, and have been since phase 2.
 * What is asserted here is the half phase 8B added: the *editor's* reading of 1t's lower
 * card, and the four states one date can be in.
 */

const CLOSED: OverrideContent = { kind: 'closed', opens_at: null, closes_at: null }
const CUSTOM: OverrideContent = { kind: 'custom', opens_at: '13:00', closes_at: '18:00' }

/** A Monday, well clear of both DST transitions, used as "today" throughout. */
const TODAY = '2026-09-14'
/** The Sunday after it. */
const LATER = '2026-09-20'

function form(values: Partial<OverrideFormValues>): OverrideFormValues {
  return { date: TODAY, kind: 'closed', from: '', to: '', ...values }
}

// ---------------------------------------------------------------------------
// The two kinds are the model's own
// ---------------------------------------------------------------------------

describe('the two override kinds', () => {
  it('is exactly the pair `overrides_kind_check` allows, in 1t’s order', () => {
    expect([...OVERRIDE_KINDS]).toEqual(['closed', 'custom'])
  })

  it('words each one as 1t words it', () => {
    expect(OVERRIDE_KIND_LABELS.closed).toBe('Lukket en bestemt dato')
    expect(OVERRIDE_KIND_LABELS.custom).toBe('Andre tider en enkelt dag')
  })

  it('recognises those two and nothing else', () => {
    expect(isOverrideKind('closed')).toBe(true)
    expect(isOverrideKind('custom')).toBe(true)

    // The kinds §7e's scope note rules out, and the shapes a forged request might try.
    for (const value of ['holiday', 'split', 'overnight', 'CLOSED', '', null, undefined, 1]) {
      expect(isOverrideKind(value), String(value)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Reading the card
// ---------------------------------------------------------------------------

describe('toOverrideDraft', () => {
  it('accepts a closed override on today', () => {
    const result = toOverrideDraft(form({ kind: 'closed' }), TODAY)

    expect(result).toEqual({ ok: true, date: TODAY, content: CLOSED })
  })

  it('accepts a closed override on a future date', () => {
    const result = toOverrideDraft(form({ date: LATER, kind: 'closed' }), TODAY)

    expect(result.ok && result.date).toBe(LATER)
  })

  it('accepts a custom override with both times', () => {
    const result = toOverrideDraft(form({ kind: 'custom', from: '13:00', to: '18:00' }), TODAY)

    expect(result).toEqual({ ok: true, date: TODAY, content: CUSTOM })
  })

  it('drops the times a closed override was submitted with', () => {
    // Somebody chose Andre tider, picked two times, then chose Lukket again. The two
    // selects are hidden but still submitted (only `disabled` prevents that), so the
    // answer has to be built from the kind outwards rather than from the form's contents.
    const result = toOverrideDraft(form({ kind: 'closed', from: '13:00', to: '18:00' }), TODAY)

    expect(result).toEqual({ ok: true, date: TODAY, content: CLOSED })
  })

  it('refuses a missing date', () => {
    const result = toOverrideDraft(form({ date: '   ' }), TODAY)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors).toContain('dato_mangler')
  })

  it('refuses a date that does not exist in the calendar', () => {
    for (const date of ['2026-02-30', '2026-13-01', '14-09-2026', 'i morgen', '2026-09-31']) {
      const result = toOverrideDraft(form({ date }), TODAY)

      expect(result.ok, date).toBe(false)
      expect(!result.ok && result.errors, date).toContain('dato_ugyldig')
    }
  })

  it('refuses a date that has already been — §7e item 7', () => {
    const result = toOverrideDraft(form({ date: '2026-09-13' }), TODAY)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors).toContain('dato_fortid')
  })

  it('allows today itself, because “Ret kun i dag” is the case the feature is named after', () => {
    expect(toOverrideDraft(form({ date: TODAY }), TODAY).ok).toBe(true)
  })

  it('refuses a kind that is neither of the two', () => {
    const result = toOverrideDraft(form({ kind: 'holiday' }), TODAY)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors).toContain('art_ugyldig')
  })

  it('refuses a custom override with no opening time', () => {
    const result = toOverrideDraft(form({ kind: 'custom', from: '', to: '18:00' }), TODAY)

    expect(!result.ok && result.errors).toEqual(['fra_mangler'])
  })

  it('refuses a custom override with no closing time', () => {
    const result = toOverrideDraft(form({ kind: 'custom', from: '13:00', to: '' }), TODAY)

    expect(!result.ok && result.errors).toEqual(['til_mangler'])
  })

  it('refuses a custom override with neither', () => {
    const result = toOverrideDraft(form({ kind: 'custom' }), TODAY)

    expect(!result.ok && result.errors).toEqual(['fra_mangler', 'til_mangler'])
  })

  it('refuses times that are not TT:MM', () => {
    for (const [from, to, code] of [
      ['noget', '18:00', 'fra_ugyldig'],
      ['13:00', '18.00', 'til_ugyldig'],
      ['25:00', '18:00', 'fra_ugyldig'],
      ['13:60', '18:00', 'fra_ugyldig'],
    ] as const) {
      const result = toOverrideDraft(form({ kind: 'custom', from, to }), TODAY)

      expect(!result.ok && result.errors, `${from}–${to}`).toContain(code)
    }
  })

  it('refuses a closing time at or before its opening', () => {
    for (const [from, to] of [
      ['18:00', '13:00'],
      ['13:00', '13:00'],
    ] as const) {
      const result = toOverrideDraft(form({ kind: 'custom', from, to }), TODAY)

      expect(!result.ok && result.errors, `${from}–${to}`).toEqual(['ikke_efter'])
    }
  })

  it('refuses an overnight range, which is the same rule', () => {
    // The phase-2 engine states in as many words that opening hours never cross midnight,
    // and `overrides_shape_check` says `opens_at < closes_at`. One rule, one code.
    const result = toOverrideDraft(form({ kind: 'custom', from: '22:00', to: '02:00' }), TODAY)

    expect(!result.ok && result.errors).toEqual(['ikke_efter'])
  })

  it('does not complain about the order when a time could not be read', () => {
    const result = toOverrideDraft(form({ kind: 'custom', from: 'noget', to: '02:00' }), TODAY)

    expect(!result.ok && result.errors).toEqual(['fra_ugyldig'])
  })

  it('collects a date problem and a time problem together', () => {
    const result = toOverrideDraft(
      form({ date: '2026-09-01', kind: 'custom', from: '', to: '' }),
      TODAY,
    )

    expect(!result.ok && result.errors).toEqual(['dato_fortid', 'fra_mangler', 'til_mangler'])
  })

  it('accepts a time that is not on the quarter-hour grid', () => {
    // 1t's "kvarter-spring" is a control, not a business rule: the column, the CHECK and
    // the engine all take any HH:MM, and refusing 13:20 here would invent a restriction the
    // rest of the system does not have.
    const result = toOverrideDraft(form({ kind: 'custom', from: '13:20', to: '18:05' }), TODAY)

    expect(result.ok && result.content).toEqual({
      kind: 'custom',
      opens_at: '13:20',
      closes_at: '18:05',
    })
  })

  it('produces content the stored draft schema accepts', () => {
    for (const content of [CLOSED, CUSTOM]) {
      expect(openingHoursOverrideDraft.input.safeParse(content).success).toBe(true)
    }
  })

  it('produces content with no key outside the three the draft may hold', () => {
    const result = toOverrideDraft(form({ kind: 'custom', from: '13:00', to: '18:00' }), TODAY)

    expect(result.ok && Object.keys(result.content).sort()).toEqual(
      [...OVERRIDE_CONTENT_FIELDS].sort(),
    )
  })
})

// ---------------------------------------------------------------------------
// Refusals, and which control they belong to
// ---------------------------------------------------------------------------

describe('refusals', () => {
  it('binds every problem to a control a person can move to', () => {
    expect(overrideErrorField('dato_mangler')).toBe('dato')
    expect(overrideErrorField('dato_ugyldig')).toBe('dato')
    expect(overrideErrorField('dato_fortid')).toBe('dato')
    expect(overrideErrorField('art_ugyldig')).toBe('art')
    expect(overrideErrorField('fra_mangler')).toBe('fra')
    expect(overrideErrorField('fra_ugyldig')).toBe('fra')
    expect(overrideErrorField('til_mangler')).toBe('til')
    expect(overrideErrorField('til_ugyldig')).toBe('til')
    // Reported on the closing time, because that is the field a person moves to fix it.
    expect(overrideErrorField('ikke_efter')).toBe('til')
  })

  it('gives every problem a Danish sentence', () => {
    for (const [code, message] of Object.entries(OVERRIDE_ERROR_MESSAGES)) {
      expect(message.length, code).toBeGreaterThan(10)
      expect(message.endsWith('.'), code).toBe(true)
    }
  })

  it('hands a control its own message and nothing else', () => {
    const problems = ['dato_fortid', 'til_mangler'] as const

    expect(overrideErrorFor(problems, 'dato')).toBe(OVERRIDE_ERROR_MESSAGES.dato_fortid)
    expect(overrideErrorFor(problems, 'til')).toBe(OVERRIDE_ERROR_MESSAGES.til_mangler)
    expect(overrideErrorFor(problems, 'fra')).toBeUndefined()
    expect(overrideErrorFor(problems, 'art')).toBeUndefined()
  })

  it('keeps only codes it defined out of a hand-typed address', () => {
    expect(
      decodeOverrideProblems(['dato_fortid', 'noget', 'mon:fra_mangler', 'ikke_efter', '']),
    ).toEqual(['dato_fortid', 'ikke_efter'])
  })
})

// ---------------------------------------------------------------------------
// The form's own vocabulary
// ---------------------------------------------------------------------------

describe('the submitted vocabulary', () => {
  it('reads five names and no others', () => {
    const data = new URLSearchParams({
      [OVERRIDE_FORM.date]: LATER,
      [OVERRIDE_FORM.kind]: 'custom',
      [OVERRIDE_FORM.from]: '13:00',
      [OVERRIDE_FORM.to]: '18:00',
      [OVERRIDE_FORM.versionDate]: LATER,
      // Everything a forged submission might add. None of it is read.
      status: 'published',
      announcement_created: 'true',
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'aaben-mon': '1',
      schedule: '{}',
      besked: 'Vi har lukket',
    })

    expect(readOverrideForm(data)).toEqual({
      date: LATER,
      kind: 'custom',
      from: '13:00',
      to: '18:00',
    })
    expect(readOverrideVersionDate(data)).toBe(LATER)
  })

  it('has no field for a message, a link or an expiry — phase 8C', () => {
    const names = [...Object.values(OVERRIDE_FORM), ...Object.values(OVERRIDE_ROW_FORM)]

    for (const forbidden of ['besked', 'link', 'udloeb', 'kilde', 'source', 'previous']) {
      expect(names, forbidden).not.toContain(forbidden)
    }
  })

  it('keeps the editor’s names and the removal’s apart', () => {
    // A save can never remove anything, and a removal can never carry content — a property
    // of the parsers rather than a claim about the actions.
    for (const name of [OVERRIDE_FORM.date, OVERRIDE_FORM.kind, OVERRIDE_FORM.from, OVERRIDE_FORM.to]) {
      expect(Object.values(OVERRIDE_ROW_FORM)).not.toContain(name)
    }
  })

  it('round-trips a refused save through the address', () => {
    const submitted = form({ date: '2026-09-01', kind: 'custom', from: '18:00', to: '13:00' })
    const result = toOverrideDraft(submitted, TODAY)

    expect(result.ok).toBe(false)
    if (result.ok) return

    const echoed = encodeOverrideEcho(submitted, result.errors)

    expect(echoed.getAll(OVERRIDE_ERROR_FIELD)).toEqual([...result.errors])
    expect(readOverrideForm(echoed)).toEqual(submitted)
  })
})

// ---------------------------------------------------------------------------
// The card's values
// ---------------------------------------------------------------------------

describe('what the card shows', () => {
  it('starts a date with no override on 1t’s first chip and no times', () => {
    expect(emptyOverrideForm(LATER)).toEqual({ date: LATER, kind: 'closed', from: '', to: '' })
  })

  it('shows a stored custom override’s two times', () => {
    expect(overrideFormValues(LATER, CUSTOM)).toEqual({
      date: LATER,
      kind: 'custom',
      from: '13:00',
      to: '18:00',
    })
  })

  it('shows a stored closed override with empty times, because the row has none', () => {
    expect(overrideFormValues(LATER, CLOSED)).toEqual({
      date: LATER,
      kind: 'closed',
      from: '',
      to: '',
    })
  })

  it('round-trips: values in, form read, same content out', () => {
    for (const content of [CLOSED, CUSTOM]) {
      const result = toOverrideDraft(overrideFormValues(LATER, content), TODAY)

      expect(result.ok && result.content).toEqual(content)
    }
  })
})

// ---------------------------------------------------------------------------
// What one Gem writes
// ---------------------------------------------------------------------------

describe('overrideDraftWrite', () => {
  it('writes all three fields when the content differs', () => {
    expect(overrideDraftWrite(CUSTOM, CLOSED)).toEqual({ values: CUSTOM, clear: [] })
  })

  it('writes all three the other way too — custom becoming closed', () => {
    // The two times must be *present and null* rather than absent: a draft saying only
    // `kind: 'closed'` would merge into a row that kept its times, and
    // `overrides_shape_check` would refuse it. All-or-none is what keeps every stored draft
    // publishable by construction.
    expect(overrideDraftWrite(CLOSED, CUSTOM)).toEqual({
      values: { kind: 'closed', opens_at: null, closes_at: null },
      clear: [],
    })
  })

  it('clears all three when the edit is back to what the row already holds', () => {
    expect(overrideDraftWrite(CUSTOM, { ...CUSTOM })).toEqual({
      values: {},
      clear: [...OVERRIDE_CONTENT_FIELDS],
    })

    expect(overrideDraftWrite(CLOSED, { ...CLOSED })).toEqual({
      values: {},
      clear: [...OVERRIDE_CONTENT_FIELDS],
    })
  })

  it('notices a change of one time alone', () => {
    const later = { ...CUSTOM, closes_at: '19:00' }

    expect(overrideDraftWrite(later, CUSTOM).clear).toEqual([])
    expect(overrideDraftWrite(later, CUSTOM).values).toEqual(later)
  })

  it('names only fields the draft schema knows', () => {
    for (const field of OVERRIDE_CONTENT_FIELDS) {
      expect(openingHoursOverrideDraft.fields).toContain(field)
    }

    expect([...openingHoursOverrideDraft.fields].sort()).toEqual(
      [...OVERRIDE_CONTENT_FIELDS].sort(),
    )
  })

  it('compares content by all three fields', () => {
    expect(overrideContentEqual(CUSTOM, { ...CUSTOM })).toBe(true)
    expect(overrideContentEqual(CUSTOM, { ...CUSTOM, opens_at: '13:15' })).toBe(false)
    expect(overrideContentEqual(CUSTOM, CLOSED)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The four states one date can be in
// ---------------------------------------------------------------------------

describe('the lifecycle', () => {
  it('names all four combinations of status and draft', () => {
    expect(overrideLifecycle(null)).toBe('ingen')
    expect(overrideLifecycle({ status: 'draft', hasDraft: false })).toBe('kladde')
    expect(overrideLifecycle({ status: 'draft', hasDraft: true })).toBe('kladde')
    expect(overrideLifecycle({ status: 'published', hasDraft: false })).toBe('live')
    expect(overrideLifecycle({ status: 'published', hasDraft: true })).toBe('live_med_kladde')
  })

  it('calls the two pending states pending, and the other two not', () => {
    expect(overrideIsPending('ingen')).toBe(false)
    expect(overrideIsPending('kladde')).toBe(true)
    expect(overrideIsPending('live')).toBe(false)
    expect(overrideIsPending('live_med_kladde')).toBe(true)
  })

  it('badges each state in words rather than by colour alone', () => {
    expect(overrideStateBadge('ingen')).toBeNull()
    expect(overrideStateBadge('kladde')).toBe('Kladde')
    expect(overrideStateBadge('live')).toBe('På hjemmesiden')
    expect(overrideStateBadge('live_med_kladde')).toBe('Kladde')
  })
})

// ---------------------------------------------------------------------------
// Saying what a date is
// ---------------------------------------------------------------------------

describe('the words the card uses', () => {
  it('describes a closed day and a custom one', () => {
    expect(describeOverrideContent(CLOSED)).toBe('Lukket hele dagen')
    expect(describeOverrideContent(CUSTOM)).toBe('13:00–18:00')
  })

  it('refuses to describe a custom override with a missing time', () => {
    expect(() =>
      describeOverrideContent({ kind: 'custom', opens_at: '13:00', closes_at: null }),
    ).toThrow(TypeError)
  })

  it('names the weekday and the short date in the list', () => {
    expect(describeOverrideDay('2026-09-14', CLOSED)).toBe('Mandag 14.09 · Lukket hele dagen')
    expect(describeOverrideDay('2026-09-20', CUSTOM)).toBe('Søndag 20.09 · 13:00–18:00')
  })

  it('says a date with no override follows the normal week', () => {
    expect(describeOverrideState('2026-09-20', 'ingen', null, null)).toContain(
      'de normale åbningstider gælder',
    )
  })

  it('begins every sentence with a capital, because a weekday name is a lowercase noun', () => {
    for (const sentence of [
      describeOverrideState('2026-09-20', 'ingen', null, null),
      describeOverrideState('2026-09-20', 'kladde', null, CUSTOM),
      describeOverrideState('2026-09-20', 'live', CLOSED, CLOSED),
      describeOverrideState('2026-09-20', 'live_med_kladde', CLOSED, CUSTOM),
      describeOverridePending('2026-09-20', 'kladde', CLOSED)?.sentence ?? '',
      describeOverridePending('2026-09-20', 'live_med_kladde', CUSTOM)?.sentence ?? '',
      describeOverrideDay('2026-09-20', CUSTOM),
    ]) {
      expect(sentence.startsWith('Søndag'), sentence).toBe(true)
    }
  })

  it('says a pending override is not on the hjemmeside yet', () => {
    const sentence = describeOverrideState('2026-09-20', 'kladde', null, CUSTOM)

    expect(sentence).toContain('13:00–18:00')
    expect(sentence).toContain('kladde')
    expect(sentence).toContain('normale tider')
  })

  it('says a published override is on the hjemmeside', () => {
    expect(describeOverrideState('2026-09-20', 'live', CLOSED, CLOSED)).toContain(
      'det står på hjemmesiden nu',
    )
  })

  it('names both answers while a published override has an edit waiting', () => {
    // The whole promise of §6 is that the guest is still reading the published one, so a
    // sentence showing only the pending edit would be the one place that looked broken.
    const sentence = describeOverrideState('2026-09-20', 'live_med_kladde', CLOSED, CUSTOM)

    expect(sentence).toContain('Lukket hele dagen')
    expect(sentence).toContain('13:00–18:00')
  })
})

describe('the pending band', () => {
  it('says nothing when nothing is waiting', () => {
    expect(describeOverridePending('2026-09-20', 'ingen', null)).toBeNull()
    expect(describeOverridePending('2026-09-20', 'live', CLOSED)).toBeNull()
    expect(describeOverridePending('2026-09-20', 'kladde', null)).toBeNull()
  })

  it('names the date and what will happen on it', () => {
    const pending = describeOverridePending('2026-09-20', 'kladde', CLOSED)

    expect(pending?.badge).toBe('Kladde')
    expect(pending?.sentence).toBe(
      'Søndag 20.09: Lukket hele dagen venter på at blive offentliggjort.',
    )
  })

  it('words an edit to a live override as an edit', () => {
    const pending = describeOverridePending('2026-09-20', 'live_med_kladde', CUSTOM)

    expect(pending?.sentence).toContain('ændringen til 13:00–18:00')
  })
})

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

describe('what “Fjern” offers', () => {
  it('offers nothing on a date with no override', () => {
    expect(describeOverrideRemoval('ingen')).toBeNull()
  })

  it('deletes a pending override without asking, because no guest can see it', () => {
    const removal = describeOverrideRemoval('kladde')

    expect(removal?.confirms).toBe(false)
    expect(removal?.label).toBe('Fjern kladden')
    expect(removal?.description).toContain('aldrig været på hjemmesiden')
  })

  it('drops only the pending edit when the override is live, and keeps the live one', () => {
    const removal = describeOverrideRemoval('live_med_kladde')

    expect(removal?.confirms).toBe(false)
    expect(removal?.description).toContain('bliver stående')
  })

  it('asks first when the press would change what a guest reads', () => {
    const removal = describeOverrideRemoval('live')

    expect(removal?.confirms).toBe(true)
    expect(removal?.description).toContain('normale åbningstider')
    // No Fortryd strip, and the sentence says so rather than leaving it to be discovered.
    expect(removal?.description).toContain('kan ikke fortrydes')
  })

  it('asks first for exactly one of the four states', () => {
    const confirming = (['ingen', 'kladde', 'live', 'live_med_kladde'] as const).filter(
      (lifecycle) => describeOverrideRemoval(lifecycle)?.confirms === true,
    )

    expect(confirming).toEqual(['live'])
  })
})
