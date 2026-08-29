import { describe, expect, it } from 'vitest'

import {
  describeHandle,
  describeMove,
  dropIndex,
  orderFingerprint,
  reorderDishes,
  sortOrderAt,
  sortOrderWrites,
  type OrderedDish,
} from '@/lib/menu/reorder'

/**
 * Reordering — the pure half, asserted directly (technical plan §4, §6, §9).
 *
 * Every rule the feature has is in `lib/menu/reorder.ts`, which is what makes this suite
 * worth more than a browser test that drags a row: the browser test proves the gesture
 * is wired up, and these prove the answer is right. A reorder that silently loses a dish
 * is the one failure a screenshot would not catch and a guest would.
 */

const BURGERS = 'cat-burgere'

/** The five seeded burgers, in the seeded order. */
const SEEDED = ['Odin', 'Frigg', 'Ragnar', 'Thor', 'Glade Gris'] as const

describe('reorderDishes moves one item and disturbs nothing else', () => {
  it('moves the first item to the last position', () => {
    const result = reorderDishes(SEEDED, 0, 4)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual(['Frigg', 'Ragnar', 'Thor', 'Glade Gris', 'Odin'])
  })

  it('moves the last item to the first position', () => {
    const result = reorderDishes(SEEDED, 4, 0)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual(['Glade Gris', 'Odin', 'Frigg', 'Ragnar', 'Thor'])
  })

  it('moves a middle item to another middle position, in both directions', () => {
    const down = reorderDishes(SEEDED, 1, 3)
    const up = reorderDishes(SEEDED, 3, 1)

    expect(down.ok && down.items).toEqual(['Odin', 'Ragnar', 'Thor', 'Frigg', 'Glade Gris'])
    expect(up.ok && up.items).toEqual(['Odin', 'Thor', 'Frigg', 'Ragnar', 'Glade Gris'])
  })

  it('swaps two neighbours when the move is one step — the Flyt op / Flyt ned case', () => {
    // The phase brief's own worked example: Ragnar above Frigg.
    const up = reorderDishes(SEEDED, 2, 1)
    const down = reorderDishes(SEEDED, 1, 2)

    expect(up.ok && up.items).toEqual(['Odin', 'Ragnar', 'Frigg', 'Thor', 'Glade Gris'])
    expect(down.ok && down.items).toEqual(['Odin', 'Ragnar', 'Frigg', 'Thor', 'Glade Gris'])
  })

  it('treats a move to the same position as a success that changes nothing', () => {
    const result = reorderDishes(SEEDED, 2, 2)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([...SEEDED])
  })

  it('keeps every item, exactly once, whatever the move', () => {
    for (let from = 0; from < SEEDED.length; from += 1) {
      for (let to = 0; to < SEEDED.length; to += 1) {
        const result = reorderDishes(SEEDED, from, to)

        expect(result.ok).toBe(true)
        if (!result.ok) return

        expect([...result.items].sort()).toEqual([...SEEDED].sort())
        expect(new Set(result.items).size).toBe(SEEDED.length)
      }
    }
  })

  it('preserves the relative order of every item the move did not touch', () => {
    const result = reorderDishes(SEEDED, 0, 4)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const untouched = result.items.filter((name) => name !== 'Odin')
    expect(untouched).toEqual(['Frigg', 'Ragnar', 'Thor', 'Glade Gris'])
  })

  it('never mutates the array it was given', () => {
    const original = [...SEEDED]
    const before = [...original]

    const result = reorderDishes(original, 0, 4)

    expect(original).toEqual(before)
    expect(result.ok && result.items).not.toBe(original)
  })

  it('returns a fresh array even for a no-op', () => {
    const original = [...SEEDED]
    const result = reorderDishes(original, 1, 1)

    expect(result.ok && result.items).not.toBe(original)
  })

  it('is deterministic — the same three arguments always give the same list', () => {
    const first = reorderDishes(SEEDED, 3, 0)
    const second = reorderDishes(SEEDED, 3, 0)

    expect(first).toEqual(second)
  })
})

describe('reorderDishes refuses an impossible move rather than guessing', () => {
  it('refuses an empty list', () => {
    expect(reorderDishes([], 0, 0)).toEqual({ ok: false, reason: 'empty' })
  })

  it.each([-1, 5, 99])('refuses a source index outside the list (%i)', (from) => {
    expect(reorderDishes(SEEDED, from, 0)).toEqual({ ok: false, reason: 'from_out_of_range' })
  })

  it.each([-1, 5, 99])('refuses a destination outside the list (%i)', (to) => {
    expect(reorderDishes(SEEDED, 0, to)).toEqual({ ok: false, reason: 'to_out_of_range' })
  })

  it('refuses fractions, NaN and infinities rather than rounding them', () => {
    expect(reorderDishes(SEEDED, 1.5, 0).ok).toBe(false)
    expect(reorderDishes(SEEDED, 0, 2.5).ok).toBe(false)
    expect(reorderDishes(SEEDED, Number.NaN, 0).ok).toBe(false)
    expect(reorderDishes(SEEDED, 0, Number.POSITIVE_INFINITY).ok).toBe(false)
  })

  it('does not clamp an out-of-range destination to the end of the list', () => {
    // The whole point: a stale or forged "move to position 40" must not become "move to
    // the bottom", which would look like a successful move nobody asked for.
    const result = reorderDishes(SEEDED, 0, 40)

    expect(result.ok).toBe(false)
  })
})

/** A dish whose draft carries nothing and whose position is `at`. */
function published(id: string, at: number): OrderedDish {
  return { id, sortOrder: at, liveSortOrder: at, hasDraftSortOrder: false }
}

describe('sortOrderWrites turns an order into the fewest draft changes', () => {
  it('numbers a list 1, 2, 3 … with no gaps', () => {
    expect(sortOrderAt(0)).toBe(1)
    expect(sortOrderAt(4)).toBe(5)
  })

  it('writes only the dishes whose position actually moved', () => {
    // Odin, Frigg, Ragnar published at 1, 2, 3; Ragnar dragged above Frigg.
    const moved = [published('odin', 1), published('ragnar', 3), published('frigg', 2)]

    expect(sortOrderWrites(moved)).toEqual([
      { id: 'ragnar', action: 'set', sortOrder: 2 },
      { id: 'frigg', action: 'set', sortOrder: 3 },
    ])
  })

  it('writes nothing at all when the order already matches what is published', () => {
    expect(sortOrderWrites([published('a', 1), published('b', 2), published('c', 3)])).toEqual([])
  })

  it('normalises gappy published positions into clean ones', () => {
    const gappy = [published('a', 10), published('b', 20), published('c', 30)]

    expect(sortOrderWrites(gappy)).toEqual([
      { id: 'a', action: 'set', sortOrder: 1 },
      { id: 'b', action: 'set', sortOrder: 2 },
      { id: 'c', action: 'set', sortOrder: 3 },
    ])
  })

  it('leaves a draft alone when it already carries exactly the wanted position', () => {
    const ordered: OrderedDish[] = [
      { id: 'a', sortOrder: 1, liveSortOrder: 1, hasDraftSortOrder: false },
      // Already moved to position 2 by an earlier drag, and staying there.
      { id: 'b', sortOrder: 2, liveSortOrder: 3, hasDraftSortOrder: true },
      { id: 'c', sortOrder: 3, liveSortOrder: 2, hasDraftSortOrder: true },
    ]

    expect(sortOrderWrites(ordered)).toEqual([])
  })

  it('clears a draft position when the dish lands back where it is published', () => {
    // b was dragged up and is now dragged back down: its draft still says 2, and the
    // published value is 3, so the draft must stop carrying a position at all.
    const ordered: OrderedDish[] = [
      { id: 'a', sortOrder: 1, liveSortOrder: 1, hasDraftSortOrder: false },
      { id: 'c', sortOrder: 3, liveSortOrder: 2, hasDraftSortOrder: true },
      { id: 'b', sortOrder: 2, liveSortOrder: 3, hasDraftSortOrder: true },
    ]

    expect(sortOrderWrites(ordered)).toEqual([
      { id: 'c', action: 'clear' },
      { id: 'b', action: 'clear' },
    ])
  })

  it('does not clear a position the draft never carried', () => {
    const ordered: OrderedDish[] = [
      { id: 'a', sortOrder: 1, liveSortOrder: 1, hasDraftSortOrder: false },
      { id: 'b', sortOrder: 2, liveSortOrder: 2, hasDraftSortOrder: false },
    ]

    expect(sortOrderWrites(ordered)).toEqual([])
  })

  it('handles an empty section without producing a write', () => {
    expect(sortOrderWrites([])).toEqual([])
  })

  it('is the exact consequence of a reorderDishes result', () => {
    const dishes = [published('odin', 1), published('frigg', 2), published('ragnar', 3)]
    const moved = reorderDishes(dishes, 2, 1)

    expect(moved.ok).toBe(true)
    if (!moved.ok) return

    expect(sortOrderWrites(moved.items)).toEqual([
      { id: 'ragnar', action: 'set', sortOrder: 2 },
      { id: 'frigg', action: 'set', sortOrder: 3 },
    ])
  })
})

describe('dropIndex turns pixels into a position', () => {
  // Five rows, 100 px apart, midpoints at 50, 150, 250, 350, 450.
  const centres = [50, 150, 250, 350, 450]

  it('is the row’s own index while it has not moved', () => {
    expect(dropIndex(centres, 2, 250)).toBe(2)
  })

  it('counts every other row whose middle the dragged one has passed', () => {
    expect(dropIndex(centres, 0, 460)).toBe(4)
    expect(dropIndex(centres, 4, 40)).toBe(0)
    expect(dropIndex(centres, 1, 260)).toBe(2)
  })

  it('does not count the dragged row itself', () => {
    // Dragged from the top and hovering just past its own old middle: still first.
    expect(dropIndex(centres, 0, 60)).toBe(0)
  })

  it('treats an exact midpoint as not yet passed', () => {
    // The comparison is strict, so a row resting exactly on another’s middle has not
    // gone by it. That is the boundary, stated rather than left to chance.
    expect(dropIndex(centres, 0, 150)).toBe(0)
    expect(dropIndex(centres, 0, 151)).toBe(1)
  })

  it('never leaves the list, however far the pointer travels', () => {
    expect(dropIndex(centres, 2, -10_000)).toBe(0)
    expect(dropIndex(centres, 2, 10_000)).toBe(centres.length - 1)
  })

  it('agrees with reorderDishes about what a drop means', () => {
    const rows = ['a', 'b', 'c', 'd', 'e']

    // Drag "e" (index 4) up past the middles of "b", "c" and "d": it lands second.
    const target = dropIndex(centres, 4, 140)
    const moved = reorderDishes(rows, 4, target)

    expect(target).toBe(1)
    expect(moved.ok && moved.items).toEqual(['a', 'e', 'b', 'c', 'd'])
  })

  it('answers 0 for a list of one', () => {
    expect(dropIndex([100], 0, 4_000)).toBe(0)
  })
})

describe('orderFingerprint detects a list that has moved on', () => {
  const list = [
    { id: 'odin', updatedAt: '2026-08-29T12:00:00.000000+00:00' },
    { id: 'frigg', updatedAt: '2026-08-29T12:00:01.000000+00:00' },
    { id: 'ragnar', updatedAt: '2026-08-29T12:00:02.000000+00:00' },
  ]

  it('is stable for the same list', () => {
    expect(orderFingerprint(BURGERS, list)).toBe(orderFingerprint(BURGERS, list))
  })

  it('is sixteen lowercase hex characters — the shape the form parser accepts', () => {
    expect(orderFingerprint(BURGERS, list)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('changes when the order changes', () => {
    const swapped = [list[1], list[0], list[2]].filter((item) => item !== undefined)

    expect(orderFingerprint(BURGERS, swapped)).not.toBe(orderFingerprint(BURGERS, list))
  })

  it('changes when any dish in the list has been edited since', () => {
    const edited = list.map((item, index) =>
      index === 1 ? { ...item, updatedAt: '2026-08-29T13:00:00.000000+00:00' } : item,
    )

    expect(orderFingerprint(BURGERS, edited)).not.toBe(orderFingerprint(BURGERS, list))
  })

  it('changes when a dish joins or leaves the section', () => {
    const withNew = [...list, { id: 'loke', updatedAt: '2026-08-29T12:00:03.000000+00:00' }]

    expect(orderFingerprint(BURGERS, withNew)).not.toBe(orderFingerprint(BURGERS, list))
    expect(orderFingerprint(BURGERS, list.slice(0, 2))).not.toBe(orderFingerprint(BURGERS, list))
  })

  it('differs between two sections holding identically-named lists', () => {
    expect(orderFingerprint('cat-dessert', list)).not.toBe(orderFingerprint(BURGERS, list))
  })

  it('cannot be confused by ids and timestamps that run together', () => {
    // Separators matter: without them, ["ab","c"] and ["a","bc"] would hash the same.
    const a = [
      { id: 'ab', updatedAt: 'c' },
      { id: 'd', updatedAt: 'e' },
    ]
    const b = [
      { id: 'a', updatedAt: 'bc' },
      { id: 'd', updatedAt: 'e' },
    ]

    expect(orderFingerprint(BURGERS, a)).not.toBe(orderFingerprint(BURGERS, b))
  })

  it('gives an empty section its own fingerprint', () => {
    expect(orderFingerprint(BURGERS, [])).toMatch(/^[0-9a-f]{16}$/)
    expect(orderFingerprint(BURGERS, [])).not.toBe(orderFingerprint(BURGERS, list))
  })
})

describe('the sentences a person hears', () => {
  it('announces the dish, the new position and the size of the list', () => {
    expect(describeMove({ dishName: 'Odin', position: 3, total: 6 })).toBe(
      'Odin flyttet til plads 3 af 6.',
    )
  })

  it('names the handle after the dish it moves, and says which keys work', () => {
    expect(describeHandle({ dishName: 'Ragnar', position: 2, total: 5 })).toBe(
      'Flyt Ragnar — plads 2 af 5. Brug pil op og pil ned.',
    )
  })
})
