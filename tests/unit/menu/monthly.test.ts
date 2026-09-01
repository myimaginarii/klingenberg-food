import { describe, expect, it } from 'vitest'

import {
  describeExpiredPublishWarning,
  describeMonthlyPending,
  describeMonthlyState,
  describeScheduledPublish,
  isMonthlyWindowOpen,
  isOrderedWindow,
  monthlyAdminState,
  monthlyDraftDelta,
  monthlyDraftWrite,
  monthlyPublishOutlook,
  monthlyWindowPhase,
  MONTHLY_DRAFT_FIELDS,
  MONTHLY_EDITOR_FIELDS,
  MONTHLY_HOMEPAGE_HELP,
  type MonthlyBurgerValues,
} from '@/lib/menu/monthly'
import {
  buildMenuView,
  selectHomepageMonthlyBurger,
  type MonthlyBurgerView,
} from '@/lib/menu/view'
import type { MonthlyBurger } from '@/lib/content/types'
import type { IsoDate } from '@/lib/time/calendar'

/**
 * Månedens burger — the administration's rules; phase 6B, §4, §6, §7d, §7e item 3.
 *
 * Four properties this suite exists for, all of which would otherwise only be noticed by
 * a restaurant whose burger was on the wrong page:
 *
 *   1. **The window is one rule.** The administration's computed state and the public
 *      site's "is it shown?" come from the same function, so a boundary date can never
 *      be inclusive on one page and exclusive on the other.
 *   2. **Three separate concepts stay separate.** Configured, in-window and
 *      `show_on_homepage` answer three different questions; collapsing any two would
 *      make the administration unable to say why a published burger is invisible.
 *   3. **A save never erases a field it does not own.** `image_id` in particular: no
 *      editor owns it before phase 10.
 *   4. **The withdrawn 1ah wording does not ship.** The helper line is asserted by its
 *      content, and the old slot-3 sentence is asserted to be absent.
 */

/** A published burger, in database casing. Overridden per test. */
function published(overrides: Partial<MonthlyBurgerValues> = {}): MonthlyBurgerValues {
  return {
    name: 'Efterårsburgeren',
    description: 'Bøf, bacon, syltede løg og rygeostcreme.',
    price_ore: 12900,
    image_id: null,
    starts_on: '2026-09-01' as IsoDate,
    ends_on: '2026-09-30' as IsoDate,
    show_on_homepage: true,
    ...overrides,
  }
}

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

describe('the public site and the administration share one window rule', () => {
  /** The same burger, as `lib/content/menu.ts` hands it to the public view. */
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
  ])('agrees with the admin state on %s', (date, expected) => {
    const now = at(date)

    expect(shownOnMenu(now)).toBe(expected)
    expect(monthlyAdminState(published(), now).onMenu).toBe(expected)
  })
})

describe('isOrderedWindow', () => {
  it('accepts a window whose end is on or after its start', () => {
    expect(isOrderedWindow('2026-09-01', '2026-09-30')).toBe(true)
    expect(isOrderedWindow('2026-09-01', '2026-09-01')).toBe(true)
  })

  it('refuses a window that ends before it starts — the column CHECK, stated early', () => {
    expect(isOrderedWindow('2026-09-30', '2026-09-01')).toBe(false)
  })

  it('accepts a window with only one end, which is ordered by definition', () => {
    expect(isOrderedWindow('2026-09-01', null)).toBe(true)
    expect(isOrderedWindow(null, '2026-09-30')).toBe(true)
    expect(isOrderedWindow(null, null)).toBe(true)
  })

  it('does not require the window to sit inside one calendar month', () => {
    // §7d describes a window, not a month. A burger that runs from mid-September to
    // mid-October is a perfectly ordinary thing to enter.
    expect(isOrderedWindow('2026-09-15', '2026-10-14')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The computed state — §7d
// ---------------------------------------------------------------------------

describe('monthlyAdminState keeps three questions apart', () => {
  it('an unconfigured burger is on neither surface', () => {
    const state = monthlyAdminState(published({ name: null }), at('2026-09-15'))

    expect(state.configured).toBe(false)
    expect(state.onMenu).toBe(false)
    expect(state.onHomepage).toBe(false)
    // The setting is still what it is. It is a setting, not an outcome.
    expect(state.showOnHomepage).toBe(true)
  })

  it('a name of only whitespace is not a burger', () => {
    expect(monthlyAdminState(published({ name: '   ' }), at('2026-09-15')).configured).toBe(false)
  })

  it('an active burger with the toggle on is on both surfaces', () => {
    const state = monthlyAdminState(published(), at('2026-09-15'))

    expect(state.onMenu).toBe(true)
    expect(state.onHomepage).toBe(true)
  })

  it('the toggle governs the forside alone — the menu card is not gated by it', () => {
    const state = monthlyAdminState(published({ show_on_homepage: false }), at('2026-09-15'))

    expect(state.onMenu).toBe(true)
    expect(state.showOnHomepage).toBe(false)
    expect(state.onHomepage).toBe(false)
  })

  it('the toggle cannot put a burger on the forside outside its window', () => {
    for (const date of ['2026-08-31', '2026-10-01']) {
      const state = monthlyAdminState(published(), at(date))

      expect(state.showOnHomepage).toBe(true)
      expect(state.onMenu).toBe(false)
      expect(state.onHomepage).toBe(false)
    }
  })

  it('matches selectHomepageMonthlyBurger, which is what actually renders the section', () => {
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

describe('describeMonthlyState — §7d’s three sentences', () => {
  it('says a future window with the date it starts on', () => {
    const report = describeMonthlyState(published(), at('2026-08-20'))

    expect(report.badge).toBe('Offentliggjort')
    expect(report.sentence).toBe('Offentliggjort — vises fra 1. september')
    expect(report.tone).toBe('neutral')
  })

  it('says an active window with the date it ends on', () => {
    const report = describeMonthlyState(published(), at('2026-09-15'))

    expect(report.badge).toBe('Vises nu')
    expect(report.sentence).toBe('Vises nu — til og med 30. september')
    expect(report.tone).toBe('success')
  })

  it('says an expired window with the date it ended on', () => {
    const report = describeMonthlyState(published(), at('2026-10-05'))

    expect(report.badge).toBe('Udløbet')
    expect(report.sentence).toBe('Udløbet den 30. september')
    expect(report.tone).toBe('warning')
  })

  it('says "Ikke udfyldt" for the empty singleton — the seeded state', () => {
    const report = describeMonthlyState(
      published({ name: null, description: null, price_ore: null, starts_on: null, ends_on: null }),
      at('2026-09-15'),
    )

    expect(report.badge).toBe('Ikke udfyldt')
    expect(report.sentence).toContain('Ikke udfyldt')
    expect(report.homepage).toContain('intet afsnit')
  })

  it('says a burger with no end date will stay where it is', () => {
    const report = describeMonthlyState(
      published({ starts_on: null, ends_on: null }),
      at('2026-09-15'),
    )

    expect(report.badge).toBe('Vises nu')
    expect(report.sentence).toContain('ingen slutdato')
  })

  it('derives the month from the date rather than hard-coding one', () => {
    for (const [date, month] of [
      ['2026-01-01', 'januar'],
      ['2026-03-01', 'marts'],
      ['2026-05-01', 'maj'],
      ['2026-12-01', 'december'],
    ] as const) {
      const report = describeMonthlyState(
        published({ starts_on: date as IsoDate, ends_on: null }),
        at('2025-12-01'),
      )

      expect(report.sentence).toContain(month)
    }
  })

  it('adds the year only when the date is not in the current Copenhagen year', () => {
    const sameYear = describeMonthlyState(published(), at('2026-08-20'))
    expect(sameYear.sentence).toBe('Offentliggjort — vises fra 1. september')

    const nextYear = describeMonthlyState(
      published({ starts_on: '2027-01-01' as IsoDate, ends_on: '2027-01-31' as IsoDate }),
      at('2026-12-20'),
    )
    expect(nextYear.sentence).toBe('Offentliggjort — vises fra 1. januar 2027')
  })

  it('says the two consequences separately, and names the toggle when it is the reason', () => {
    const off = describeMonthlyState(published({ show_on_homepage: false }), at('2026-09-15'))

    expect(off.menu).toContain('Vises på menusiden')
    expect(off.homepage).toContain('Vis på forsiden')
    expect(off.homepage).toContain('slået fra')
  })

  it('does not blame the toggle when the window is what is stopping it', () => {
    const future = describeMonthlyState(published(), at('2026-08-20'))

    expect(future.menu).toContain('1. september')
    expect(future.homepage).toContain('1. september')
    expect(future.homepage).not.toContain('slået fra')
  })

  it('is a statement about the published row, so it never mentions a draft', () => {
    const report = describeMonthlyState(published(), at('2026-09-15'))

    for (const text of [report.sentence, report.menu, report.homepage]) {
      expect(text.toLowerCase()).not.toContain('kladde')
    }
  })
})

// ---------------------------------------------------------------------------
// The homepage toggle's wording — §7e item 3
// ---------------------------------------------------------------------------

describe('the withdrawn 1ah helper wording', () => {
  it('is replaced by the approved sentence about its own section', () => {
    expect(MONTHLY_HOMEPAGE_HELP).toContain('sit eget afsnit på forsiden')
  })

  it('never claims one of the three featured slots', () => {
    expect(MONTHLY_HOMEPAGE_HELP).not.toContain('Optager en af de tre pladser')
  })
})

// ---------------------------------------------------------------------------
// Draft integrity — §4
// ---------------------------------------------------------------------------

describe('monthlyDraftDelta', () => {
  it('holds only the fields that actually changed', () => {
    const delta = monthlyDraftDelta({ ...published(), price_ore: 13900 }, published())

    expect(delta).toEqual({ price_ore: 13900 })
  })

  it('is empty when nothing changed, so a save can clear the draft entirely', () => {
    expect(monthlyDraftDelta(published(), published())).toEqual({})
  })

  it('records an explicit null as an edit that clears a value', () => {
    expect(monthlyDraftDelta({ description: null }, published())).toEqual({ description: null })
  })

  it('records the homepage toggle like any other field', () => {
    expect(monthlyDraftDelta({ show_on_homepage: false }, published())).toEqual({
      show_on_homepage: false,
    })
  })

  it('never carries image_id, which no editor owns before phase 10', () => {
    expect(MONTHLY_EDITOR_FIELDS).not.toContain('image_id')

    const delta = monthlyDraftDelta(
      { image_id: '00000000-0000-4000-8000-000000000000' } as Partial<MonthlyBurgerValues>,
      published(),
    )

    expect(delta).toEqual({})
  })

  it('never carries a sold-out field, which is not a draft field at all', () => {
    expect(MONTHLY_DRAFT_FIELDS).not.toContain('sold_out_on')
  })
})

describe('monthlyDraftWrite', () => {
  it('clears the fields that no longer differ, so a reverted edit stops being pending', () => {
    const write = monthlyDraftWrite({ ...published(), name: 'Ny burger' }, published())

    expect(write.values).toEqual({ name: 'Ny burger' })
    expect(write.clear).toEqual([
      'description',
      'price_ore',
      'starts_on',
      'ends_on',
      'show_on_homepage',
    ])
  })

  it('mentions image_id in neither direction, so a pending image survives a price save', () => {
    const write = monthlyDraftWrite({ ...published(), price_ore: 13900 }, published())

    expect(Object.keys(write.values)).not.toContain('image_id')
    expect(write.clear).not.toContain('image_id')
  })

  it('can be narrowed to the three fields "Ryd felterne" owns', () => {
    const write = monthlyDraftWrite({ name: null, description: null, price_ore: null }, published(), [
      'name',
      'description',
      'price_ore',
    ])

    expect(write.values).toEqual({ name: null, description: null, price_ore: null })
    // The period and the toggle are named in neither direction, so a pending change to
    // either survives a clear.
    expect(write.clear).toEqual([])
  })
})

describe('describeMonthlyPending', () => {
  it('says nothing when nothing is pending', () => {
    expect(describeMonthlyPending([])).toBeNull()
  })

  it('names one field in the singular', () => {
    expect(describeMonthlyPending(['price_ore'])).toBe('Ny pris afventer offentliggørelse')
  })

  it('names several in schema order, however they arrived', () => {
    expect(describeMonthlyPending(['ends_on', 'name'])).toBe(
      'Nye navn og slutdato afventer offentliggørelse',
    )
  })

  it('names the homepage toggle as the ordinary draft field it is', () => {
    expect(describeMonthlyPending(['show_on_homepage'])).toBe(
      'Ny visning på forsiden afventer offentliggørelse',
    )
  })

  it('ignores a stored key the schema does not know', () => {
    expect(describeMonthlyPending(['sold_out_on', 'updated_by'])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Publish-time warnings — §7d
// ---------------------------------------------------------------------------

describe('monthlyPublishOutlook', () => {
  it('is immediate for a burger whose window has already begun', () => {
    expect(monthlyPublishOutlook(published(), at('2026-09-15'))).toBe('immediate')
  })

  it('is scheduled for a future start — allowed, and never an error', () => {
    expect(monthlyPublishOutlook(published(), at('2026-08-20'))).toBe('scheduled')
  })

  it('is expired for a window that has already finished', () => {
    expect(monthlyPublishOutlook(published(), at('2026-10-05'))).toBe('expired')
  })

  it('is incomplete when there is no name, whatever the dates say', () => {
    expect(monthlyPublishOutlook(published({ name: null }), at('2026-10-05'))).toBe('incomplete')
  })

  it('is immediate when there is no window at all', () => {
    expect(
      monthlyPublishOutlook(published({ starts_on: null, ends_on: null }), at('2026-09-15')),
    ).toBe('immediate')
  })
})

describe('the publish-time sentences', () => {
  it('names the period that has already finished', () => {
    expect(describeExpiredPublishWarning(published(), at('2026-10-05'))).toContain(
      '30. september',
    )
  })

  it('still warns when only a start date is set and nothing ended', () => {
    expect(
      describeExpiredPublishWarning(published({ ends_on: null }), at('2026-10-05')),
    ).toBe('Denne periode er allerede forbi — den vises ikke på hjemmesiden.')
  })

  it('states exactly when a scheduled burger will appear', () => {
    expect(describeScheduledPublish('2026-09-01' as IsoDate, at('2026-08-20'))).toBe(
      'Månedens burger er offentliggjort — den vises fra 1. september.',
    )
  })

  it('says nothing about a date when there is no start date', () => {
    expect(describeScheduledPublish(null, at('2026-08-20'))).toBe(
      'Månedens burger er offentliggjort.',
    )
  })
})
