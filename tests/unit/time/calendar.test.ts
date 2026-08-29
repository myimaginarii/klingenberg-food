import { describe, expect, it } from 'vitest'

import {
  WEEKDAY_KEYS,
  addDays,
  formatIsoDate,
  formatIsoTime,
  minutesOfDay,
  parseIsoDate,
  parseIsoTime,
  weekdayOf,
} from '@/lib/time/calendar'

/**
 * The civil-calendar layer knows nothing about timezones. Every assertion here is
 * therefore true in every host timezone by construction — there is no instant, no
 * `Date` arithmetic and no offset anywhere in the module under test.
 */

describe('parseIsoDate', () => {
  it('reads a well-formed date', () => {
    expect(parseIsoDate('2026-08-29')).toEqual({ year: 2026, month: 8, day: 29 })
  })

  it('accepts a leap day in a leap year', () => {
    expect(parseIsoDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
  })

  it.each([
    ['a date that does not exist', '2026-02-30'],
    ['a leap day in a common year', '2026-02-29'],
    ['month 13', '2026-13-01'],
    ['day 00', '2026-01-00'],
    ['an unpadded month', '2026-8-29'],
    ['a timestamp', '2026-08-29T12:00:00Z'],
    ['an empty string', ''],
    ['prose', 'i morgen'],
  ])('rejects %s', (_label, value) => {
    expect(() => parseIsoDate(value)).toThrow(/date/i)
  })

  it('rejects a non-string', () => {
    // The database column is a date and always arrives as a string; anything else is a
    // programmer error and must fail loudly rather than produce a plausible answer.
    expect(() => parseIsoDate(20260829 as unknown as string)).toThrow(/date/i)
  })
})

describe('formatIsoDate', () => {
  it('zero-pads month and day', () => {
    expect(formatIsoDate({ year: 2026, month: 1, day: 3 })).toBe('2026-01-03')
  })

  it('round-trips every date it parses', () => {
    for (const value of ['2026-01-01', '2026-12-31', '2024-02-29', '2026-08-29']) {
      expect(formatIsoDate(parseIsoDate(value))).toBe(value)
    }
  })
})

describe('addDays', () => {
  it.each([
    ['stays inside a month', '2026-08-29', 1, '2026-08-30'],
    ['crosses a month boundary', '2026-08-31', 1, '2026-09-01'],
    ['crosses a year boundary', '2026-12-31', 1, '2027-01-01'],
    ['crosses a leap day', '2024-02-28', 1, '2024-02-29'],
    ['skips a leap day that does not exist', '2026-02-28', 1, '2026-03-01'],
    ['moves backwards', '2026-01-01', -1, '2025-12-31'],
    ['adds nothing', '2026-08-29', 0, '2026-08-29'],
    ['spans the sold-out search cap', '2026-08-29', 60, '2026-10-28'],
  ])('%s', (_label, from, days, expected) => {
    expect(addDays(from, days)).toBe(expected)
  })

  it('crosses both Danish daylight-saving transitions without drifting', () => {
    // Adding a day is calendar arithmetic, not 24 hours of elapsed time. The two days
    // that are 23 and 25 hours long in Copenhagen must still be exactly one day wide.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
  })

  it('rejects a non-integer offset', () => {
    expect(() => addDays('2026-08-29', 1.5)).toThrow(/whole number/i)
  })
})

describe('weekdayOf', () => {
  it('maps a full week, Monday first', () => {
    const monday = '2026-08-24'
    const week = WEEKDAY_KEYS.map((_key, index) => weekdayOf(addDays(monday, index)))
    expect(week).toEqual([...WEEKDAY_KEYS])
  })

  it.each([
    ['2026-08-29', 'sat'],
    ['2026-03-29', 'sun'],
    ['2026-10-25', 'sun'],
    ['2026-09-21', 'mon'],
    ['2026-04-01', 'wed'],
  ] as const)('%s is %s', (date, expected) => {
    expect(weekdayOf(date)).toBe(expected)
  })
})

describe('parseIsoTime', () => {
  it.each([
    ['15:00', { hour: 15, minute: 0 }],
    ['09:05', { hour: 9, minute: 5 }],
    ['00:00', { hour: 0, minute: 0 }],
    ['23:59', { hour: 23, minute: 59 }],
    // Postgres serialises a `time` column with seconds; the override table uses one.
    ['17:00:00', { hour: 17, minute: 0 }],
  ])('reads %s', (value, expected) => {
    expect(parseIsoTime(value)).toEqual(expected)
  })

  it.each([
    ['hour 24', '24:00'],
    ['minute 60', '15:60'],
    ['an unpadded minute', '15:0'],
    ['a non-zero second', '15:00:30'],
    ['an empty string', ''],
    ['prose', 'frokost'],
  ])('rejects %s', (_label, value) => {
    expect(() => parseIsoTime(value)).toThrow(/time/i)
  })
})

describe('formatIsoTime', () => {
  it('zero-pads and drops seconds', () => {
    expect(formatIsoTime({ hour: 9, minute: 5 })).toBe('09:05')
    expect(formatIsoTime(parseIsoTime('17:00:00'))).toBe('17:00')
  })
})

describe('minutesOfDay', () => {
  it('orders times within a day', () => {
    expect(minutesOfDay({ hour: 15, minute: 0 })).toBeLessThan(minutesOfDay({ hour: 20, minute: 0 }))
    expect(minutesOfDay({ hour: 0, minute: 0 })).toBe(0)
    expect(minutesOfDay({ hour: 23, minute: 59 })).toBe(1439)
  })
})
