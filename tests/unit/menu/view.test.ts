import { describe, expect, it } from 'vitest'

import type { Dish, MenuCategory, MonthlyBurger, WeeklySpecial } from '@/lib/content/types'
import {
  buildMenuView,
  categoryAnchorId,
  formatServingDays,
  isMonthlyBurgerInWindow,
  selectFeaturedDishes,
} from '@/lib/menu/view'
import { copenhagenInstantOf } from '@/lib/time/copenhagen'
import { CONFIRMED_SCHEDULE, closedOverride } from '../fixtures/hours'

/**
 * The menu view model is where published content meets the two read-time rules the
 * database deliberately does not store: whether an item is sold out right now (§7b) and
 * whether Månedens burger falls inside its window today (§7d). Both are asserted here
 * against the restaurant's confirmed opening hours.
 */
const HOURS = { schedule: CONFIRMED_SCHEDULE, overrides: [] }

function dish(overrides: Partial<Dish> = {}): Dish {
  return {
    id: 'dish-odin',
    name: 'Odin',
    description: '200 g dry aged bøf.',
    secondaryNote: null,
    priceOre: 8900,
    labels: [],
    tapas: null,
    soldOutOn: null,
    ...overrides,
  }
}

function category(overrides: Partial<MenuCategory> = {}): MenuCategory {
  return {
    id: 'cat-burgere',
    slug: 'burgere',
    name: 'Burgere',
    intro: null,
    note: null,
    kind: 'dishes',
    dishes: [dish()],
    ...overrides,
  }
}

function weeklySpecial(overrides: Partial<WeeklySpecial> = {}): WeeklySpecial {
  return {
    isoYear: 2026,
    isoWeek: 35,
    days: ['wed', 'thu', 'fri'],
    name: 'Retnavn',
    description: null,
    priceSmallOre: null,
    priceLargeOre: null,
    soldOutOn: null,
    saturday: {
      enabled: false,
      name: null,
      description: null,
      priceOre: null,
      deadline: null,
      soldOutOn: null,
    },
    ...overrides,
  }
}

function monthlyBurger(overrides: Partial<MonthlyBurger> = {}): MonthlyBurger {
  return {
    name: 'Månedens burger',
    description: null,
    priceOre: 9900,
    startsOn: '2026-09-01',
    endsOn: '2026-09-30',
    soldOutOn: null,
    showOnHomepage: false,
    ...overrides,
  }
}

type MenuContent = Parameters<typeof buildMenuView>[0]

function content(overrides: Partial<MenuContent> = {}): MenuContent {
  return {
    categories: [category()],
    weeklySpecial: null,
    monthlyBurger: null,
    ...overrides,
  }
}

describe('categoryAnchorId', () => {
  it('derives the fragment a chip links to from the category slug', () => {
    expect(categoryAnchorId('pommes-og-snacks')).toBe('menu-pommes-og-snacks')
  })
})

describe('formatServingDays', () => {
  it('writes the days in schedule order, first word capitalised', () => {
    expect(formatServingDays(['fri', 'wed', 'thu'])).toBe('Onsdag · torsdag · fredag')
  })

  it('handles a single day', () => {
    expect(formatServingDays(['sat'])).toBe('Lørdag')
  })

  it('gives null when no days are set, so no empty line renders', () => {
    expect(formatServingDays([])).toBeNull()
  })
})

describe('isMonthlyBurgerInWindow', () => {
  const noon = (date: string) => copenhagenInstantOf(date, '12:00')

  it('is inclusive at both ends', () => {
    expect(isMonthlyBurgerInWindow(monthlyBurger(), noon('2026-09-01'))).toBe(true)
    expect(isMonthlyBurgerInWindow(monthlyBurger(), noon('2026-09-30'))).toBe(true)
  })

  it('excludes the day before and the day after', () => {
    expect(isMonthlyBurgerInWindow(monthlyBurger(), noon('2026-08-31'))).toBe(false)
    expect(isMonthlyBurgerInWindow(monthlyBurger(), noon('2026-10-01'))).toBe(false)
  })

  it('treats an open end as no boundary on that side', () => {
    expect(isMonthlyBurgerInWindow(monthlyBurger({ startsOn: null }), noon('2020-01-01'))).toBe(true)
    expect(isMonthlyBurgerInWindow(monthlyBurger({ endsOn: null }), noon('2030-01-01'))).toBe(true)
  })

  it('reads the boundary in Copenhagen, not in the host timezone', () => {
    expect(
      isMonthlyBurgerInWindow(monthlyBurger(), copenhagenInstantOf('2026-09-30', '23:30')),
    ).toBe(true)
    expect(
      isMonthlyBurgerInWindow(monthlyBurger(), copenhagenInstantOf('2026-10-01', '00:30')),
    ).toBe(false)
  })
})

describe('buildMenuView', () => {
  it('gives every category the anchor its chip links to', () => {
    const view = buildMenuView(content(), HOURS, copenhagenInstantOf('2026-09-02', '18:00'))
    expect(view.categories[0]?.anchorId).toBe('menu-burgere')
  })

  it('marks a dish sold out for the whole day it was marked on', () => {
    const view = buildMenuView(
      content({ categories: [category({ dishes: [dish({ soldOutOn: '2026-09-02' })] })] }),
      HOURS,
      copenhagenInstantOf('2026-09-02', '18:00'),
    )

    expect(view.categories[0]?.dishes[0]?.soldOut).toBe(true)
  })

  it('clears it at the next opening, not at midnight', () => {
    const marked = { categories: [category({ dishes: [dish({ soldOutOn: '2026-09-02' })] })] }

    const beforeOpening = buildMenuView(
      content(marked),
      HOURS,
      copenhagenInstantOf('2026-09-03', '09:00'),
    )
    const afterOpening = buildMenuView(
      content(marked),
      HOURS,
      copenhagenInstantOf('2026-09-03', '15:00'),
    )

    expect(beforeOpening.categories[0]?.dishes[0]?.soldOut).toBe(true)
    expect(afterOpening.categories[0]?.dishes[0]?.soldOut).toBe(false)
  })

  it('skips a day a published override closes, as the sold-out rule requires', () => {
    const view = buildMenuView(
      content({ categories: [category({ dishes: [dish({ soldOutOn: '2026-09-04' })] })] }),
      { schedule: CONFIRMED_SCHEDULE, overrides: [closedOverride('2026-09-05')] },
      copenhagenInstantOf('2026-09-05', '18:00'),
    )

    expect(view.categories[0]?.dishes[0]?.soldOut).toBe(true)
  })

  it('resolves Ugens ret and the Saturday menu independently', () => {
    const view = buildMenuView(
      content({
        weeklySpecial: weeklySpecial({
          soldOutOn: '2026-09-02',
          saturday: { ...weeklySpecial().saturday, enabled: true, name: 'Lørdagsret' },
        }),
      }),
      HOURS,
      copenhagenInstantOf('2026-09-02', '18:00'),
    )

    expect(view.weeklySpecial?.soldOut).toBe(true)
    expect(view.weeklySpecial?.saturday.soldOut).toBe(false)
    expect(view.weeklySpecial?.daysLabel).toBe('Onsdag · torsdag · fredag')
  })

  it('hides a published Månedens burger outside its window', () => {
    const inside = buildMenuView(
      content({ monthlyBurger: monthlyBurger() }),
      HOURS,
      copenhagenInstantOf('2026-09-15', '18:00'),
    )
    const outside = buildMenuView(
      content({ monthlyBurger: monthlyBurger() }),
      HOURS,
      copenhagenInstantOf('2026-10-15', '18:00'),
    )

    expect(inside.monthlyBurger?.name).toBe('Månedens burger')
    expect(outside.monthlyBurger).toBeNull()
  })

  it('does not mutate the content it is given', () => {
    const original = content({ categories: [category({ dishes: [dish()] })] })
    const snapshot = JSON.parse(JSON.stringify(original))

    buildMenuView(original, HOURS, copenhagenInstantOf('2026-09-02', '18:00'))

    expect(JSON.parse(JSON.stringify(original))).toEqual(snapshot)
  })
})

describe('selectFeaturedDishes', () => {
  const view = buildMenuView(
    content({
      categories: [
        category({ dishes: [dish({ id: 'a', name: 'Odin' }), dish({ id: 'b', name: 'Frigg' })] }),
      ],
    }),
    HOURS,
    copenhagenInstantOf('2026-09-02', '18:00'),
  )

  it('returns the dishes in the order the administration chose', () => {
    expect(selectFeaturedDishes(view.categories, ['b', 'a']).map((entry) => entry.name)).toEqual([
      'Frigg',
      'Odin',
    ])
  })

  it('drops a reference to a dish that no longer exists rather than leaving a hole', () => {
    expect(selectFeaturedDishes(view.categories, ['a', 'gone', 'b'])).toHaveLength(2)
  })

  it('returns nothing when no dish has been featured', () => {
    expect(selectFeaturedDishes(view.categories, [])).toEqual([])
  })
})
