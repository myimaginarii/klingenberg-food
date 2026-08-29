import { describe, expect, it } from 'vitest'

import type { TapasDetails } from '@/lib/content/types'
import { nextDraftValues } from '@/lib/drafts/overlay'
import { DISH_EDITOR_FIELDS } from '@/lib/menu/admin'
import {
  applyTapasGroupEdit,
  MAX_TAPAS_ITEM_LENGTH,
  MAX_TAPAS_ITEMS,
  moveListItem,
  parseTapasGroupId,
  readTapasDocument,
  sameTapasDocument,
  TAPAS_GROUP_RULES,
  tapasDetailsWrite,
  type TapasGroupSubmission,
} from '@/lib/menu/tapas'
import { dishDraft } from '@/lib/schemas/menu'

/**
 * The Tapas document's rules — technical plan §4 (decision 3), phase 5F.
 *
 * Everything here is pure: no database, no React, no Server Action. That is the point of
 * `lib/menu/tapas.ts` — a Tapas edit is one small calculation surrounded by a lot of
 * interaction, and only the calculation has to be right in a way a test can prove.
 */

const DOCUMENT: TapasDetails = {
  kind: 'tapas',
  groups: [
    {
      id: 'base',
      heading: 'På bordet — altid med',
      mode: 'fixed',
      choose: null,
      items: ['Hjemmebagt brød', 'Oliven', 'Frugt'],
    },
    {
      id: 'choose7',
      heading: 'I vælger 7',
      mode: 'choose',
      choose: 7,
      items: ['Laksetatar', 'Chorizo', 'Brie'],
    },
    {
      id: 'dressing',
      heading: 'Og 3 dressinger',
      mode: 'choose',
      choose: 3,
      items: ['Pesto', 'Hummus', 'Aioli'],
    },
  ],
}

/** A submission for one group, starting from that group's current contents. */
function submit(
  groupId: 'base' | 'choose7' | 'dressing',
  overrides: Partial<TapasGroupSubmission> = {},
): TapasGroupSubmission {
  const group = DOCUMENT.groups.find((candidate) => candidate.id === groupId)

  return {
    groupId,
    heading: group?.heading ?? '',
    items: group?.items ?? [],
    newItem: '',
    edit: { kind: 'save' },
    ...overrides,
  }
}

/** One group of a result document, by id. */
function groupOf(document: TapasDetails, id: string) {
  return document.groups.find((group) => group.id === id)
}

// ---------------------------------------------------------------------------
// moveListItem
// ---------------------------------------------------------------------------

describe('moveListItem', () => {
  const items = ['a', 'b', 'c', 'd'] as const

  it('moves the first item to last', () => {
    expect(moveListItem(items, 0, 3)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('moves the last item to first', () => {
    expect(moveListItem(items, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('moves one step without disturbing the rest', () => {
    expect(moveListItem(items, 2, 1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('never mutates the array it was given', () => {
    const source = [...items]
    moveListItem(source, 0, 3)
    expect(source).toEqual(['a', 'b', 'c', 'd'])
  })

  it('loses and duplicates nothing, for every pair of positions', () => {
    for (let from = 0; from < items.length; from += 1) {
      for (let to = 0; to < items.length; to += 1) {
        const moved = moveListItem(items, from, to)

        expect(moved).not.toBeNull()
        expect([...(moved ?? [])].sort()).toEqual([...items].sort())
        expect(moved?.[to]).toBe(items[from])
      }
    }
  })

  it('treats a move to the same position as a no-op, in a fresh array', () => {
    const moved = moveListItem(items, 2, 2)

    expect(moved).toEqual([...items])
    expect(moved).not.toBe(items)
  })

  it('refuses an impossible index rather than clamping it', () => {
    expect(moveListItem(items, 0, 9)).toBeNull()
    expect(moveListItem(items, -1, 0)).toBeNull()
    expect(moveListItem(items, 1.5, 0)).toBeNull()
    expect(moveListItem(items, 0, Number.NaN)).toBeNull()
    expect(moveListItem([], 0, 0)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Reading a stored document
// ---------------------------------------------------------------------------

describe('readTapasDocument', () => {
  it('is null for every dish that is not the Tapas entry', () => {
    expect(readTapasDocument(null)).toBeNull()
    expect(readTapasDocument(undefined)).toBeNull()
    expect(readTapasDocument({ kind: 'andet' })).toBeNull()
    expect(readTapasDocument([{ kind: 'tapas' }])).toBeNull()
    expect(readTapasDocument('tapas')).toBeNull()
  })

  it('reads the seeded shape, where the fixed group carries no `choose` key at all', () => {
    const document = readTapasDocument({
      kind: 'tapas',
      groups: [
        { id: 'base', heading: 'På bordet', mode: 'fixed', items: ['Oliven'] },
        { id: 'choose7', heading: 'I vælger 7', mode: 'choose', choose: 7, items: ['Brie'] },
        { id: 'dressing', heading: 'Og 3', mode: 'choose', choose: 3, items: ['Pesto'] },
      ],
    })

    expect(document?.groups.map((group) => group.id)).toEqual(['base', 'choose7', 'dressing'])
    expect(groupOf(document!, 'base')?.choose).toBeNull()
    expect(groupOf(document!, 'base')?.items).toEqual(['Oliven'])
  })

  it('takes mode, choose and the order from the rules, never from the stored value', () => {
    const document = readTapasDocument({
      kind: 'tapas',
      groups: [
        { id: 'dressing', heading: 'Dressinger', mode: 'fixed', choose: 99, items: [] },
        { id: 'choose7', heading: 'Syv', mode: 'fixed', choose: 12, items: [] },
        { id: 'ekstra', heading: 'Fjerde gruppe', mode: 'choose', choose: 4, items: ['Nej'] },
      ],
    })

    expect(document?.groups.map((group) => [group.id, group.mode, group.choose])).toEqual([
      ['base', 'fixed', null],
      ['choose7', 'choose', 7],
      ['dressing', 'choose', 3],
    ])

    // The fourth group contributed nothing at all — not its items, not its heading.
    expect(document?.groups).toHaveLength(3)
    expect(JSON.stringify(document)).not.toContain('Nej')
  })

  it('falls back to the group label when a stored heading is missing or blank', () => {
    const document = readTapasDocument({
      kind: 'tapas',
      groups: [{ id: 'base', heading: '   ', mode: 'fixed', items: [] }],
    })

    expect(document?.groups.map((group) => group.heading)).toEqual(
      TAPAS_GROUP_RULES.map((rule) => rule.label),
    )
  })
})

describe('parseTapasGroupId', () => {
  it('accepts exactly the three fixed ids', () => {
    expect(parseTapasGroupId('base')).toBe('base')
    expect(parseTapasGroupId('choose7')).toBe('choose7')
    expect(parseTapasGroupId('dressing')).toBe('dressing')
  })

  it('refuses anything else, so a fourth group cannot be addressed', () => {
    expect(parseTapasGroupId('ekstra')).toBeNull()
    expect(parseTapasGroupId('')).toBeNull()
    expect(parseTapasGroupId('BASE')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Editing one group
// ---------------------------------------------------------------------------

describe('applyTapasGroupEdit', () => {
  it('adds an item', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', { newItem: '  Rugchips  ', edit: { kind: 'add' } }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(groupOf(result.document, 'base')?.items).toEqual([
      'Hjemmebagt brød',
      'Oliven',
      'Frugt',
      'Rugchips',
    ])
  })

  it('refuses Tilføj punkt with nothing in the field', () => {
    const result = applyTapasGroupEdit(DOCUMENT, submit('base', { edit: { kind: 'add' } }))

    expect(result.ok).toBe(false)
    if (result.ok || result.issues === null) return

    expect(result.issues).toContainEqual({ field: 'new', code: 'required' })
  })

  it('takes a typed new item along with a plain Gem', () => {
    const result = applyTapasGroupEdit(DOCUMENT, submit('dressing', { newItem: 'Urtemayo' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(groupOf(result.document, 'dressing')?.items).toEqual([
      'Pesto',
      'Hummus',
      'Aioli',
      'Urtemayo',
    ])
  })

  it('edits an item, and edits the heading', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('choose7', {
        heading: '  I vælger syv  ',
        items: ['Laksetatar', 'Chorizo picante', 'Brie'],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const group = groupOf(result.document, 'choose7')
    expect(group?.heading).toBe('I vælger syv')
    expect(group?.items).toEqual(['Laksetatar', 'Chorizo picante', 'Brie'])
  })

  it('removes an item', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('dressing', { edit: { kind: 'remove', index: 1 } }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(groupOf(result.document, 'dressing')?.items).toEqual(['Pesto', 'Aioli'])
  })

  it('keeps a typed new item when another item is removed', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('dressing', { newItem: 'Chilimayo', edit: { kind: 'remove', index: 0 } }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(groupOf(result.document, 'dressing')?.items).toEqual([
      'Hummus',
      'Aioli',
      'Chilimayo',
    ])
  })

  it('moves an item first → last and last → first', () => {
    const down = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', { edit: { kind: 'move', from: 0, to: 2 } }),
    )
    expect(down.ok && groupOf(down.document, 'base')?.items).toEqual([
      'Oliven',
      'Frugt',
      'Hjemmebagt brød',
    ])

    const up = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', { edit: { kind: 'move', from: 2, to: 0 } }),
    )
    expect(up.ok && groupOf(up.document, 'base')?.items).toEqual([
      'Frugt',
      'Hjemmebagt brød',
      'Oliven',
    ])
  })

  it('refuses a position the list does not have, with no field to blame', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', { edit: { kind: 'move', from: 0, to: 40 } }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toBeNull()

    const removed = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', { edit: { kind: 'remove', index: 9 } }),
    )
    expect(removed.ok).toBe(false)
    if (removed.ok) return
    expect(removed.issues).toBeNull()
  })

  it('rejects a blank item rather than dropping it silently', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', { items: ['Hjemmebagt brød', '   ', 'Frugt'] }),
    )

    expect(result.ok).toBe(false)
    if (result.ok || result.issues === null) return

    expect(result.issues).toEqual([{ field: 'item', index: 1, code: 'blank' }])
    // The item is still there, at the position the message points at.
    expect(result.items).toEqual(['Hjemmebagt brød', '', 'Frugt'])
  })

  it('rejects a duplicate case-insensitively, and blames the second one', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('dressing', { items: ['Pesto', 'Hummus', 'PESTO'] }),
    )

    expect(result.ok).toBe(false)
    if (result.ok || result.issues === null) return

    expect(result.issues).toEqual([{ field: 'item', index: 2, code: 'duplicate' }])
  })

  it('treats Danish characters as ordinary letters, and keeps them as written', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', { items: ['Ølpinde', 'Æblemost', 'Årstidens frugt'] }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(groupOf(result.document, 'base')?.items).toEqual([
      'Ølpinde',
      'Æblemost',
      'Årstidens frugt',
    ])

    // …and the same fold that catches "PESTO"/"Pesto" catches "ØL"/"øl".
    const folded = applyTapasGroupEdit(DOCUMENT, submit('base', { items: ['Ølpinde', 'ØLPINDE'] }))
    expect(folded.ok).toBe(false)
  })

  it('rejects a blank heading and one that is too long', () => {
    const blank = applyTapasGroupEdit(DOCUMENT, submit('base', { heading: '  ' }))
    expect(blank.ok).toBe(false)
    if (!blank.ok && blank.issues !== null) {
      expect(blank.issues).toContainEqual({ field: 'heading', code: 'required' })
    }

    const long = applyTapasGroupEdit(DOCUMENT, submit('base', { heading: 'x'.repeat(81) }))
    expect(long.ok).toBe(false)
    if (!long.ok && long.issues !== null) {
      expect(long.issues).toContainEqual({ field: 'heading', code: 'too_long' })
    }
  })

  it('rejects an item that is too long, and a list that is too long', () => {
    const long = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', { items: ['x'.repeat(MAX_TAPAS_ITEM_LENGTH + 1)] }),
    )
    expect(long.ok).toBe(false)
    if (!long.ok && long.issues !== null) {
      expect(long.issues).toContainEqual({ field: 'item', index: 0, code: 'too_long' })
    }

    const many = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', {
        items: Array.from({ length: MAX_TAPAS_ITEMS + 1 }, (_, index) => `Punkt ${index}`),
      }),
    )
    expect(many.ok).toBe(false)
    if (!many.ok && many.issues !== null) {
      expect(many.issues).toContainEqual({ field: 'list', code: 'too_many' })
    }
  })

  it('reports everything wrong at once, not one problem per attempt', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('base', { heading: '', items: ['Oliven', '', 'oliven'] }),
    )

    expect(result.ok).toBe(false)
    if (result.ok || result.issues === null) return

    expect(result.issues).toEqual([
      { field: 'heading', code: 'required' },
      { field: 'item', index: 1, code: 'blank' },
      { field: 'item', index: 2, code: 'duplicate' },
    ])
  })

  it('editing one group preserves the other two, exactly', () => {
    const result = applyTapasGroupEdit(
      DOCUMENT,
      submit('dressing', { edit: { kind: 'remove', index: 0 } }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(groupOf(result.document, 'base')).toEqual(groupOf(DOCUMENT, 'base'))
    expect(groupOf(result.document, 'choose7')).toEqual(groupOf(DOCUMENT, 'choose7'))
  })

  it('never mutates the document it was given', () => {
    const before = JSON.stringify(DOCUMENT)

    applyTapasGroupEdit(DOCUMENT, submit('base', { newItem: 'Rugchips', edit: { kind: 'add' } }))
    applyTapasGroupEdit(DOCUMENT, submit('base', { edit: { kind: 'remove', index: 0 } }))

    expect(JSON.stringify(DOCUMENT)).toBe(before)
  })

  it('rebuilds the edited group from the rules, so mode, choose and id cannot move', () => {
    const result = applyTapasGroupEdit(DOCUMENT, submit('choose7', { newItem: 'Bresaola' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const group = groupOf(result.document, 'choose7')
    expect(group?.id).toBe('choose7')
    expect(group?.mode).toBe('choose')
    expect(group?.choose).toBe(7)
    expect(result.document.groups.map((candidate) => candidate.id)).toEqual([
      'base',
      'choose7',
      'dressing',
    ])
  })
})

// ---------------------------------------------------------------------------
// Turning an edit into a draft change
// ---------------------------------------------------------------------------

describe('tapasDetailsWrite', () => {
  it('writes the document when it differs from the published one', () => {
    const next = readTapasDocument({
      kind: 'tapas',
      groups: [
        { id: 'base', heading: 'På bordet — altid med', mode: 'fixed', items: ['Oliven'] },
      ],
    })

    expect(tapasDetailsWrite(next!, DOCUMENT)).toEqual({ action: 'set', details: next })
  })

  it('clears the draft field when the lists end up as they are published', () => {
    expect(tapasDetailsWrite(DOCUMENT, DOCUMENT)).toEqual({ action: 'clear' })
  })

  it('recognises the seeded document and a saved one as the same board', () => {
    // The seeded shape omits `choose` on the fixed group; a save writes it as `null`.
    // Both are read through `readTapasDocument`, so neither is a change nobody made.
    const seeded = readTapasDocument({
      kind: 'tapas',
      groups: [
        {
          id: 'base',
          heading: 'På bordet — altid med',
          mode: 'fixed',
          items: ['Hjemmebagt brød', 'Oliven', 'Frugt'],
        },
        {
          id: 'choose7',
          heading: 'I vælger 7',
          mode: 'choose',
          choose: 7,
          items: ['Laksetatar', 'Chorizo', 'Brie'],
        },
        {
          id: 'dressing',
          heading: 'Og 3 dressinger',
          mode: 'choose',
          choose: 3,
          items: ['Pesto', 'Hummus', 'Aioli'],
        },
      ],
    })

    expect(sameTapasDocument(seeded!, DOCUMENT)).toBe(true)
    expect(tapasDetailsWrite(seeded!, DOCUMENT)).toEqual({ action: 'clear' })
  })

  it('writes the document when there is no published one to compare against', () => {
    expect(tapasDetailsWrite(DOCUMENT, null)).toEqual({ action: 'set', details: DOCUMENT })
  })

  it('sees a reordered list as a change, not as the same content', () => {
    const reordered: TapasDetails = {
      kind: 'tapas',
      groups: DOCUMENT.groups.map((group) =>
        group.id === 'dressing' ? { ...group, items: ['Aioli', 'Pesto', 'Hummus'] } : group,
      ),
    }

    expect(sameTapasDocument(reordered, DOCUMENT)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Draft integrity — the property phase 5F most easily breaks (§4, §6)
// ---------------------------------------------------------------------------

describe('a Tapas edit and an ordinary dish edit leave each other alone', () => {
  /** What the Tapas action writes: `details`, merged into whatever is already there. */
  function saveTapas(existing: Record<string, unknown>, document: TapasDetails) {
    return nextDraftValues(existing, { details: document }, dishDraft)
  }

  /**
   * What the dish panel writes: its own six fields, merged, with the ones that no
   * longer differ from the published values cleared. `sort_order`, `details` and
   * `image_id` are named neither way — see `DISH_EDITOR_FIELDS`.
   */
  function savePanel(existing: Record<string, unknown>, values: Record<string, unknown>) {
    return nextDraftValues(
      existing,
      values,
      dishDraft,
      DISH_EDITOR_FIELDS.filter((field) => values[field] === undefined),
    )
  }

  it('a Tapas edit preserves a pending price, name and position', () => {
    const draft = saveTapas(
      { price_ore: 30500, name: 'Tapasbord', sort_order: 4 },
      DOCUMENT,
    )

    expect(draft).toEqual({
      price_ore: 30500,
      name: 'Tapasbord',
      sort_order: 4,
      details: DOCUMENT,
    })
  })

  it('a dish-panel save preserves a pending Tapas document', () => {
    const draft = savePanel(
      { details: DOCUMENT, sort_order: 4 },
      { price_ore: 30500 },
    )

    expect(draft).toEqual({ details: DOCUMENT, sort_order: 4, price_ore: 30500 })
  })

  it('a dish-panel save that reverts a price still leaves the Tapas document alone', () => {
    // Nothing the panel owns differs from the published values any more, so all six are
    // cleared — and `details` is not one of the six.
    const draft = savePanel({ details: DOCUMENT, price_ore: 30500 }, {})

    expect(draft).toEqual({ details: DOCUMENT })
  })

  it('a Tapas edit that is reverted leaves no pending change at all', () => {
    const draft = nextDraftValues({ details: DOCUMENT }, {}, dishDraft, ['details'])

    expect(draft).toBeNull()
  })

  it('`details` is not a field the dish panel clears', () => {
    expect(DISH_EDITOR_FIELDS).not.toContain('details')
    expect(DISH_EDITOR_FIELDS).not.toContain('sort_order')
  })
})
