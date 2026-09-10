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
 * are accepted for the same reason. Anything else — a number rather than a string, a
 * currency suffix, three decimals — is refused loudly at build time rather than rounded
 * into a price nobody chose. An **empty** field is not one of those: it is a dish with
 * no price, whichever of the two ways it was emptied.
 */

import { isCleared } from './cleared'

const KRONER = /^(\d+)(?:[.,](\d{1,2}))?$/

/**
 * The whole number of øre a stored kroner string means — `null` for a priceless entry.
 *
 * A price field that was never filled in is `null` when the JSON was written by hand
 * and `""` when it was cleared in a Pages CMS form (`./cleared.ts`). Both are the same
 * answer — this entry has no price — and both give `null`. Anything else non-empty is
 * still parsed, so a price typed wrong is refused rather than dropped.
 *
 * @param where What is being priced, for the message a bad value produces.
 */
export function oreFromKroner(value: string | null | undefined, where: string): number | null {
  if (isCleared(value)) return null

  const match = typeof value === 'string' ? KRONER.exec(value.trim()) : null
  if (match === null) {
    throw new TypeError(
      `${where}: a price is written in kroner, as "89" or "12,50". Received: ${JSON.stringify(value)}`,
    )
  }

  const kroner = Number.parseInt(match[1]!, 10)
  const ore = Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10)

  return kroner * 100 + ore
}
