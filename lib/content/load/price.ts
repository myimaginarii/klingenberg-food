/**
 * Money on disk, money in the domain — one conversion, in one place.
 *
 * A price is **stored** as the kroner string a person writes on a menu ("89",
 * "12,50"), because that is what the restaurant edits and what a content editor must
 * never have to translate into minor units. It is **used** as the whole number of øre
 * the domain model has always carried (`Dish.priceOre`, `lib/format/danish.ts`), so
 * nothing downstream changes and no price is ever a floating-point number: the kroner
 * and the øre are parsed as two integers and combined with one multiplication.
 *
 * Both separators are accepted because both are written by hand; one or two decimals
 * are accepted for the same reason. Anything else is refused loudly at build time
 * rather than rounded into a price nobody chose.
 */

const KRONER = /^(\d+)(?:[.,](\d{1,2}))?$/

/**
 * The whole number of øre a stored kroner string means — `null` for a priceless entry.
 *
 * @param where What is being priced, for the message a bad value produces.
 */
export function oreFromKroner(value: string | null, where: string): number | null {
  if (value === null) return null

  const match = KRONER.exec(value.trim())
  if (match === null) {
    throw new TypeError(
      `${where}: a price is written in kroner, as "89" or "12,50". Received: ${JSON.stringify(value)}`,
    )
  }

  const kroner = Number.parseInt(match[1]!, 10)
  const ore = Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10)

  return kroner * 100 + ore
}
