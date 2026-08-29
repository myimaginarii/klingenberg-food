import { describe, expect, it } from 'vitest'

import { describeAvailability } from '@/lib/menu/admin'
import { soldOutDateFor } from '@/lib/menu/sold-out'

import {
  ALWAYS_CLOSED_SCHEDULE,
  CONFIRMED_SCHEDULE,
  closedOverride,
  customOverride,
} from '../fixtures/hours'

/**
 * The immediate Udsolgt path's integration points — technical plan §6, §7b.
 *
 * **Not a second copy of the §7b matrix.** `tests/unit/menu/availability.test.ts`
 * already asserts every worked example, both DST transitions and the 60-day cap against
 * `resolveSoldOut` itself; repeating them here would double the maintenance and prove
 * nothing new. What is asserted below is only what phase 5C added on top of that
 * engine, and each of those is a seam where a mistake would be invisible in the
 * engine's own tests:
 *
 *   1. **which date is written** when somebody presses Udsolgt — today's, in
 *      Copenhagen, taken from an instant and never from the host's clock;
 *   2. **that the admin helper is the engine's answer**, worded — including the
 *      `clearsAt === null` sentence and the silence when a dish is available;
 *   3. **that the reset sentence is computed**, so a published override changes it
 *      without anything being rewritten or re-stored.
 *
 * Reference week: 2026-08-24 (Mon) – 2026-08-30 (Sun), Danish summer time (UTC+2).
 * Confirmed hours: Mon/Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00.
 */

describe('the date an immediate change writes (§7b, migration rule 4)', () => {
  it('marks a dish sold out on today’s Copenhagen date', () => {
    // 16:00 UTC on the Wednesday is 18:00 in Copenhagen — the same calendar day.
    expect(soldOutDateFor(true, new Date('2026-08-26T16:00:00Z'))).toBe('2026-08-26')
  })

  it('reads the Copenhagen date, not UTC, on either side of local midnight', () => {
    // 23:30 UTC in summer is already 01:30 the next morning in Copenhagen. A dish sold
    // out then belongs to the 27th, and a UTC reading would date it to the 26th — which
    // would clear it a whole service early.
    expect(soldOutDateFor(true, new Date('2026-08-26T23:30:00Z'))).toBe('2026-08-27')

    // And in winter, 23:30 UTC is 00:30 — the same boundary at a different offset.
    expect(soldOutDateFor(true, new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15')

    // 22:30 UTC in summer is 00:30 local: still the next day.
    expect(soldOutDateFor(true, new Date('2026-08-26T22:30:00Z'))).toBe('2026-08-27')
    // 21:30 UTC in summer is 23:30 local: still today.
    expect(soldOutDateFor(true, new Date('2026-08-26T21:30:00Z'))).toBe('2026-08-26')
  })

  it('writes nothing at all when a dish is made available again', () => {
    // NULL means available (§4). Returning to Tilgængelig clears the column rather than
    // storing a second date that would have to be interpreted.
    expect(soldOutDateFor(false, new Date('2026-08-26T16:00:00Z'))).toBeNull()
  })
})

describe('the reset helper the administration shows (§7b)', () => {
  const describe_ = (soldOutOn: string | null, now: string, overrides = [] as ReturnType<typeof closedOverride>[]) =>
    describeAvailability(soldOutOn, CONFIRMED_SCHEDULE, overrides, new Date(now))

  it('says when the marking lifts, in the design’s own words', () => {
    // The owner's own example: sold out on a Sunday, Monday and Tuesday closed.
    expect(describe_('2026-08-30', '2026-08-30T18:00:00Z')).toEqual({
      soldOut: true,
      resetText: 'Nulstilles automatisk, når I åbner igen — onsdag kl. 15:00',
    })
  })

  it('names the day and the hour the schedule actually has, not a fixed pair', () => {
    // Marked on a Friday, so the reset is Saturday — which opens at 17:00, not 15:00.
    expect(describe_('2026-08-28', '2026-08-28T17:50:00Z').resetText).toBe(
      'Nulstilles automatisk, når I åbner igen — lørdag kl. 17:00',
    )
  })

  it('follows a published override that closes the reset day', () => {
    // Friday, with Saturday closed by an override: the reset moves to Sunday 17:00.
    // Nothing was rewritten — the same stored date now means a different instant,
    // which is the whole reason no expiry is stored (§4).
    expect(
      describe_('2026-08-28', '2026-08-28T17:50:00Z', [closedOverride('2026-08-29')]).resetText,
    ).toBe('Nulstilles automatisk, når I åbner igen — søndag kl. 17:00')
  })

  it('follows a published override that opens a normally closed day', () => {
    expect(
      describeAvailability(
        '2026-08-30',
        CONFIRMED_SCHEDULE,
        [customOverride('2026-08-31', '12:00', '20:00')],
        new Date('2026-08-30T18:00:00Z'),
      ).resetText,
    ).toBe('Nulstilles automatisk, når I åbner igen — mandag kl. 12:00')
  })

  it('says so plainly when there is no opening day to reset at', () => {
    expect(
      describeAvailability(
        '2026-08-26',
        ALWAYS_CLOSED_SCHEDULE,
        [],
        new Date('2026-08-26T16:00:00Z'),
      ),
    ).toEqual({
      soldOut: true,
      resetText: 'Nulstilles ikke automatisk — I har ingen åbningsdage planlagt',
    })
  })

  it('gives an available dish no helper text at all', () => {
    // There is nothing pending about an available dish, so there is nothing to say.
    expect(describe_(null, '2026-08-26T16:00:00Z')).toEqual({ soldOut: false, resetText: null })
  })

  it('gives a dish whose marking has already lifted no helper text either', () => {
    // Marked on Wednesday, read on Thursday evening: the reset instant has passed, so
    // the dish is available again even though the stale date is still stored (§9).
    expect(describe_('2026-08-26', '2026-08-27T17:00:00Z')).toEqual({
      soldOut: false,
      resetText: null,
    })
  })
})
