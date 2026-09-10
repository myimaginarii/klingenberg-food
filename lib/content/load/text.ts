/**
 * Free text on disk, free text as rendered — with one exception, stated here.
 *
 * A prose field is handed out exactly as an editor wrote it. The loaders rewrite
 * nothing: no dashes, no quotation marks, no unit spacing. The rendered site is the
 * tracked JSON, character for character, and an editor never has to wonder what the
 * loader will do to a sentence.
 *
 * The one exception is the Burgere section's intro. Before the content moved to JSON
 * that sentence was the only public copy carrying a non-breaking space — between
 * each number and "kr." ("124 kr., Ragnar 132 kr."), so a narrow column never wraps to
 * a line that starts with "kr.". That typography was approved, the JSON stores an
 * ordinary space so nobody has to type U+00A0 into an editable file, and
 * `menu.ts` applies {@link keepPriceTogether} to that one field on the way out.
 * Every other price in prose ("fra 124 kr." on the Forside, the tapas board's
 * "295 kr.") renders with the ordinary space it always had.
 */

/** A digit, one ordinary space, then "kr." — the join the Burgere intro keeps together. */
const PRICE_BEFORE_KR = /(\d) kr\./g

const NO_BREAK_SPACE = String.fromCharCode(0xa0)

/** "295 kr." with a non-breaking space before "kr.". Text without a price is returned as is. */
export function keepPriceTogether(text: string): string {
  return text.replace(PRICE_BEFORE_KR, `$1${NO_BREAK_SPACE}kr.`)
}

/**
 * A free-text field as the site renders it: an absent field is `null` — the value
 * every page already treats as "not written" — and a present one is the text as written.
 */
export function prose(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value
}
