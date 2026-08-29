/**
 * Kroner in, øre out — technical plan §4, design 1r ("Pris (kr.)").
 *
 * §4 is unambiguous: "Prices stored as `price_ore integer` (minor units) and edited in
 * kroner." The public side of that conversion has existed since phase 3 —
 * `lib/format/danish.ts` turns øre into "89 kr." and stays the only display source.
 * This module is the missing half: the one place kroner typed by a person become øre,
 * and the one place stored øre become the string that goes back into the field.
 *
 * WHY THIS IS NOT `Number.parseFloat`
 *
 * `parseFloat('89,50')` is 89. `parseFloat('0.1') * 100` is 10.000000000000002. Money
 * is counted, not measured, so nothing here ever produces a fractional number: the
 * kroner and the øre are read as separate digit strings and combined with integer
 * arithmetic. No floating-point value exists anywhere between the keyboard and the
 * column.
 *
 * WHAT IS ACCEPTED
 *
 * Danish entry as it is actually typed, on a keyboard or a numeric keypad:
 *
 *     89        →  8900
 *     89,50     →  8950
 *     89.50     →  8950    — a keypad produces a full stop; a Dane means a comma
 *     89,5      →  8950    — one decimal is a whole number of ti-øre
 *     1.500     →  150000  — a thousands separator: "1.500" is one thousand five hundred
 *     ""        →  null    — the dish has no fixed price
 *
 * `1.500` and `89.50` both use a full stop and mean different things, which is why the
 * rule is written out here rather than left to a locale-aware parser: **a full stop
 * followed by exactly three digits groups thousands; a full stop followed by one or
 * two digits separates the øre.** A comma is always the decimal separator, because
 * that is what a Danish writer means by it.
 *
 * Everything else is refused with a sentence, never coerced. "89 kr" is a refusal
 * rather than a guess — a parser that guesses is a parser that will eventually guess a
 * price wrong on a live menu.
 */

/** The database CHECK on `dishes.price_ore`: `between 0 and 1000000` (§4). */
export const MAX_PRICE_ORE = 1_000_000

/** Why a price could not be read. The editor turns each one into its own sentence. */
export type PriceParseError = 'not_a_number' | 'too_many_decimals' | 'out_of_range'

export type PriceParseResult =
  | { readonly ok: true; readonly priceOre: number | null }
  | { readonly ok: false; readonly error: PriceParseError }

/** Digits, full stops and commas, starting and ending on a digit. Nothing else. */
const AMOUNT_CHARACTERS = /^\d[\d.,]*\d$|^\d$/

function refuse(error: PriceParseError): PriceParseResult {
  return { ok: false, error }
}

/**
 * Split the typed amount into its whole and decimal halves.
 *
 * `null` means the text is not an amount at all. A `decimal` of `null` means there was
 * no decimal separator, which is different from `'0'`.
 */
function splitAmount(text: string): { whole: string; decimal: string | null } | null {
  const commas = text.split(',')

  if (commas.length > 2) return null

  if (commas.length === 2) {
    // A comma is always the decimal separator, so nothing after it may be grouped.
    const [whole = '', decimal = ''] = commas
    if (decimal.includes('.')) return null
    return { whole, decimal }
  }

  const groups = text.split('.')
  if (groups.length === 1) return { whole: text, decimal: null }

  const last = groups[groups.length - 1] ?? ''

  // Exactly three digits in the final group is a thousands group; one or two is the
  // øre. Any other length is neither, and is refused rather than interpreted.
  if (last.length === 3) return { whole: text, decimal: null }
  if (last.length === 1 || last.length === 2) {
    return { whole: groups.slice(0, -1).join('.'), decimal: last }
  }

  return null
}

/** The digits of a grouped whole part — "1.500" → "1500" — or `null` if misgrouped. */
function digitsOfWhole(whole: string): string | null {
  const groups = whole.split('.')

  // An ungrouped number is just digits: "1500" and "10000" are perfectly ordinary ways
  // to write a price, and the three-digit rule applies only once a separator is used.
  if (groups.length === 1) return whole.length > 0 ? whole : null

  const wellFormed = groups.every((group, index) =>
    index === 0 ? group.length >= 1 && group.length <= 3 : group.length === 3,
  )

  return wellFormed ? groups.join('') : null
}

/**
 * Read a price the way a person typed it.
 *
 * A `priceOre` of `null` is not an error: it means the field was left empty, which the
 * column allows and which the public menu renders as a dish without a fixed price.
 */
export function parseKronerToOre(input: string): PriceParseResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) return { ok: true, priceOre: null }

  if (!AMOUNT_CHARACTERS.test(trimmed)) return refuse('not_a_number')

  const parts = splitAmount(trimmed)
  if (parts === null) return refuse('not_a_number')

  if (parts.decimal !== null && parts.decimal.length > 2) return refuse('too_many_decimals')

  const wholeDigits = digitsOfWhole(parts.whole)
  if (wholeDigits === null) return refuse('not_a_number')

  const kroner = Number(wholeDigits)
  const ore = parts.decimal === null ? 0 : Number(parts.decimal.padEnd(2, '0'))

  if (!Number.isSafeInteger(kroner)) return refuse('out_of_range')

  const priceOre = kroner * 100 + ore
  if (priceOre > MAX_PRICE_ORE) return refuse('out_of_range')

  return { ok: true, priceOre }
}

/**
 * Stored øre as the editor's field shows them: "89", "89,50", or "" for no price.
 *
 * Deliberately **not** `formatPrice`. That function renders the public menu and ends
 * in " kr." because the design says so; a value carrying a unit inside a field already
 * labelled "Pris (kr.)" would be read back as "89 kr." and refused by the parser
 * above. Two audiences, two functions, one direction of conversion each.
 */
export function formatOreForInput(priceOre: number | null): string {
  if (priceOre === null) return ''

  if (!Number.isInteger(priceOre) || priceOre < 0) {
    throw new TypeError(
      `A price is stored in whole, non-negative øre. Received: ${String(priceOre)}`,
    )
  }

  const kroner = Math.floor(priceOre / 100)
  const ore = priceOre % 100

  return ore === 0 ? String(kroner) : `${String(kroner)},${String(ore).padStart(2, '0')}`
}
