import { describe, expect, it } from 'vitest'

import { formatDanishDate, formatDateCircle, formatPrice } from '@/lib/format/danish'

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
