import { describe, expect, it } from 'vitest'

import type { Dish, MenuCategory, MonthlyBurger, WeeklySpecial } from '@/lib/content/types'
import {
  buildMenuView,
  categoryAnchorId,
  formatServingDays,
  isMonthlyBurgerInWindow,
  selectFeaturedDishes,
  selectHomepageMonthlyBurger,
  selectHomepageMonthlyBurgerSection,
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
    featured: false,
    image: null,
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
    image: null,
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
    image: null,
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
  /**
   * The Forside band reads the menu itself: a dish carries "Vis på forsiden", and the
   * band shows every dish that does. There is no list of ids anywhere, so there is
   * nothing that can point at a dish that is gone — the cases below are the whole of
   * what an editor can do to the band, and none of them needs a second file.
   */
  function featuredNames(...dishes: readonly Dish[]): string[] {
    const view = buildMenuView(
      content({
        categories: [
          category({ id: 'cat-burgere', slug: 'burgere', dishes: dishes.slice(0, 2) }),
          category({ id: 'cat-andre', slug: 'andre', name: 'Andre', dishes: dishes.slice(2) }),
        ],
      }),
      HOURS,
      copenhagenInstantOf('2026-09-02', '18:00'),
    )

    return selectFeaturedDishes(view.categories).map((entry) => entry.name)
  }

  it('returns the featured dishes in the order the menu is written', () => {
    expect(
      featuredNames(
        dish({ id: 'a', name: 'Odin', featured: true }),
        dish({ id: 'b', name: 'Frigg', featured: true }),
        dish({ id: 'c', name: 'Ragnar', featured: true }),
      ),
    ).toEqual(['Odin', 'Frigg', 'Ragnar'])
  })

  it('leaves out a dish that is not featured — missing and false are the same answer', () => {
    expect(
      featuredNames(
        dish({ id: 'a', name: 'Odin', featured: true }),
        dish({ id: 'b', name: 'Frigg', featured: false }),
        dish({ id: 'c', name: 'Ragnar' }),
      ),
    ).toEqual(['Odin'])
  })

  it('simply loses the card when a featured dish is taken off the menu', () => {
    expect(
      featuredNames(
        dish({ id: 'a', name: 'Odin', featured: true }),
        dish({ id: 'c', name: 'Ragnar', featured: true }),
      ),
    ).toEqual(['Odin', 'Ragnar'])
  })

  it('gains a card the moment a dish is switched on', () => {
    expect(
      featuredNames(
        dish({ id: 'a', name: 'Odin', featured: true }),
        dish({ id: 'b', name: 'Frigg' }),
        dish({ id: 'c', name: 'Ragnar', featured: true }),
      ),
    ).toEqual(['Odin', 'Ragnar'])
  })

  it('counts nothing: none, one and four are all valid bands', () => {
    expect(featuredNames(dish({ id: 'a', name: 'Odin' }), dish({ id: 'b', name: 'Frigg' }))).toEqual(
      [],
    )
    expect(featuredNames(dish({ id: 'a', name: 'Odin', featured: true }))).toEqual(['Odin'])
    expect(
      featuredNames(
        dish({ id: 'a', name: 'Odin', featured: true }),
        dish({ id: 'b', name: 'Frigg', featured: true }),
        dish({ id: 'c', name: 'Ragnar', featured: true }),
        dish({ id: 'd', name: 'Thor', featured: true }),
      ),
    ).toEqual(['Odin', 'Frigg', 'Ragnar', 'Thor'])
  })
})

describe('selectHomepageMonthlyBurger', () => {
  /**
   * The Forside's own question, asked of a burger that `buildMenuView` has already
   * judged to be inside its window. Each of the six cases the restaurant asked for is
   * asserted end to end from published content, so a regression in either layer fails
   * here rather than only in a browser.
   */
  function homepageBurger(overrides: Partial<MonthlyBurger>, now: string) {
    const view = buildMenuView(
      content({ monthlyBurger: monthlyBurger({ showOnHomepage: true, ...overrides }) }),
      HOURS,
      copenhagenInstantOf(now, '18:00'),
    )

    return selectHomepageMonthlyBurger(view.monthlyBurger)
  }

  it('shows an active burger the administration put on the Forside', () => {
    expect(homepageBurger({}, '2026-09-15')?.name).toBe('Månedens burger')
  })

  it('hides it when "Vis på forsiden" is off, even inside the window', () => {
    expect(homepageBurger({ showOnHomepage: false }, '2026-09-15')).toBeNull()
  })

  it('hides it before starts_on', () => {
    expect(homepageBurger({}, '2026-08-31')).toBeNull()
  })

  it('hides it after ends_on', () => {
    expect(homepageBurger({}, '2026-10-01')).toBeNull()
  })

  it('keeps a sold-out burger on the Forside, carrying its sold-out state', () => {
    const burger = homepageBurger({ soldOutOn: '2026-09-15' }, '2026-09-15')

    expect(burger).not.toBeNull()
    expect(burger?.soldOut).toBe(true)
  })

  it('is null when no burger is configured at all', () => {
    const view = buildMenuView(content(), HOURS, copenhagenInstantOf('2026-09-15', '18:00'))

    expect(selectHomepageMonthlyBurger(view.monthlyBurger)).toBeNull()
  })

  it('never takes one of the featured slots away from a normal dish', () => {
    const view = buildMenuView(
      content({
        categories: [
          category({
            dishes: [
              dish({ id: 'a', name: 'Odin', featured: true }),
              dish({ id: 'b', name: 'Frigg', featured: true }),
              dish({ id: 'c', name: 'Ragnar', featured: true }),
            ],
          }),
        ],
        monthlyBurger: monthlyBurger({ showOnHomepage: true }),
      }),
      HOURS,
      copenhagenInstantOf('2026-09-15', '18:00'),
    )

    expect(selectFeaturedDishes(view.categories).map((d) => d.name)).toEqual([
      'Odin',
      'Frigg',
      'Ragnar',
    ])
    expect(selectHomepageMonthlyBurger(view.monthlyBurger)).not.toBeNull()
  })
})

describe('selectHomepageMonthlyBurgerSection', () => {
  /**
   * The three states the Forside section can be in, asked end to end from published
   * content. The empty card is the answer whenever *no* burger is inside its window —
   * whatever the reason — and "hidden" is reserved for a burger that is active but kept
   * off the Forside, where the empty card would contradict the menu page.
   */
  function section(monthly: MonthlyBurger | null, now: string) {
    const view = buildMenuView(
      content({ monthlyBurger: monthly }),
      HOURS,
      copenhagenInstantOf(now, '18:00'),
    )

    return selectHomepageMonthlyBurgerSection(view.monthlyBurger)
  }

  it('draws an active burger the administration put on the Forside', () => {
    const result = section(monthlyBurger({ showOnHomepage: true }), '2026-09-15')

    expect(result.kind).toBe('burger')
    if (result.kind === 'burger') expect(result.burger.name).toBe('Månedens burger')
  })

  it('draws the empty card when nothing is configured', () => {
    expect(section(null, '2026-09-15')).toEqual({ kind: 'empty' })
  })

  it('draws the empty card before starts_on and after ends_on', () => {
    expect(section(monthlyBurger({ showOnHomepage: true }), '2026-08-31')).toEqual({ kind: 'empty' })
    expect(section(monthlyBurger({ showOnHomepage: true }), '2026-10-01')).toEqual({ kind: 'empty' })
  })

  it('hides the section, rather than saying there is none, for an active burger kept off the Forside', () => {
    expect(section(monthlyBurger({ showOnHomepage: false }), '2026-09-15')).toEqual({ kind: 'hidden' })
  })

  it('keeps a sold-out burger in the section, carrying its sold-out state', () => {
    const result = section(
      monthlyBurger({ showOnHomepage: true, soldOutOn: '2026-09-15' }),
      '2026-09-15',
    )

    expect(result.kind).toBe('burger')
    if (result.kind === 'burger') expect(result.burger.soldOut).toBe(true)
  })
})
