import { type IsoDate, parseIsoDate } from '@/lib/time/calendar'

/**
 * Danish presentation of prices and dates — design 1b, 1g, 1h, 1j.
 *
 * Formatting only, and deliberately hand-rolled rather than delegated to
 * `Intl.NumberFormat('da-DK')`. Two reasons: the output is fixed by the approved
 * design down to the trailing full stop in "89 kr.", and a formatter whose result
 * depends on the host's ICU build is a formatter that can differ between a developer's
 * machine, CI and production. Every string here is deterministic and unit-tested.
 *
 * Opening hours are formatted in `lib/hours/format.ts`; nothing is duplicated between
 * the two.
 */

/** Danish thousands separator. "1.500". */
const THOUSANDS = '.'

/** Danish decimal separator. "12,50". */
const DECIMAL = ','

/** Month abbreviations for the date circle a news item without a photo gets (1j). */
const MONTH_ABBREVIATIONS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAJ',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OKT',
  'NOV',
  'DEC',
] as const

function groupThousands(value: number): string {
  const digits = String(value)
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i
    out += digits[i]
    if (fromEnd > 1 && fromEnd % 3 === 1) out += THOUSANDS
  }
  return out
}

/**
 * A price stored in minor units, as the design writes it: "89 kr.".
 *
 * Prices are stored as `price_ore integer` (technical plan §4) and edited in kroner.
 * Whole kroner render without decimals — which is every price the restaurant has
 * supplied — and anything else renders with two, so a 12,50 never silently becomes 12.
 */
export function formatPrice(priceOre: number): string {
  if (!Number.isInteger(priceOre)) {
    throw new TypeError(`A price is stored in whole øre. Received: ${String(priceOre)}`)
  }

  const negative = priceOre < 0
  const absolute = Math.abs(priceOre)
  const kroner = Math.floor(absolute / 100)
  const ore = absolute % 100

  const amount =
    ore === 0
      ? groupThousands(kroner)
      : `${groupThousands(kroner)}${DECIMAL}${String(ore).padStart(2, '0')}`

  return `${negative ? '-' : ''}${amount} kr.`
}

/** "29.08.2026" — the `DD.MM.ÅÅÅÅ` the news cards show (1j, 1l, 1n). */
export function formatDanishDate(date: IsoDate): string {
  const { year, month, day } = parseIsoDate(date)
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${String(year)}`
}

/** The two lines of the date circle a photo-less news item gets: "24" over "DEC" (1j). */
export function formatDateCircle(date: IsoDate): { day: string; month: string } {
  const { month, day } = parseIsoDate(date)
  const abbreviation = MONTH_ABBREVIATIONS[month - 1]

  /* v8 ignore next -- parseIsoDate has already rejected any month outside 1–12. */
  if (abbreviation === undefined) throw new TypeError(`No month abbreviation for ${date}.`)

  return { day: String(day), month: abbreviation }
}
