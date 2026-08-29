import { describe, expect, it } from 'vitest'

import {
  assignableCategories,
  describePendingChange,
  groupDishesBySection,
  mayHoldDishes,
  dishDraftDelta,
  nextSortOrderIn,
  type AdminCategory,
  type AdminDish,
  type DishDraftValues,
} from '@/lib/menu/admin'
import type { MenuDraftField } from '@/lib/schemas/menu'

/**
 * The menu administration's domain rules — design 1r / 1y, technical plan §4, §6.
 *
 * The category restrictions are the important half of this file. They are enforced on
 * the server, against the sections the server read, so they are asserted here as rules
 * rather than as a property of a dropdown.
 */

const BURGERS: AdminCategory = {
  id: 'cat-burgere',
  slug: 'burgere',
  name: 'Burgere',
  kind: 'dishes',
  hasDraft: false,
}

const WEEKLY: AdminCategory = {
  id: 'cat-ugens-ret',
  slug: 'ugens-ret',
  name: 'Ugens ret',
  kind: 'weekly_special',
  hasDraft: false,
}

const DESSERT: AdminCategory = {
  id: 'cat-dessert',
  slug: 'dessert',
  name: 'Dessert',
  kind: 'dishes',
  hasDraft: false,
}

function dish(overrides: Partial<AdminDish> & Pick<AdminDish, 'id' | 'name'>): AdminDish {
  const base: AdminDish = {
    categoryId: BURGERS.id,
    description: null,
    secondaryNote: null,
    priceOre: 8900,
    labels: [],
    sortOrder: 1,
    soldOutOn: null,
    isNewDraft: false,
    hasDraft: false,
    draftFields: [],
    updatedAt: '2026-08-29T12:00:00.000000+00:00',
    live: {
      category_id: BURGERS.id,
      name: overrides.name,
      description: null,
      secondary_note: null,
      price_ore: 8900,
      labels: [],
    },
    ...overrides,
  }

  return base
}

describe('grouping and counts', () => {
  it('lists every section, in the sections’ own order, even when empty', () => {
    const sections = groupDishesBySection([BURGERS, WEEKLY, DESSERT], [])

    expect(sections.map((section) => section.category.slug)).toEqual([
      'burgere',
      'ugens-ret',
      'dessert',
    ])
    expect(sections.map((section) => section.dishCount)).toEqual([0, 0, 0])
  })

  it('counts the dishes in each section', () => {
    const sections = groupDishesBySection(
      [BURGERS, DESSERT],
      [
        dish({ id: 'a', name: 'Odin' }),
        dish({ id: 'b', name: 'Frigg' }),
        dish({ id: 'c', name: 'Is', categoryId: DESSERT.id }),
      ],
    )

    expect(sections.map((section) => section.dishCount)).toEqual([2, 1])
  })

  it('orders dishes by sort_order, then by name', () => {
    const sections = groupDishesBySection(
      [BURGERS],
      [
        dish({ id: 'c', name: 'Thor', sortOrder: 2 }),
        dish({ id: 'b', name: 'Frigg', sortOrder: 1 }),
        dish({ id: 'a', name: 'Balder', sortOrder: 1 }),
      ],
    )

    expect(sections[0]?.dishes.map((found) => found.name)).toEqual(['Balder', 'Frigg', 'Thor'])
  })

  it('groups a moved dish under the section its draft moves it to', () => {
    // The administration shows what the next publish will produce (§6). The public menu
    // keeps the dish where it is until somebody presses Offentliggør, and the row says
    // so — see `describePendingChange` below.
    const moved = dish({
      id: 'a',
      name: 'Odin',
      categoryId: DESSERT.id,
      hasDraft: true,
      draftFields: ['category_id'],
    })

    const sections = groupDishesBySection([BURGERS, DESSERT], [moved])

    expect(sections[0]?.dishCount).toBe(0)
    expect(sections[1]?.dishes.map((found) => found.id)).toEqual(['a'])
  })

  it('drops a dish whose section does not exist rather than inventing one', () => {
    const sections = groupDishesBySection(
      [BURGERS],
      [dish({ id: 'a', name: 'Vildfaren', categoryId: 'cat-nonexistent' })],
    )

    expect(sections[0]?.dishCount).toBe(0)
  })
})

describe('which sections may hold a dish', () => {
  it('allows an ordinary section', () => {
    expect(mayHoldDishes(BURGERS)).toBe(true)
  })

  it('refuses Ugens ret — it is the weekly_special row, not a list of dishes', () => {
    expect(mayHoldDishes(WEEKLY)).toBe(false)
  })

  it('offers only ordinary sections as a destination', () => {
    expect(assignableCategories([BURGERS, WEEKLY, DESSERT]).map((found) => found.slug)).toEqual([
      'burgere',
      'dessert',
    ])
  })

  it('has no section for Månedens burger at all, so a dish cannot be moved into it', () => {
    // Månedens burger is the `monthly_burger` singleton (§4, §7d) and has no row in
    // `menu_categories`. The guard is "the target must be a section that holds dishes",
    // so a value that names no section is refused by the same line that refuses Ugens
    // ret — there is no special case to forget.
    const sections = [BURGERS, WEEKLY, DESSERT]
    const allowed = new Set(assignableCategories(sections).map((found) => found.id))

    expect(allowed.has('maanedens-burger')).toBe(false)
    expect(allowed.has(WEEKLY.id)).toBe(false)
  })
})

describe('where a moved dish lands', () => {
  it('goes to the end of the destination section’s order', () => {
    const existing = [
      dish({ id: 'a', name: 'Is', sortOrder: 1 }),
      dish({ id: 'b', name: 'Kage', sortOrder: 4 }),
    ]

    expect(nextSortOrderIn(existing)).toBe(5)
  })

  it('starts at 1 in an empty section', () => {
    expect(nextSortOrderIn([])).toBe(1)
  })
})

describe('what a pending row says', () => {
  it('says nothing when there is no draft', () => {
    expect(describePendingChange(dish({ id: 'a', name: 'Odin' }))).toBeNull()
  })

  it('names the one field that changed', () => {
    expect(
      describePendingChange(
        dish({ id: 'a', name: 'Ragnar', hasDraft: true, draftFields: ['price_ore'] }),
      ),
    ).toBe('Ny pris afventer offentliggørelse')
  })

  it('names several fields in schema order', () => {
    const fields: MenuDraftField[] = ['price_ore', 'name', 'labels']

    expect(
      describePendingChange(dish({ id: 'a', name: 'Odin', hasDraft: true, draftFields: fields })),
    ).toBe('Nye navn, pris og mærkater afventer offentliggørelse')
  })

  it('says a section change is pending, so a moved dish explains itself', () => {
    expect(
      describePendingChange(
        dish({ id: 'a', name: 'Odin', hasDraft: true, draftFields: ['category_id'] }),
      ),
    ).toBe('Ny sektion afventer offentliggørelse')
  })

  it('says a new dish is new, which is a different situation from a pending edit', () => {
    expect(
      describePendingChange(
        dish({ id: 'a', name: 'Ny ret', isNewDraft: true, hasDraft: true, draftFields: ['name'] }),
      ),
    ).toBe('Ny ret — vises først på hjemmesiden, når den offentliggøres')
  })

  it('falls back to a plain sentence for a draft that changes nothing nameable', () => {
    expect(describePendingChange(dish({ id: 'a', name: 'Odin', hasDraft: true }))).toBe(
      'Ændringer afventer offentliggørelse',
    )
  })
})


describe('reducing a submitted dish to what it changed', () => {
  const live: DishDraftValues = {
    category_id: BURGERS.id,
    name: 'Glade Gris',
    description: 'Pulled pork, puffede svær, rødkål.',
    secondary_note: 'Som menu 124 kr.',
    price_ore: 8900,
    labels: ['Pulled pork'],
  }

  it('produces nothing when nothing changed — a no-op save is not a draft', () => {
    expect(dishDraftDelta({ ...live, labels: [...live.labels] }, live)).toEqual({})
  })

  it('produces only the field that moved', () => {
    expect(dishDraftDelta({ ...live, price_ore: 9500 }, live)).toEqual({ price_ore: 9500 })
  })

  it('keeps a cleared optional field, because null is an edit', () => {
    expect(dishDraftDelta({ ...live, secondary_note: null }, live)).toEqual({
      secondary_note: null,
    })
  })

  it('notices a label added, removed or reordered', () => {
    expect(dishDraftDelta({ ...live, labels: ['Pulled pork', 'Populær'] }, live)).toEqual({
      labels: ['Pulled pork', 'Populær'],
    })
    expect(dishDraftDelta({ ...live, labels: [] }, live)).toEqual({ labels: [] })
    expect(
      dishDraftDelta(
        { ...live, labels: ['Populær', 'Pulled pork'] },
        { ...live, labels: ['Pulled pork', 'Populær'] },
      ),
    ).toEqual({ labels: ['Populær', 'Pulled pork'] })
  })

  it('does not report a label change when only the price moved', () => {
    // The phase brief's own rule, at the layer that decides what a draft contains.
    expect(dishDraftDelta({ ...live, price_ore: 9500 }, live)).not.toHaveProperty('labels')
  })

  it('reports a section change', () => {
    expect(dishDraftDelta({ ...live, category_id: DESSERT.id }, live)).toEqual({
      category_id: DESSERT.id,
    })
  })
})
