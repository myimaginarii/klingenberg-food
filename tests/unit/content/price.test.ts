import { describe, expect, it } from 'vitest'

import { oreFromKroner } from '@/lib/content/load/price'

/**
 * Money crosses one boundary on this site: a price is written on disk in kroner, the
 * way a person writes it on a menu, and used everywhere else as the whole number of
 * øre the domain model has always carried.
 *
 * The two properties worth pinning are the two that would be expensive to discover on
 * a live menu: the conversion is exact for values a float would round wrong, and a
 * value that is not a price is refused rather than silently turned into one.
 */
describe('a stored kroner price', () => {
  it('becomes whole øre, with either separator and either number of decimals', () => {
    expect(oreFromKroner('89', 'test')).toBe(8900)
    expect(oreFromKroner('295', 'test')).toBe(29500)
    expect(oreFromKroner('12,50', 'test')).toBe(1250)
    expect(oreFromKroner('12.50', 'test')).toBe(1250)
    expect(oreFromKroner('12,5', 'test')).toBe(1250)
    expect(oreFromKroner('0,05', 'test')).toBe(5)
    expect(oreFromKroner(' 89 ', 'test')).toBe(8900)
  })

  it('is exact where a float is not', () => {
    // 10.07 * 100 is 1006.9999999999999 in binary floating point.
    expect(oreFromKroner('10,07', 'test')).toBe(1007)
    expect(oreFromKroner('1445,95', 'test')).toBe(144595)
  })

  it('is null for an entry that has no price', () => {
    expect(oreFromKroner(null, 'test')).toBeNull()
  })

  it('refuses anything that is not a price, naming what was being priced', () => {
    for (const bad of ['', '89 kr.', '89,999', 'gratis', '-5', '8 9', '1e3']) {
      expect(() => oreFromKroner(bad, 'content/site/x.json'), bad).toThrow(
        /content\/site\/x\.json/,
      )
    }
  })
})
