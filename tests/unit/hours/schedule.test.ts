import { describe, expect, it } from 'vitest'

import { indexPublishedOverrides, resolveDayOpening } from '@/lib/hours/schedule'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { CONFIRMED_SCHEDULE, closedOverride, customOverride, withoutWeekday } from '../fixtures/hours'

const noOverrides = indexPublishedOverrides([])

function resolve(date: string, overrides: OpeningHoursOverride[] = []) {
  return resolveDayOpening(date, CONFIRMED_SCHEDULE, indexPublishedOverrides(overrides))
}

describe('resolveDayOpening — the confirmed weekly schedule', () => {
  // Mon closed, Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00 (design 1ab).
  // 2026-08-24 is a Monday.
  it.each([
    ['Monday', '2026-08-24', 'mon', null],
    ['Tuesday', '2026-08-25', 'tue', null],
    ['Wednesday', '2026-08-26', 'wed', ['15:00', '20:00']],
    ['Thursday', '2026-08-27', 'thu', ['15:00', '20:00']],
    ['Friday', '2026-08-28', 'fri', ['15:00', '20:00']],
    ['Saturday', '2026-08-29', 'sat', ['17:00', '20:00']],
    ['Sunday', '2026-08-30', 'sun', ['17:00', '20:00']],
  ] as const)('%s', (_label, date, weekday, hours) => {
    const day = resolve(date)

    expect(day.weekday).toBe(weekday)
    expect(day.date).toBe(date)
    expect(day.source).toBe('weekly')

    if (hours === null) {
      expect(day.isOpen).toBe(false)
    } else {
      expect(day).toMatchObject({ isOpen: true, from: hours[0], to: hours[1] })
    }
  })
})

describe('resolveDayOpening — overrides', () => {
  it('closes a normally open day', () => {
    const day = resolve('2026-08-29', [closedOverride('2026-08-29')])
    expect(day).toMatchObject({ isOpen: false, source: 'override' })
  })

  it('opens a normally closed Monday', () => {
    const day = resolve('2026-08-24', [customOverride('2026-08-24', '12:00', '16:00')])
    expect(day).toMatchObject({ isOpen: true, from: '12:00', to: '16:00', source: 'override' })
  })

  it('replaces the hours of a normally open day', () => {
    const day = resolve('2026-08-26', [customOverride('2026-08-26', '15:00', '18:00')])
    expect(day).toMatchObject({ isOpen: true, from: '15:00', to: '18:00', source: 'override' })
  })

  it('applies only to its own date', () => {
    const overrides = [closedOverride('2026-08-26')]
    expect(resolve('2026-08-26', overrides).isOpen).toBe(false)
    expect(resolve('2026-08-27', overrides)).toMatchObject({ isOpen: true, source: 'weekly' })
  })

  it('normalises the seconds Postgres adds to a time column', () => {
    const override: OpeningHoursOverride = {
      date: '2026-08-24',
      kind: 'custom',
      opensAt: '12:00:00',
      closesAt: '16:00:00',
      status: 'published',
    }
    expect(resolve('2026-08-24', [override])).toMatchObject({ from: '12:00', to: '16:00' })
  })
})

describe('indexPublishedOverrides', () => {
  it('ignores a draft override entirely', () => {
    const draft: OpeningHoursOverride = { ...closedOverride('2026-08-29'), status: 'draft' }
    expect(indexPublishedOverrides([draft]).size).toBe(0)
    expect(resolve('2026-08-29', [draft])).toMatchObject({ isOpen: true, source: 'weekly' })
  })

  it('keeps published overrides', () => {
    const index = indexPublishedOverrides([
      closedOverride('2026-08-29'),
      customOverride('2026-08-24', '12:00', '16:00'),
    ])
    expect(index.size).toBe(2)
  })

  it('rejects two published overrides for the same date', () => {
    // `opening_hours_overrides.date` is UNIQUE, so this can only be a programmer error.
    expect(() =>
      indexPublishedOverrides([closedOverride('2026-08-29'), closedOverride('2026-08-29')]),
    ).toThrow(/more than one/i)
  })

  it('allows a draft and a published override to coexist on one date', () => {
    const published = customOverride('2026-08-29', '18:00', '21:00')
    const draft: OpeningHoursOverride = { ...closedOverride('2026-08-29'), status: 'draft' }
    expect(resolve('2026-08-29', [draft, published])).toMatchObject({ from: '18:00', to: '21:00' })
  })
})

describe('resolveDayOpening — impossible input fails loudly', () => {
  it('rejects a schedule missing a weekday', () => {
    expect(() =>
      resolveDayOpening('2026-08-30', withoutWeekday(CONFIRMED_SCHEDULE, 'sun'), noOverrides),
    ).toThrow(/sun/)
  })

  it('rejects a day whose closing time is not after its opening time', () => {
    const backwards = { ...CONFIRMED_SCHEDULE, wed: { from: '20:00', to: '15:00' } }
    expect(() => resolveDayOpening('2026-08-26', backwards, noOverrides)).toThrow(/after/i)
  })

  it('rejects a zero-length opening', () => {
    const empty = { ...CONFIRMED_SCHEDULE, wed: { from: '15:00', to: '15:00' } }
    expect(() => resolveDayOpening('2026-08-26', empty, noOverrides)).toThrow(/after/i)
  })

  it('rejects a malformed time in the schedule', () => {
    const broken = { ...CONFIRMED_SCHEDULE, wed: { from: '15:00', to: '8pm' } }
    expect(() => resolveDayOpening('2026-08-26', broken, noOverrides)).toThrow(/time/i)
  })

  it('rejects a custom override with no times', () => {
    const broken: OpeningHoursOverride = {
      date: '2026-08-26',
      kind: 'custom',
      opensAt: null,
      closesAt: null,
      status: 'published',
    }
    expect(() => resolve('2026-08-26', [broken])).toThrow(/custom override/i)
  })

  it('rejects a malformed date', () => {
    expect(() => resolve('26-08-2026')).toThrow(/date/i)
  })
})

describe('resolveDayOpening — purity', () => {
  it('does not mutate the schedule or the overrides it is given', () => {
    const schedule: WeeklySchedule = structuredClone(CONFIRMED_SCHEDULE)
    const overrides = [closedOverride('2026-08-29'), customOverride('2026-08-24', '12:00', '16:00')]
    const scheduleBefore = structuredClone(schedule)
    const overridesBefore = structuredClone(overrides)

    resolveDayOpening('2026-08-29', schedule, indexPublishedOverrides(overrides))
    resolveDayOpening('2026-08-24', schedule, indexPublishedOverrides(overrides))

    expect(schedule).toEqual(scheduleBefore)
    expect(overrides).toEqual(overridesBefore)
  })
})
