import { describe, expect, it } from 'vitest'

import {
  COPENHAGEN_TIME_ZONE,
  copenhagenDateOf,
  copenhagenInstantOf,
  copenhagenUtcOffsetMs,
  copenhagenWallClock,
} from '@/lib/time/copenhagen'

/**
 * Every assertion below is written as an absolute instant (`…Z`) on one side and a
 * Copenhagen wall-clock reading on the other, so the expected values do not depend on
 * the machine running the suite. `tests/unit/time/host-timezone.test.ts` proves that
 * independence by re-running a cross-section under other host timezones.
 */

const HOUR = 3_600_000

/** Danish civil time is CET (UTC+1) in winter and CEST (UTC+2) in summer. */
describe('copenhagenUtcOffsetMs', () => {
  it.each([
    ['midwinter', '2026-01-15T12:00:00Z', 1],
    ['midsummer', '2026-07-15T12:00:00Z', 2],
    ['the last instant of winter time', '2026-03-29T00:59:59Z', 1],
    ['the first instant of summer time', '2026-03-29T01:00:00Z', 2],
    ['the last instant of summer time', '2026-10-25T00:59:59Z', 2],
    ['the first instant of winter time again', '2026-10-25T01:00:00Z', 1],
  ])('is %s', (_label, instant, hours) => {
    expect(copenhagenUtcOffsetMs(new Date(instant))).toBe(hours * HOUR)
  })
})

describe('copenhagenWallClock', () => {
  it.each([
    ['a winter afternoon', '2026-01-15T14:00:00Z', '2026-01-15', '15:00', 'thu'],
    ['a summer afternoon', '2026-07-15T13:00:00Z', '2026-07-15', '15:00', 'wed'],
    ['a local date that has rolled over before UTC', '2026-07-14T22:30:00Z', '2026-07-15', '00:30', 'wed'],
    ['a local date that is still the UTC date', '2026-01-01T00:30:00Z', '2026-01-01', '01:30', 'thu'],
    ['spring forward: 01:59 exists', '2026-03-29T00:59:00Z', '2026-03-29', '01:59', 'sun'],
    ['spring forward: the clock jumps to 03:00', '2026-03-29T01:00:00Z', '2026-03-29', '03:00', 'sun'],
    ['autumn back: 02:59 in summer time', '2026-10-25T00:59:00Z', '2026-10-25', '02:59', 'sun'],
    ['autumn back: 02:00 repeats in winter time', '2026-10-25T01:00:00Z', '2026-10-25', '02:00', 'sun'],
  ])('reads %s', (_label, instant, date, time, weekday) => {
    expect(copenhagenWallClock(new Date(instant))).toEqual({ date, time, weekday })
  })

  it('never reports hour 24 for local midnight', () => {
    // Some ICU builds format midnight as "24" under hour12:false; the module pins
    // hourCycle explicitly, so this cannot regress into an off-by-one-day bug.
    expect(copenhagenWallClock(new Date('2026-06-14T22:00:00Z'))).toEqual({
      date: '2026-06-15',
      time: '00:00',
      weekday: 'mon',
    })
  })

  it('rejects an invalid Date', () => {
    expect(() => copenhagenWallClock(new Date('not a date'))).toThrow(/instant/i)
  })
})

describe('copenhagenDateOf', () => {
  it('is the local date, not the UTC date', () => {
    expect(copenhagenDateOf(new Date('2026-07-14T22:30:00Z'))).toBe('2026-07-15')
    expect(copenhagenDateOf(new Date('2026-07-15T21:30:00Z'))).toBe('2026-07-15')
  })
})

describe('copenhagenInstantOf', () => {
  it.each([
    ['a winter opening', '2026-01-15', '15:00', '2026-01-15T14:00:00.000Z'],
    ['a summer opening', '2026-07-15', '15:00', '2026-07-15T13:00:00.000Z'],
    ['a summer closing', '2026-07-15', '20:00', '2026-07-15T18:00:00.000Z'],
    ['local midnight', '2026-01-01', '00:00', '2025-12-31T23:00:00.000Z'],
    ['a time carrying Postgres seconds', '2026-01-15', '15:00:00', '2026-01-15T14:00:00.000Z'],
    ['the last winter minute before the spring gap', '2026-03-29', '01:59', '2026-03-29T00:59:00.000Z'],
    ['the first summer minute after the spring gap', '2026-03-29', '03:00', '2026-03-29T01:00:00.000Z'],
    ['an afternoon on the 23-hour day', '2026-03-29', '17:00', '2026-03-29T15:00:00.000Z'],
    ['an afternoon on the 25-hour day', '2026-10-25', '17:00', '2026-10-25T16:00:00.000Z'],
    ['the first opening after autumn back', '2026-10-28', '15:00', '2026-10-28T14:00:00.000Z'],
  ])('converts %s', (_label, date, time, expected) => {
    expect(copenhagenInstantOf(date, time).toISOString()).toBe(expected)
  })

  it('round-trips every unambiguous hour of both transition days', () => {
    for (const date of ['2026-03-29', '2026-10-25']) {
      for (let hour = 4; hour < 24; hour += 1) {
        const time = `${String(hour).padStart(2, '0')}:00`
        expect(copenhagenWallClock(copenhagenInstantOf(date, time))).toEqual(
          expect.objectContaining({ date, time }),
        )
      }
    }
  })

  describe('the hour that does not exist (spring forward)', () => {
    it('resolves a skipped wall clock forward past the gap', () => {
      // 02:30 never happens on 2026-03-29. The documented rule is to move forward by
      // the length of the gap, landing on 03:30 local — the convention Temporal calls
      // "compatible".
      const instant = copenhagenInstantOf('2026-03-29', '02:30')
      expect(instant.toISOString()).toBe('2026-03-29T01:30:00.000Z')
      expect(copenhagenWallClock(instant).time).toBe('03:30')
    })
  })

  describe('the hour that happens twice (autumn back)', () => {
    it('resolves an ambiguous wall clock to the first occurrence', () => {
      // 02:30 happens twice on 2026-10-25: once in CEST, once in CET. The documented
      // rule is to take the earlier instant.
      const instant = copenhagenInstantOf('2026-10-25', '02:30')
      expect(instant.toISOString()).toBe('2026-10-25T00:30:00.000Z')
      expect(copenhagenWallClock(instant).time).toBe('02:30')
    })

    it('keeps wall-clock order across the repeated hour', () => {
      const before = copenhagenInstantOf('2026-10-25', '01:30')
      const repeated = copenhagenInstantOf('2026-10-25', '02:30')
      const after = copenhagenInstantOf('2026-10-25', '03:30')
      expect(before.getTime()).toBeLessThan(repeated.getTime())
      expect(repeated.getTime()).toBeLessThan(after.getTime())
    })
  })

  it('measures the true length of both transition days', () => {
    const springStart = copenhagenInstantOf('2026-03-29', '00:00')
    const springEnd = copenhagenInstantOf('2026-03-30', '00:00')
    expect(springEnd.getTime() - springStart.getTime()).toBe(23 * HOUR)

    const autumnStart = copenhagenInstantOf('2026-10-25', '00:00')
    const autumnEnd = copenhagenInstantOf('2026-10-26', '00:00')
    expect(autumnEnd.getTime() - autumnStart.getTime()).toBe(25 * HOUR)
  })

  it('rejects malformed input rather than guessing', () => {
    expect(() => copenhagenInstantOf('2026-02-30', '15:00')).toThrow(/date/i)
    expect(() => copenhagenInstantOf('2026-01-15', '25:00')).toThrow(/time/i)
  })
})

describe('COPENHAGEN_TIME_ZONE', () => {
  it('states the business timezone once', () => {
    expect(COPENHAGEN_TIME_ZONE).toBe('Europe/Copenhagen')
  })
})
