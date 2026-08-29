import { describe, expect, it } from 'vitest'

import { MAX_OPENING_SEARCH_DAYS } from '@/lib/hours/engine'
import type { OpeningHoursOverride } from '@/lib/hours/types'
import { resolveSoldOut } from '@/lib/menu/availability'
import { addDays } from '@/lib/time/calendar'
import {
  ALWAYS_CLOSED_SCHEDULE,
  CONFIRMED_SCHEDULE,
  closedOverride,
  customOverride,
  withoutWeekday,
} from '../fixtures/hours'

/**
 * Technical plan §7b.
 *
 * The rule: an item marked "Udsolgt i dag" stays sold out for the whole Copenhagen
 * calendar date it was marked on, and clears at the opening instant of the first
 * opening day strictly after that date. Closed days are skipped; published overrides
 * count in both directions.
 *
 * Reference week: 2026-08-24 (Mon) – 2026-08-30 (Sun), Danish summer time (UTC+2).
 * Confirmed hours: Mon/Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00.
 */

const resolve = (
  soldOutOn: string | null,
  now: string,
  overrides: OpeningHoursOverride[] = [],
  schedule = CONFIRMED_SCHEDULE,
) => resolveSoldOut(soldOutOn, schedule, overrides, new Date(now))

describe('the worked examples from §7b', () => {
  it('Wednesday 18:00 → Thursday 15:00', () => {
    const result = resolve('2026-08-26', '2026-08-26T16:00:00Z')
    expect(result.soldOut).toBe(true)
    expect(result.clearsAt?.toISOString()).toBe('2026-08-27T13:00:00.000Z')
  })

  it('Wednesday 11:00, before opening → Thursday 15:00, NOT today at 15:00', () => {
    // The rule keys off the date it was marked, not "the next opening moment". This is
    // what keeps "Udsolgt i dag" true for the whole of today when the toggle is
    // flipped during prep.
    const result = resolve('2026-08-26', '2026-08-26T09:00:00Z')
    expect(result.clearsAt?.toISOString()).toBe('2026-08-27T13:00:00.000Z')
    expect(result.clearsAt?.toISOString()).not.toBe('2026-08-26T13:00:00.000Z')
    expect(result.soldOut).toBe(true)
  })

  it('stays sold out right through the rest of the day it was marked', () => {
    const marked = '2026-08-26'
    for (const now of [
      '2026-08-26T09:00:00Z', // 11:00 local, before opening
      '2026-08-26T13:00:00Z', // 15:00 local, today's opening instant
      '2026-08-26T17:59:59Z', // 19:59:59 local
      '2026-08-26T18:00:00Z', // 20:00 local, closing
      '2026-08-26T22:30:00Z', // 00:30 local the next day, still before Thursday 15:00
    ]) {
      expect(resolve(marked, now).soldOut).toBe(true)
    }
  })

  it('Friday 19:50 → Saturday 17:00', () => {
    const result = resolve('2026-08-28', '2026-08-28T17:50:00Z')
    expect(result.soldOut).toBe(true)
    expect(result.clearsAt?.toISOString()).toBe('2026-08-29T15:00:00.000Z')
  })

  it('Sunday, any time → Wednesday 15:00 (Monday and Tuesday are closed)', () => {
    for (const now of ['2026-08-30T06:00:00Z', '2026-08-30T15:30:00Z', '2026-08-30T20:00:00Z']) {
      const result = resolve('2026-08-30', now)
      expect(result.soldOut).toBe(true)
      expect(result.clearsAt?.toISOString()).toBe('2026-09-02T13:00:00.000Z')
    }
  })

  it('Monday, a closed day → Wednesday 15:00', () => {
    const result = resolve('2026-08-24', '2026-08-24T12:00:00Z')
    expect(result.soldOut).toBe(true)
    expect(result.clearsAt?.toISOString()).toBe('2026-08-26T13:00:00.000Z')
  })

  it('Friday, with a published override closing Saturday → Sunday 17:00', () => {
    const result = resolve('2026-08-28', '2026-08-28T17:50:00Z', [closedOverride('2026-08-29')])
    expect(result.soldOut).toBe(true)
    expect(result.clearsAt?.toISOString()).toBe('2026-08-30T15:00:00.000Z')
  })
})

describe('overrides count in both directions', () => {
  it('an override opening a normally closed Monday becomes the reset day', () => {
    const result = resolve('2026-08-30', '2026-08-30T18:00:00Z', [
      customOverride('2026-08-31', '12:00', '16:00'),
    ])
    // Without the override this would be Wednesday 15:00 local (13:00Z).
    expect(result.clearsAt?.toISOString()).toBe('2026-08-31T10:00:00.000Z') // 12:00 local
  })

  it('an override changing the hours of the reset day moves the reset instant', () => {
    const result = resolve('2026-08-26', '2026-08-26T16:00:00Z', [
      customOverride('2026-08-27', '17:00', '20:00'),
    ])
    expect(result.clearsAt?.toISOString()).toBe('2026-08-27T15:00:00.000Z') // 17:00 local
  })

  it('consecutive closure overrides are all skipped', () => {
    const result = resolve('2026-08-26', '2026-08-26T16:00:00Z', [
      closedOverride('2026-08-27'),
      closedOverride('2026-08-28'),
      closedOverride('2026-08-29'),
    ])
    expect(result.clearsAt?.toISOString()).toBe('2026-08-30T15:00:00.000Z') // Sunday 17:00
  })

  it('ignores a draft override', () => {
    const draft: OpeningHoursOverride = { ...closedOverride('2026-08-27'), status: 'draft' }
    const result = resolve('2026-08-26', '2026-08-26T16:00:00Z', [draft])
    expect(result.clearsAt?.toISOString()).toBe('2026-08-27T13:00:00.000Z')
  })
})

describe('the reset instant itself', () => {
  // Marked Wednesday 2026-08-26; resets Thursday 15:00 local = 13:00Z.
  const marked = '2026-08-26'
  const reset = '2026-08-27T13:00:00.000Z'

  it('is still sold out one millisecond before the reset', () => {
    expect(resolve(marked, '2026-08-27T12:59:59.999Z').soldOut).toBe(true)
  })

  it('is available at exactly the reset instant', () => {
    expect(resolve(marked, reset).soldOut).toBe(false)
  })

  it('is available one millisecond after the reset', () => {
    expect(resolve(marked, '2026-08-27T13:00:00.001Z').soldOut).toBe(false)
  })

  it('reports the same reset instant whether or not it has passed', () => {
    expect(resolve(marked, '2026-08-27T12:00:00Z').clearsAt?.toISOString()).toBe(reset)
    expect(resolve(marked, '2026-08-29T12:00:00Z').clearsAt?.toISOString()).toBe(reset)
  })

  it('does not depend on when it is asked', () => {
    const instants = ['2026-08-26T09:00:00Z', '2026-08-26T23:00:00Z', '2027-01-01T00:00:00Z']
    const answers = instants.map((now) => resolve(marked, now).clearsAt?.toISOString())
    expect(new Set(answers).size).toBe(1)
  })
})

describe('nothing is marked', () => {
  it('is available, with no reset', () => {
    expect(resolve(null, '2026-08-26T16:00:00Z')).toEqual({ soldOut: false, clearsAt: null })
  })

  it('is available even when the restaurant never opens', () => {
    expect(resolve(null, '2026-08-26T16:00:00Z', [], ALWAYS_CLOSED_SCHEDULE)).toEqual({
      soldOut: false,
      clearsAt: null,
    })
  })
})

describe('daylight saving', () => {
  it('spring forward: marked on the Sunday clocks go forward → Wednesday 15:00 CEST', () => {
    const result = resolve('2026-03-29', '2026-03-29T18:00:00Z')
    expect(result.soldOut).toBe(true)
    expect(result.clearsAt?.toISOString()).toBe('2026-04-01T13:00:00.000Z')
  })

  it('autumn back: marked on the Sunday clocks go back → Wednesday 15:00 CET', () => {
    const result = resolve('2026-10-25', '2026-10-25T19:00:00Z')
    expect(result.soldOut).toBe(true)
    expect(result.clearsAt?.toISOString()).toBe('2026-10-28T14:00:00.000Z')
  })

  it('both DST Sundays reset at 15:00 on the wall clock, an hour apart in UTC', () => {
    // The promise is a wall-clock opening, so the UTC instants differ by exactly the
    // change in offset. A fixed-offset implementation would make these identical.
    const spring = resolve('2026-03-29', '2026-03-29T18:00:00Z').clearsAt
    const autumn = resolve('2026-10-25', '2026-10-25T19:00:00Z').clearsAt
    expect(spring?.toISOString().slice(11, 16)).toBe('13:00')
    expect(autumn?.toISOString().slice(11, 16)).toBe('14:00')
  })

  it('marked the day before the spring transition → Sunday 17:00 CEST', () => {
    const result = resolve('2026-03-28', '2026-03-28T19:00:00Z')
    expect(result.clearsAt?.toISOString()).toBe('2026-03-29T15:00:00.000Z')
  })

  it('marked the day before the autumn transition → Sunday 17:00 CET', () => {
    const result = resolve('2026-10-24', '2026-10-24T19:00:00Z')
    expect(result.clearsAt?.toISOString()).toBe('2026-10-25T16:00:00.000Z')
  })

  it('clears correctly around the transition instant itself', () => {
    // Marked Saturday 2026-10-24, resets Sunday 17:00 CET = 16:00Z, which is after the
    // 01:00Z changeover — so the offset used must be the post-transition one.
    expect(resolve('2026-10-24', '2026-10-25T15:59:59Z').soldOut).toBe(true)
    expect(resolve('2026-10-24', '2026-10-25T16:00:00Z').soldOut).toBe(false)
  })
})

describe('no opening day inside the search window', () => {
  it('stays sold out with no reset when every day is closed', () => {
    expect(resolve('2026-08-26', '2026-08-26T16:00:00Z', [], ALWAYS_CLOSED_SCHEDULE)).toEqual({
      soldOut: true,
      clearsAt: null,
    })
  })

  it('stays sold out however long it has been', () => {
    expect(resolve('2026-08-26', '2027-08-26T16:00:00Z', [], ALWAYS_CLOSED_SCHEDULE).soldOut).toBe(
      true,
    )
  })

  it('finds an opening on the last day of the 60-day window', () => {
    // The scan starts the day after the item was marked, so the window is
    // soldOutOn + 1 … soldOutOn + 60.
    const lastDay = addDays('2026-08-27', MAX_OPENING_SEARCH_DAYS - 1)
    const result = resolve(
      '2026-08-26',
      '2026-08-26T16:00:00Z',
      [customOverride(lastDay, '15:00', '20:00')],
      ALWAYS_CLOSED_SCHEDULE,
    )
    expect(result.soldOut).toBe(true)
    expect(result.clearsAt).not.toBeNull()
  })

  it('does not find an opening one day beyond the window', () => {
    const justOutside = addDays('2026-08-27', MAX_OPENING_SEARCH_DAYS)
    const result = resolve(
      '2026-08-26',
      '2026-08-26T16:00:00Z',
      [customOverride(justOutside, '15:00', '20:00')],
      ALWAYS_CLOSED_SCHEDULE,
    )
    expect(result).toEqual({ soldOut: true, clearsAt: null })
  })
})

describe('purity and input validation', () => {
  it('does not mutate the schedule or the overrides', () => {
    const schedule = structuredClone(CONFIRMED_SCHEDULE)
    const overrides = [closedOverride('2026-08-29')]
    const scheduleBefore = structuredClone(schedule)
    const overridesBefore = structuredClone(overrides)

    resolveSoldOut('2026-08-28', schedule, overrides, new Date('2026-08-28T17:50:00Z'))

    expect(schedule).toEqual(scheduleBefore)
    expect(overrides).toEqual(overridesBefore)
  })

  it('returns a fresh Date each call', () => {
    const first = resolve('2026-08-26', '2026-08-26T16:00:00Z')
    first.clearsAt?.setUTCFullYear(1999)
    expect(resolve('2026-08-26', '2026-08-26T16:00:00Z').clearsAt?.toISOString()).toBe(
      '2026-08-27T13:00:00.000Z',
    )
  })

  it('rejects a malformed sold-out date', () => {
    expect(() => resolve('26-08-2026', '2026-08-26T16:00:00Z')).toThrow(/date/i)
    expect(() => resolve('2026-02-30', '2026-02-26T16:00:00Z')).toThrow(/date/i)
  })

  it('rejects an invalid instant', () => {
    expect(() =>
      resolveSoldOut('2026-08-26', CONFIRMED_SCHEDULE, [], new Date('nonsense')),
    ).toThrow(/instant/i)
  })

  it('rejects a schedule that is missing a day', () => {
    expect(() =>
      resolveSoldOut(
        '2026-08-24',
        withoutWeekday(CONFIRMED_SCHEDULE, 'wed'),
        [],
        new Date('2026-08-24T12:00:00Z'),
      ),
    ).toThrow(/wed/)
  })
})
