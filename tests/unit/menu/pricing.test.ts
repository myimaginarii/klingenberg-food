import { describe, expect, it } from 'vitest'

import { formatOreForInput, MAX_PRICE_ORE, parseKronerToOre } from '@/lib/menu/pricing'
import { formatPrice } from '@/lib/format/danish'

/**
 * Kroner → øre — technical plan §4, design 1r.
 *
 * The parser is the one place a number typed by a person becomes money in the database,
 * so it is tested the way money is tested: against the entries a Dane actually makes,
 * against the two meanings a full stop can carry, and against the malformed input it
 * must refuse rather than guess at.
 */
describe('parseKronerToOre', () => {
  it.each([
    ['89', 8900],
    ['89,50', 8950],
    ['89.50', 8950],
    ['89,5', 8950],
    ['0', 0],
    ['0,05', 5],
    ['  89  ', 8900],
    ['1500', 150_000],
    ['1.500', 150_000],
    ['1.500,50', 150_050],
    ['10000', MAX_PRICE_ORE],
  ])('reads %o as %i øre', (input, expected) => {
    expect(parseKronerToOre(input)).toEqual({ ok: true, priceOre: expected })
  })

  it('treats an empty field as "no fixed price" rather than as an error', () => {
    expect(parseKronerToOre('')).toEqual({ ok: true, priceOre: null })
    expect(parseKronerToOre('   ')).toEqual({ ok: true, priceOre: null })
  })

  it('reads a full stop before three digits as thousands, and before one or two as øre', () => {
    // The whole reason the rule is written out rather than delegated to a locale.
    expect(parseKronerToOre('1.500')).toEqual({ ok: true, priceOre: 150_000 })
    expect(parseKronerToOre('1.50')).toEqual({ ok: true, priceOre: 150 })
  })

  it.each([
    '89 kr.',
    '89 kr',
    'nioghalvfems',
    '-89',
    '8 9',
    '89,',
    ',50',
    '89..50',
    '89,50,25',
    '1.50.000',
    '12.3456',
    '89½',
  ])('refuses %o', (input) => {
    expect(parseKronerToOre(input).ok).toBe(false)
  })

  it('names the reason, so the field can show its own sentence', () => {
    expect(parseKronerToOre('89 kr.')).toEqual({ ok: false, error: 'not_a_number' })
    expect(parseKronerToOre('89,555')).toEqual({ ok: false, error: 'too_many_decimals' })
    expect(parseKronerToOre('10001')).toEqual({ ok: false, error: 'out_of_range' })
  })

  it('refuses a price above the database CHECK rather than letting the insert fail', () => {
    expect(parseKronerToOre('10000,01')).toEqual({ ok: false, error: 'out_of_range' })
    expect(parseKronerToOre('99999999999999999999')).toEqual({ ok: false, error: 'out_of_range' })
  })

  it('never produces a fractional value, whatever the decimals', () => {
    for (const input of ['0,10', '0,01', '12,34', '999,99', '0,1', '7,05']) {
      const result = parseKronerToOre(input)

      expect(result.ok, input).toBe(true)
      if (result.ok) expect(Number.isInteger(result.priceOre), input).toBe(true)
    }
  })
})

describe('formatOreForInput', () => {
  it.each([
    [8900, '89'],
    [8950, '89,50'],
    [5, '0,05'],
    [0, '0'],
    [150_000, '1500'],
  ])('shows %i øre as %o in the field', (ore, expected) => {
    expect(formatOreForInput(ore)).toBe(expected)
  })

  it('shows an empty field when the dish has no price', () => {
    expect(formatOreForInput(null)).toBe('')
  })

  it('is not the public formatter — the field carries no unit', () => {
    // A value with "kr." in it would be read back by the parser as malformed, which is
    // exactly the bug two separate functions exist to prevent.
    expect(formatPrice(8900)).toBe('89 kr.')
    expect(formatOreForInput(8900)).toBe('89')
    expect(parseKronerToOre(formatOreForInput(8900))).toEqual({ ok: true, priceOre: 8900 })
  })

  it('round-trips every price the restaurant currently has', () => {
    for (const ore of [500, 800, 1000, 1700, 1900, 2200, 8500, 8900, 9700, 29_500]) {
      expect(parseKronerToOre(formatOreForInput(ore))).toEqual({ ok: true, priceOre: ore })
    }
  })

  it('refuses to format something that is not whole øre', () => {
    expect(() => formatOreForInput(89.5)).toThrow(TypeError)
    expect(() => formatOreForInput(-1)).toThrow(TypeError)
  })
})
