import { describe, expect, it } from 'vitest'

import {
  addIsoWeeks,
  compareIsoWeeks,
  currentIsoWeek,
  formatIsoWeekToken,
  isoWeekOf,
  isoWeeksInYear,
  isSameIsoWeek,
  isValidIsoWeek,
  mondayOfIsoWeek,
  nextIsoWeek,
  parseIsoWeekToken,
} from '@/lib/time/iso-week'

/**
 * ISO-8601 week numbering — technical plan §4, §9; phase 6A.
 *
 * `weekly_special.iso_year` / `iso_week` is the pair the whole screen turns on, and the
 * two weeks of the year it is easy to get wrong are the two the restaurant will
 * eventually meet: the last days of December and the first days of January. So the cases
 * here are the boundary ones by design, taken from the standard's own definition rather
 * than from a runtime that has no ISO-week accessor to check against.
 *
 * The DST tests phase 2 already owns are deliberately **not** repeated. A week number is
 * a calendar fact, and `lib/time/calendar.ts` does its arithmetic in a timezone-free
 * space; the only place an instant enters this module is `currentIsoWeek`, which is
 * asserted here for the one thing it adds — that "this week" is Copenhagen's answer and
 * not the host machine's.
 */

describe('isoWeeksInYear', () => {
  it.each([
    // 1 January is a Thursday.
    [2015, 53],
    [2026, 53],
    // A leap year whose 1 January is a Wednesday, so 31 December is the extra Thursday.
    [2020, 53],
    [2004, 53],
    // Everything else.
    [2024, 52],
    [2025, 52],
    [2027, 52],
    [2028, 52],
  ])('%i has %i ISO weeks', (year, weeks) => {
    expect(isoWeeksInYear(year)).toBe(weeks)
  })

  it('refuses a year outside the column CHECK', () => {
    expect(() => isoWeeksInYear(1999)).toThrow(TypeError)
    expect(() => isoWeeksInYear(3000)).toThrow(TypeError)
  })
})

describe('isoWeekOf', () => {
  it('numbers an ordinary mid-year week', () => {
    // Wednesday 26 August 2026 is in week 35 — the week the seed data carries.
    expect(isoWeekOf('2026-08-26')).toEqual({ year: 2026, week: 35 })
  })

  it('puts the week containing 4 January in week 1', () => {
    expect(isoWeekOf('2027-01-04')).toEqual({ year: 2027, week: 1 })
  })

  it('gives late December days the following ISO year when their Thursday does', () => {
    // 31 December 2029 is a Monday whose Thursday falls in 2030.
    expect(isoWeekOf('2029-12-31')).toEqual({ year: 2030, week: 1 })
    expect(isoWeekOf('2030-01-01')).toEqual({ year: 2030, week: 1 })
  })

  it('gives early January days the previous ISO year when their Thursday does', () => {
    // 1 January 2027 is a Friday; its Thursday is 31 December 2026, in week 53.
    expect(isoWeekOf('2027-01-01')).toEqual({ year: 2026, week: 53 })
    expect(isoWeekOf('2027-01-03')).toEqual({ year: 2026, week: 53 })
    expect(isoWeekOf('2027-01-04')).toEqual({ year: 2027, week: 1 })
  })

  it('numbers the last week of a 53-week year as 53', () => {
    expect(isoWeekOf('2026-12-31')).toEqual({ year: 2026, week: 53 })
  })

  it('gives every day of one week the same number', () => {
    const week = isoWeekOf('2026-08-24')

    for (const date of [
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]) {
      expect(isoWeekOf(date)).toEqual(week)
    }

    // …and the next day starts a new one.
    expect(isoWeekOf('2026-08-31')).toEqual({ year: week.year, week: week.week + 1 })
  })
})

describe('mondayOfIsoWeek', () => {
  it('is the inverse of isoWeekOf', () => {
    expect(mondayOfIsoWeek({ year: 2026, week: 35 })).toBe('2026-08-24')
    expect(isoWeekOf(mondayOfIsoWeek({ year: 2026, week: 53 }))).toEqual({
      year: 2026,
      week: 53,
    })
  })

  it('refuses a week the year does not have', () => {
    expect(() => mondayOfIsoWeek({ year: 2027, week: 53 })).toThrow(TypeError)
  })
})

describe('nextIsoWeek', () => {
  it('advances inside a year', () => {
    expect(nextIsoWeek({ year: 2026, week: 35 })).toEqual({ year: 2026, week: 36 })
  })

  it('advances across a year boundary into week 1', () => {
    // 2026 has 53 weeks, so week 53 is the last one and week 1 of 2027 follows it.
    expect(nextIsoWeek({ year: 2026, week: 53 })).toEqual({ year: 2027, week: 1 })
  })

  it('advances into week 53 in a year that has one', () => {
    expect(nextIsoWeek({ year: 2026, week: 52 })).toEqual({ year: 2026, week: 53 })
  })

  it('skips straight to week 1 from week 52 in a 52-week year', () => {
    expect(nextIsoWeek({ year: 2025, week: 52 })).toEqual({ year: 2026, week: 1 })
  })
})

describe('addIsoWeeks', () => {
  it('moves backwards as well as forwards', () => {
    expect(addIsoWeeks({ year: 2027, week: 1 }, -1)).toEqual({ year: 2026, week: 53 })
    expect(addIsoWeeks({ year: 2026, week: 1 }, -1)).toEqual({ year: 2025, week: 52 })
  })

  it('is the identity for zero', () => {
    expect(addIsoWeeks({ year: 2026, week: 35 }, 0)).toEqual({ year: 2026, week: 35 })
  })

  it('composes: nine weeks forward is nine single steps', () => {
    let stepped = { year: 2026, week: 48 }
    for (let taken = 0; taken < 9; taken += 1) stepped = nextIsoWeek(stepped)

    expect(addIsoWeeks({ year: 2026, week: 48 }, 9)).toEqual(stepped)
    expect(stepped).toEqual({ year: 2027, week: 4 })
  })
})

describe('currentIsoWeek', () => {
  it('answers in Copenhagen, not in UTC', () => {
    // 23:30 UTC on Sunday 3 January 2027 is already 00:30 on Monday the 4th in
    // Copenhagen — the first day of week 1. Read as UTC it would still be week 53 of
    // 2026, which is the mistake this function exists to prevent.
    const instant = new Date('2027-01-03T23:30:00Z')

    expect(currentIsoWeek(instant)).toEqual({ year: 2027, week: 1 })
  })

  it('is the week of the Copenhagen date', () => {
    expect(currentIsoWeek(new Date('2026-08-26T12:00:00Z'))).toEqual({
      year: 2026,
      week: 35,
    })
  })
})

describe('the week token', () => {
  it('round-trips', () => {
    expect(formatIsoWeekToken({ year: 2026, week: 7 })).toBe('2026-W07')
    expect(parseIsoWeekToken('2026-W07')).toEqual({ year: 2026, week: 7 })
    expect(parseIsoWeekToken('2026-W53')).toEqual({ year: 2026, week: 53 })
  })

  it('refuses anything that is not a week that exists', () => {
    // A week 53 in a 52-week year is the case a naive parser lets through.
    expect(parseIsoWeekToken('2027-W53')).toBeNull()
    expect(parseIsoWeekToken('2026-W00')).toBeNull()
    expect(parseIsoWeekToken('2026-W54')).toBeNull()
    expect(parseIsoWeekToken('1999-W01')).toBeNull()
    expect(parseIsoWeekToken('2026-36')).toBeNull()
    expect(parseIsoWeekToken('uge 36')).toBeNull()
    expect(parseIsoWeekToken('')).toBeNull()
    expect(parseIsoWeekToken(null)).toBeNull()
    expect(parseIsoWeekToken(36)).toBeNull()
  })
})

describe('comparison', () => {
  it('orders chronologically across a year boundary', () => {
    expect(compareIsoWeeks({ year: 2026, week: 53 }, { year: 2027, week: 1 })).toBeLessThan(0)
    expect(compareIsoWeeks({ year: 2026, week: 36 }, { year: 2026, week: 35 })).toBeGreaterThan(0)
    expect(compareIsoWeeks({ year: 2026, week: 35 }, { year: 2026, week: 35 })).toBe(0)
  })

  it('compares both halves, never just the number', () => {
    expect(isSameIsoWeek({ year: 2026, week: 1 }, { year: 2027, week: 1 })).toBe(false)
    expect(isSameIsoWeek({ year: 2026, week: 1 }, { year: 2026, week: 1 })).toBe(true)
    expect(isSameIsoWeek(null, null)).toBe(true)
    expect(isSameIsoWeek(null, { year: 2026, week: 1 })).toBe(false)
  })

  it('validates a pair against the year it names', () => {
    expect(isValidIsoWeek({ year: 2026, week: 53 })).toBe(true)
    expect(isValidIsoWeek({ year: 2027, week: 53 })).toBe(false)
    expect(isValidIsoWeek({ year: 2026, week: 0 })).toBe(false)
    expect(isValidIsoWeek({ year: 2026, week: 1.5 })).toBe(false)
  })
})
