import { describe, expect, it } from 'vitest'

import type { MonthlyBurger } from '@/lib/content/types'
import { isMonthlyWindowOpen, monthlyWindowPhase } from '@/lib/menu/monthly'
import {
  buildMenuView,
  selectHomepageMonthlyBurger,
  type MonthlyBurgerView,
} from '@/lib/menu/view'
import type { IsoDate } from '@/lib/time/calendar'

/**
 * Månedens burger — the date window the public site reads (§7d, §7e item 3).
 *
 * The window is one rule, in one place: `monthlyWindowPhase` decides, and the menu
 * view and the Forside both ask it. A boundary date can therefore never be inclusive
 * on one page and exclusive on the other, and "shown" cannot mean two things.
 *
 * `show_on_homepage` is a separate question from the window, and this suite keeps the
 * two apart: the toggle governs the Forside alone, and it cannot put a burger there
 * outside its own period.
 */

/** An instant at midday on a Copenhagen calendar date. */
function at(date: string): Date {
  return new Date(`${date}T12:00:00+02:00`)
}

// ---------------------------------------------------------------------------
// The date window — §7d
// ---------------------------------------------------------------------------


describe('monthlyWindowPhase', () => {
  it('is future before the start date', () => {
    expect(monthlyWindowPhase('2026-09-01', '2026-09-30', at('2026-08-31'))).toBe('future')
  })

  it('is active on the start date itself — inclusive at that end', () => {
    expect(monthlyWindowPhase('2026-09-01', '2026-09-30', at('2026-09-01'))).toBe('active')
  })

  it('is active on the end date itself — inclusive at that end too', () => {
    expect(monthlyWindowPhase('2026-09-01', '2026-09-30', at('2026-09-30'))).toBe('active')
  })

  it('is expired the day after the end date', () => {
    expect(monthlyWindowPhase('2026-09-01', '2026-09-30', at('2026-10-01'))).toBe('expired')
  })

  it('is unset when neither boundary is given', () => {
    expect(monthlyWindowPhase(null, null, at('2026-09-15'))).toBe('unset')
  })

  it('treats an open end as no boundary on that side', () => {
    expect(monthlyWindowPhase('2026-09-01', null, at('2030-01-01'))).toBe('active')
    expect(monthlyWindowPhase(null, '2026-09-30', at('1999-01-01'))).toBe('active')
  })

  it('reads the boundary in Copenhagen, not in the host timezone', () => {
    // 23:30 UTC on 31 August is already 01:30 on 1 September in Copenhagen, so the
    // window has opened. A UTC comparison would still say "future".
    expect(monthlyWindowPhase('2026-09-01', '2026-09-30', new Date('2026-08-31T23:30:00Z'))).toBe(
      'active',
    )
  })

  it('is open for exactly the two phases the public site shows', () => {
    expect(isMonthlyWindowOpen('unset')).toBe(true)
    expect(isMonthlyWindowOpen('active')).toBe(true)
    expect(isMonthlyWindowOpen('future')).toBe(false)
    expect(isMonthlyWindowOpen('expired')).toBe(false)
  })
})

describe('the window rule the menu and the Forside share', () => {
  /** The same burger, as `lib/content/load/menu.ts` hands it to the public view. */
  function publicBurger(overrides: Partial<MonthlyBurger> = {}): MonthlyBurger {
    return {
      name: 'Efterårsburgeren',
      description: null,
      priceOre: 12900,
      startsOn: '2026-09-01' as IsoDate,
      endsOn: '2026-09-30' as IsoDate,
      soldOutOn: null,
      showOnHomepage: true,
      image: null,
      ...overrides,
    }
  }

  const HOURS = {
    schedule: {
      mon: { closed: true as const },
      tue: { closed: true as const },
      wed: { from: '15:00', to: '20:00' },
      thu: { from: '15:00', to: '20:00' },
      fri: { from: '15:00', to: '20:00' },
      sat: { from: '17:00', to: '20:00' },
      sun: { from: '17:00', to: '20:00' },
    },
    overrides: [],
  }

  function shownOnMenu(now: Date): boolean {
    const view = buildMenuView(
      { categories: [], weeklySpecial: null, monthlyBurger: publicBurger() },
      HOURS,
      now,
    )

    return view.monthlyBurger !== null
  }

  it.each([
    ['2026-08-31', false],
    ['2026-09-01', true],
    ['2026-09-30', true],
    ['2026-10-01', false],
  ])('shows the burger on the menu on %s: %s', (date, expected) => {
    const now = at(date)

    expect(shownOnMenu(now)).toBe(expected)
    expect(isMonthlyWindowOpen(monthlyWindowPhase('2026-09-01', '2026-09-30', now))).toBe(expected)
  })
})

describe('the Forside toggle governs the Forside alone', () => {
  const inWindow: MonthlyBurgerView = {
    name: 'Efterårsburgeren',
    description: null,
    priceOre: 12900,
    startsOn: '2026-09-01' as IsoDate,
    endsOn: '2026-09-30' as IsoDate,
    soldOutOn: null,
    showOnHomepage: true,
    image: null,
    soldOut: false,
  }

  it('is what selectHomepageMonthlyBurger reads, and nothing else', () => {
    expect(selectHomepageMonthlyBurger(inWindow)).not.toBeNull()
    expect(selectHomepageMonthlyBurger({ ...inWindow, showOnHomepage: false })).toBeNull()
    // Sold out is not a condition: an active burger that ran out today stays on the
    // Forside carrying "Udsolgt i dag" (§7b, §7d).
    expect(selectHomepageMonthlyBurger({ ...inWindow, soldOut: true })).not.toBeNull()
    // Outside the window `buildMenuView` has already produced null, which the Forside
    // renders as nothing at all.
    expect(selectHomepageMonthlyBurger(null)).toBeNull()
  })
})
