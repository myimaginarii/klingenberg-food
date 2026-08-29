import { describe, expect, it } from 'vitest'

import { getOpenState } from '@/lib/hours/engine'
import {
  describeOpenState,
  formatCopenhagenClock,
  formatDailyHours,
  formatOpenUntil,
  formatShortDate,
  formatTimeRange,
  formatWeekdayDate,
  formatWeekdayName,
  formatWeekdayTime,
  formatWeeklyHours,
  formatWeeklyHoursLines,
  groupWeeklyHours,
} from '@/lib/hours/format'
import type { WeeklySchedule } from '@/lib/hours/types'
import { ALWAYS_CLOSED_SCHEDULE, CONFIRMED_SCHEDULE, customOverride } from '../fixtures/hours'

/** The en dash the approved design uses in every range. */
const EN_DASH = '–'

describe('formatWeekdayName', () => {
  it('gives the Danish long form', () => {
    expect(formatWeekdayName('mon', 'long')).toBe('mandag')
    expect(formatWeekdayName('sat', 'long')).toBe('lørdag')
    expect(formatWeekdayName('sun', 'long')).toBe('søndag')
  })

  it('gives the Danish short form used in the footer', () => {
    expect(formatWeekdayName('wed', 'short')).toBe('ons')
    expect(formatWeekdayName('fri', 'short')).toBe('fre')
    expect(formatWeekdayName('sat', 'short')).toBe('lør')
  })
})

describe('formatTimeRange', () => {
  it('joins two times with an en dash', () => {
    expect(formatTimeRange('15:00', '20:00')).toBe(`15:00${EN_DASH}20:00`)
  })

  it('normalises the seconds a Postgres time column carries', () => {
    expect(formatTimeRange('17:00:00', '20:00:00')).toBe(`17:00${EN_DASH}20:00`)
  })
})

describe('groupWeeklyHours', () => {
  it('groups the confirmed schedule into three runs', () => {
    expect(groupWeeklyHours(CONFIRMED_SCHEDULE)).toEqual([
      { days: ['mon', 'tue'], isOpen: false },
      { days: ['wed', 'thu', 'fri'], isOpen: true, from: '15:00', to: '20:00' },
      { days: ['sat', 'sun'], isOpen: true, from: '17:00', to: '20:00' },
    ])
  })

  it('groups only consecutive days, Monday first', () => {
    const alternating: WeeklySchedule = {
      ...ALWAYS_CLOSED_SCHEDULE,
      tue: { from: '15:00', to: '20:00' },
      thu: { from: '15:00', to: '20:00' },
    }
    expect(groupWeeklyHours(alternating).map((group) => group.days)).toEqual([
      ['mon'],
      ['tue'],
      ['wed'],
      ['thu'],
      ['fri', 'sat', 'sun'],
    ])
  })

  it('collapses a week of identical hours into one group', () => {
    const everyDay: WeeklySchedule = {
      mon: { from: '15:00', to: '20:00' },
      tue: { from: '15:00', to: '20:00' },
      wed: { from: '15:00', to: '20:00' },
      thu: { from: '15:00', to: '20:00' },
      fri: { from: '15:00', to: '20:00' },
      sat: { from: '15:00', to: '20:00' },
      sun: { from: '15:00', to: '20:00' },
    }
    expect(groupWeeklyHours(everyDay)).toHaveLength(1)
  })

  it('does not merge two open runs with different hours', () => {
    expect(groupWeeklyHours(CONFIRMED_SCHEDULE).filter((group) => group.isOpen)).toHaveLength(2)
  })
})

describe('formatWeeklyHours', () => {
  it('produces the footer rows from the approved design', () => {
    expect(formatWeeklyHours(CONFIRMED_SCHEDULE)).toEqual([
      { days: `Man${EN_DASH}tir`, hours: 'Lukket', isOpen: false },
      { days: `Ons${EN_DASH}fre`, hours: `15:00${EN_DASH}20:00`, isOpen: true },
      { days: `Lør${EN_DASH}søn`, hours: `17:00${EN_DASH}20:00`, isOpen: true },
    ])
  })

  it('names a single day without a range', () => {
    const oneDay: WeeklySchedule = { ...ALWAYS_CLOSED_SCHEDULE, wed: { from: '15:00', to: '20:00' } }
    const open = formatWeeklyHours(oneDay).find((row) => row.isOpen)
    expect(open?.days).toBe('Ons')
  })
})

describe('formatWeeklyHoursLines', () => {
  it('renders the grouped footer line exactly as designed', () => {
    // "Ons–fre 15:00–20:00" / "Lør–søn 17:00–20:00" (design 1e).
    expect(formatWeeklyHoursLines(CONFIRMED_SCHEDULE)).toEqual([
      `Man${EN_DASH}tir lukket`,
      `Ons${EN_DASH}fre 15:00${EN_DASH}20:00`,
      `Lør${EN_DASH}søn 17:00${EN_DASH}20:00`,
    ])
  })
})

describe('formatDailyHours', () => {
  it('lists all seven days, Monday first', () => {
    const days = formatDailyHours(CONFIRMED_SCHEDULE)
    expect(days).toHaveLength(7)
    expect(days.map((day) => day.day)).toEqual([
      'Mandag',
      'Tirsdag',
      'Onsdag',
      'Torsdag',
      'Fredag',
      'Lørdag',
      'Søndag',
    ])
  })

  it('states the confirmed hours per day', () => {
    const days = formatDailyHours(CONFIRMED_SCHEDULE)
    expect(days[0]).toEqual({ weekday: 'mon', day: 'Mandag', hours: 'Lukket', isOpen: false })
    expect(days[2]).toEqual({
      weekday: 'wed',
      day: 'Onsdag',
      hours: `15:00${EN_DASH}20:00`,
      isOpen: true,
    })
  })
})

describe('Copenhagen-local instant formatting', () => {
  it('formats the time of day in Copenhagen, not in UTC', () => {
    expect(formatCopenhagenClock(new Date('2026-08-26T13:00:00Z'))).toBe('15:00')
    expect(formatCopenhagenClock(new Date('2026-01-14T14:00:00Z'))).toBe('15:00')
  })

  it('formats "til kl. 20:00" exactly as the design writes it', () => {
    expect(formatOpenUntil(new Date('2026-08-26T18:00:00Z'))).toBe('til kl. 20:00')
  })

  it('formats a next opening as a weekday and a time', () => {
    // The admin helper text in §7b reads "… når I åbner igen — onsdag kl. 15:00".
    expect(formatWeekdayTime(new Date('2026-09-02T13:00:00Z'))).toBe('onsdag kl. 15:00')
    expect(formatWeekdayTime(new Date('2026-08-29T15:00:00Z'))).toBe('lørdag kl. 17:00')
  })

  it('uses the Copenhagen date, not the UTC date, at the day boundary', () => {
    // 22:30Z on 14 July is 00:30 on 15 July in Copenhagen — a Wednesday, not a Tuesday.
    expect(formatWeekdayTime(new Date('2026-07-14T22:30:00Z'))).toBe('onsdag kl. 00:30')
  })

  it('keeps the wall clock across both DST transitions', () => {
    expect(formatWeekdayTime(new Date('2026-04-01T13:00:00Z'))).toBe('onsdag kl. 15:00')
    expect(formatWeekdayTime(new Date('2026-10-28T14:00:00Z'))).toBe('onsdag kl. 15:00')
  })

  it('rejects an invalid instant', () => {
    expect(() => formatCopenhagenClock(new Date('nonsense'))).toThrow(/instant/i)
  })
})

describe('civil date formatting', () => {
  it('formats a short Danish date', () => {
    // "Lukket mandag 21.09" (design 1ae).
    expect(formatShortDate('2026-09-21')).toBe('21.09')
    expect(formatShortDate('2026-01-05')).toBe('05.01')
  })

  it('formats a weekday and a short date', () => {
    expect(formatWeekdayDate('2026-09-21')).toBe('mandag 21.09')
  })

  it('rejects a malformed date', () => {
    expect(() => formatShortDate('2026-02-30')).toThrow(/date/i)
  })
})

describe('describeOpenState', () => {
  const describe_ = (now: string) =>
    describeOpenState(getOpenState(new Date(now), CONFIRMED_SCHEDULE, []))

  it('reads "Åbent nu · til kl. 20:00" during service', () => {
    const status = describe_('2026-08-26T16:00:00Z') // Wednesday 18:00 local
    expect(status.isOpen).toBe(true)
    expect(status.label).toBe('Åbent nu')
    expect(status.detail).toBe('til kl. 20:00')
  })

  it('reads "Lukket" outside service, with no invented second line', () => {
    const status = describe_('2026-08-24T12:00:00Z') // Monday
    expect(status.isOpen).toBe(false)
    expect(status.label).toBe('Lukket')
    expect(status.detail).toBeNull()
  })

  it('carries the next opening as data, so the caller chooses the wording', () => {
    const status = describe_('2026-08-24T12:00:00Z')
    expect(status.nextOpening).toEqual({
      weekday: 'wed',
      date: '2026-08-26',
      time: '15:00',
      text: 'onsdag kl. 15:00',
      instant: new Date('2026-08-26T13:00:00Z'),
    })
  })

  it('has no next opening when the restaurant never opens', () => {
    const status = describeOpenState(
      getOpenState(new Date('2026-08-26T16:00:00Z'), ALWAYS_CLOSED_SCHEDULE, []),
    )
    expect(status.isOpen).toBe(false)
    expect(status.nextOpening).toBeNull()
  })

  it('follows an override that opens a normally closed day', () => {
    const status = describeOpenState(
      getOpenState(new Date('2026-08-24T10:30:00Z'), CONFIRMED_SCHEDULE, [
        customOverride('2026-08-24', '12:00', '16:00'),
      ]),
    )
    expect(status.isOpen).toBe(true)
    expect(status.detail).toBe('til kl. 16:00')
  })
})
