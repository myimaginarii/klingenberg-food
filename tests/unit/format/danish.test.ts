import { describe, expect, it } from 'vitest'

import {
  formatDanishDate,
  formatDanishDayMonth,
  formatDanishLongDate,
  formatDateCircle,
  formatDatePeriod,
  formatPrice,
} from '@/lib/format/danish'

describe('formatPrice', () => {
  it('writes a whole-krone price the way the menu does', () => {
    expect(formatPrice(8900)).toBe('89 kr.')
    expect(formatPrice(500)).toBe('5 kr.')
    expect(formatPrice(29500)).toBe('295 kr.')
  })

  it('keeps øre when a price has them, with a Danish decimal comma', () => {
    expect(formatPrice(1250)).toBe('12,50 kr.')
    expect(formatPrice(1205)).toBe('12,05 kr.')
  })

  it('groups thousands with a full stop', () => {
    expect(formatPrice(150000)).toBe('1.500 kr.')
    expect(formatPrice(1234567)).toBe('12.345,67 kr.')
  })

  it('renders zero rather than treating it as absent', () => {
    expect(formatPrice(0)).toBe('0 kr.')
  })

  it('refuses a fractional øre, which would mean a rounding bug upstream', () => {
    expect(() => formatPrice(12.5)).toThrow(TypeError)
  })
})

describe('formatDanishDate', () => {
  it('writes DD.MM.ÅÅÅÅ, zero-padded', () => {
    expect(formatDanishDate('2026-08-29')).toBe('29.08.2026')
    expect(formatDanishDate('2026-01-05')).toBe('05.01.2026')
  })

  it('rejects a date that does not exist', () => {
    expect(() => formatDanishDate('2026-02-30')).toThrow(TypeError)
  })
})

describe('formatDateCircle', () => {
  it('splits a date into the two lines the design draws', () => {
    expect(formatDateCircle('2026-12-24')).toEqual({ day: '24', month: 'DEC' })
    expect(formatDateCircle('2026-05-01')).toEqual({ day: '1', month: 'MAJ' })
  })

  it('uses the Danish month abbreviations, not the English ones', () => {
    expect(formatDateCircle('2026-10-02').month).toBe('OKT')
    expect(formatDateCircle('2026-05-02').month).toBe('MAJ')
  })
})

describe('formatDatePeriod', () => {
  it('writes a closed window as its two dates', () => {
    expect(formatDatePeriod('2026-09-01', '2026-09-30')).toBe('01.09.2026–30.09.2026')
  })

  it('names only the boundary that exists, rather than printing an empty one', () => {
    expect(formatDatePeriod(null, '2026-09-30')).toBe('Til og med 30.09.2026')
    expect(formatDatePeriod('2026-09-01', null)).toBe('Fra 01.09.2026')
  })

  it('gives null when there is no window, so no dateline renders', () => {
    expect(formatDatePeriod(null, null)).toBeNull()
  })

  it('rejects a date that does not exist, like every other date here', () => {
    expect(() => formatDatePeriod('2026-02-30', null)).toThrow(TypeError)
  })
})

describe('formatDanishDayMonth', () => {
  it('writes a date the way it is spoken, for the sentences in §7d', () => {
    expect(formatDanishDayMonth('2026-09-01')).toBe('1. september')
    expect(formatDanishDayMonth('2026-09-30')).toBe('30. september')
  })

  it('drops the leading zero on the day — "1. september", not "01. september"', () => {
    expect(formatDanishDayMonth('2026-03-05')).toBe('5. marts')
  })

  it('uses the Danish month names, uncapitalised as Danish writes them', () => {
    expect(formatDanishDayMonth('2026-01-15')).toBe('15. januar')
    expect(formatDanishDayMonth('2026-05-15')).toBe('15. maj')
    expect(formatDanishDayMonth('2026-10-15')).toBe('15. oktober')
    expect(formatDanishDayMonth('2026-12-15')).toBe('15. december')
  })

  it('rejects a date that does not exist, like every other date here', () => {
    expect(() => formatDanishDayMonth('2026-02-30')).toThrow(TypeError)
  })
})

describe('formatDanishLongDate', () => {
  it('adds the year for the case where the year is the information', () => {
    expect(formatDanishLongDate('2027-01-01')).toBe('1. januar 2027')
  })
})
