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

/**
 * Danish month names, written out.
 *
 * The administration's computed Månedens burger state says its dates the way a person
 * would read them aloud — *"vises fra 1. september"* (§7d) — rather than as
 * `01.09.2026`. That is the one place on the site where a date is part of a sentence,
 * and a sentence containing "01.09" is a sentence nobody speaks.
 *
 * Danish does **not** capitalise month names, and the day carries no leading zero in
 * this form: "1. september", not "01. September".
 */
const MONTH_NAMES = [
  'januar',
  'februar',
  'marts',
  'april',
  'maj',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'december',
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

/**
 * The period a date-windowed item is shown in, written as its dateline:
 * "01.09.2026–30.09.2026", "Til og med 30.09.2026", "Fra 01.09.2026".
 *
 * Månedens burger is the one thing on the public site that is deliberately temporary
 * (§7d), and the Forside says so by printing the window rather than by decorating the
 * section. An open end is not a boundary, so it is not printed as one — a burger with
 * no `starts_on` reads "Til og med …", not "— – 30.09.2026".
 *
 * `null` when neither end is set: there is nothing true to say, so nothing is said.
 */
export function formatDatePeriod(startsOn: IsoDate | null, endsOn: IsoDate | null): string | null {
  if (startsOn !== null && endsOn !== null) {
    return `${formatDanishDate(startsOn)}–${formatDanishDate(endsOn)}`
  }
  if (endsOn !== null) return `Til og med ${formatDanishDate(endsOn)}`
  if (startsOn !== null) return `Fra ${formatDanishDate(startsOn)}`

  return null
}

/**
 * "1. september" — a date inside a sentence, without its year.
 *
 * Used by the administration's computed state (§7d), where the year is usually noise:
 * a burger is written in the month before it runs, and *"vises fra 1. september 2026"*
 * says one thing more than anybody needed. {@link formatDanishLongDate} is the form for
 * when the year genuinely matters, and `lib/menu/monthly.ts` decides which of the two a
 * given date gets — that decision is a domain rule, not a formatting one.
 */
export function formatDanishDayMonth(date: IsoDate): string {
  const { month, day } = parseIsoDate(date)
  const name = MONTH_NAMES[month - 1]

  /* v8 ignore next -- parseIsoDate has already rejected any month outside 1–12. */
  if (name === undefined) throw new TypeError(`No month name for ${date}.`)

  return `${String(day)}. ${name}`
}

/** "1. september 2026" — the same date when the year is part of what has to be said. */
export function formatDanishLongDate(date: IsoDate): string {
  const { year } = parseIsoDate(date)

  return `${formatDanishDayMonth(date)} ${String(year)}`
}

/** The two lines of the date circle a photo-less news item gets: "24" over "DEC" (1j). */
export function formatDateCircle(date: IsoDate): { day: string; month: string } {
  const { month, day } = parseIsoDate(date)
  const abbreviation = MONTH_ABBREVIATIONS[month - 1]

  /* v8 ignore next -- parseIsoDate has already rejected any month outside 1–12. */
  if (abbreviation === undefined) throw new TypeError(`No month abbreviation for ${date}.`)

  return { day: String(day), month: abbreviation }
}
