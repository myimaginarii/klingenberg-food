import { describe, expect, it } from 'vitest'

import {
  encodeTapasEcho,
  readTapasEcho,
  readTapasForm,
  TAPAS_ACTION,
  TAPAS_ERROR_FIELD,
  TAPAS_ERROR_MESSAGES,
  TAPAS_FORM,
  tapasEditorGroups,
} from '@/app/(admin)/admin/menu/tapas-form'
import type { TapasDetails } from '@/lib/content/types'
import { TAPAS_GROUP_RULES, type TapasIssue } from '@/lib/menu/tapas'

/**
 * The Tapas editor's form — phase 5F.
 *
 * Two questions, and they are the ones a browser gets a vote on: *what may a submission
 * say*, and *how does a refusal come back*. Everything a submission is then measured
 * against lives in `lib/menu/tapas.ts` and is tested beside it.
 */

const DISH = '3f1b0a2c-8f2e-4b21-9a6f-9b3a0d5e7c11'
const VERSION = '2026-08-30T10:00:00.000000+00:00'

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()

  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, item)
  }

  return data
}

function valid(overrides: Record<string, string | string[]> = {}): FormData {
  return form({
    [TAPAS_FORM.dishId]: DISH,
    [TAPAS_FORM.version]: VERSION,
    [TAPAS_FORM.group]: 'dressing',
    [TAPAS_FORM.heading]: 'Og 3 dressinger',
    [TAPAS_FORM.item]: ['Pesto', 'Hummus'],
    [TAPAS_FORM.newItem]: '',
    [TAPAS_FORM.action]: TAPAS_ACTION.save,
    ...overrides,
  })
}

describe('readTapasForm', () => {
  it('reads a save, in list order', () => {
    const request = readTapasForm(valid())

    expect(request).not.toBeNull()
    expect(request?.dishId).toBe(DISH)
    expect(request?.version).toBe(VERSION)
    expect(request?.submission.groupId).toBe('dressing')
    expect(request?.submission.items).toEqual(['Pesto', 'Hummus'])
    expect(request?.submission.edit).toEqual({ kind: 'save' })
  })

  it('reads each button as the edit it is', () => {
    const editFor = (value: string) =>
      readTapasForm(valid({ [TAPAS_FORM.action]: value }))?.submission.edit

    expect(editFor(TAPAS_ACTION.add)).toEqual({ kind: 'add' })
    expect(editFor(TAPAS_ACTION.remove(2))).toEqual({ kind: 'remove', index: 2 })
    expect(editFor(TAPAS_ACTION.up(3))).toEqual({ kind: 'move', from: 3, to: 2 })
    expect(editFor(TAPAS_ACTION.down(0))).toEqual({ kind: 'move', from: 0, to: 1 })
  })

  it('refuses a group that is not one of the three', () => {
    expect(readTapasForm(valid({ [TAPAS_FORM.group]: 'ekstra' }))).toBeNull()
    expect(readTapasForm(valid({ [TAPAS_FORM.group]: '' }))).toBeNull()
  })

  it('refuses a button value this module did not write', () => {
    for (const value of ['', 'slet', 'op', 'op:', 'op:-1', 'op:1.5', 'fjern:99999', 'op:0']) {
      expect(readTapasForm(valid({ [TAPAS_FORM.action]: value })), value).toBeNull()
    }
  })

  it('refuses a submission with no dish or no version', () => {
    expect(readTapasForm(valid({ [TAPAS_FORM.dishId]: '' }))).toBeNull()
    expect(readTapasForm(valid({ [TAPAS_FORM.version]: '' }))).toBeNull()
  })

  it('carries no mode, no choose and no group order — there are no such fields', () => {
    const names = Object.values(TAPAS_FORM)

    expect(names).not.toContain('mode')
    expect(names).not.toContain('choose')
    expect(names.every((name) => name.startsWith('tapas_'))).toBe(true)
  })

  it('ignores a section that is not there, because it is navigation only', () => {
    expect(readTapasForm(valid())?.section).toBeNull()
    expect(readTapasForm(valid({ [TAPAS_FORM.section]: 'tapas' }))?.section).toBe('tapas')
  })
})

describe('a refusal round-trips through the address', () => {
  const issues: readonly TapasIssue[] = [
    { field: 'heading', code: 'required' },
    { field: 'item', index: 2, code: 'duplicate' },
    { field: 'list', code: 'too_many' },
    { field: 'new', code: 'required' },
  ]

  it('encodes and decodes every kind of issue', () => {
    const encoded = encodeTapasEcho('choose7', 'I vælger 7', ['Brie', 'Chorizo', 'brie'], issues)
    const echo = readTapasEcho(encoded)

    expect(echo?.groupId).toBe('choose7')
    expect(echo?.heading).toBe('I vælger 7')
    expect(echo?.items).toEqual(['Brie', 'Chorizo', 'brie'])
    expect(echo?.issues).toEqual(issues)
  })

  it('is nothing at all when the address carries no codes this module wrote', () => {
    expect(readTapasEcho(new URLSearchParams())).toBeNull()

    const noise = new URLSearchParams({ [TAPAS_FORM.group]: 'base' })
    noise.append(TAPAS_ERROR_FIELD, 'pris:not_a_number')
    noise.append(TAPAS_ERROR_FIELD, 'punkt:tre:blank')
    expect(readTapasEcho(noise)).toBeNull()
  })

  it('preserves Danish characters through the round trip', () => {
    const encoded = encodeTapasEcho('base', 'På bordet', ['Ølpinde', 'Æblekage'], [
      { field: 'item', index: 0, code: 'duplicate' },
    ])

    expect(readTapasEcho(encoded)?.items).toEqual(['Ølpinde', 'Æblekage'])
    expect(readTapasEcho(encoded)?.heading).toBe('På bordet')
  })
})

describe('tapasEditorGroups', () => {
  const document: TapasDetails = {
    kind: 'tapas',
    groups: [
      { id: 'base', heading: 'På bordet', mode: 'fixed', choose: null, items: ['Oliven'] },
      { id: 'choose7', heading: 'I vælger 7', mode: 'choose', choose: 7, items: ['Brie'] },
      { id: 'dressing', heading: 'Og 3', mode: 'choose', choose: 3, items: ['Pesto'] },
    ],
  }

  it('renders the three groups in their fixed order, with their fixed labels', () => {
    const groups = tapasEditorGroups(document, null)

    expect(groups.map((group) => group.id)).toEqual(['base', 'choose7', 'dressing'])
    expect(groups.map((group) => group.label)).toEqual(
      TAPAS_GROUP_RULES.map((rule) => rule.label),
    )
    expect(groups.map((group) => group.heading)).toEqual(['På bordet', 'I vælger 7', 'Og 3'])
  })

  it('binds each message to the control that earned it, in the one group it was about', () => {
    const echo = readTapasEcho(
      encodeTapasEcho('dressing', 'Og 3', ['Pesto', 'pesto'], [
        { field: 'item', index: 1, code: 'duplicate' },
        { field: 'heading', code: 'too_long' },
      ]),
    )

    const groups = tapasEditorGroups(document, echo)
    const dressing = groups.find((group) => group.id === 'dressing')

    expect(dressing?.items).toEqual(['Pesto', 'pesto'])
    expect(dressing?.itemErrors).toEqual([undefined, TAPAS_ERROR_MESSAGES['punkt:duplicate']])
    expect(dressing?.headingError).toBe(TAPAS_ERROR_MESSAGES['overskrift:too_long'])

    // The other two are untouched by a refusal that had nothing to do with them.
    expect(groups.find((group) => group.id === 'base')?.items).toEqual(['Oliven'])
    expect(groups.find((group) => group.id === 'base')?.headingError).toBeUndefined()
    expect(groups.find((group) => group.id === 'choose7')?.items).toEqual(['Brie'])
  })

  it('drops an item message that points past the list it came back with', () => {
    const echo = readTapasEcho(
      encodeTapasEcho('base', 'På bordet', ['Oliven'], [
        { field: 'item', index: 7, code: 'blank' },
      ]),
    )

    const base = tapasEditorGroups(document, echo)?.find((group) => group.id === 'base')

    expect(base?.itemErrors).toEqual([undefined])
  })
})
