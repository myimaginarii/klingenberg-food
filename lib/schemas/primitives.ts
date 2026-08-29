import { z } from 'zod'

/**
 * The field kinds every draft schema is built from — technical plan §4.
 *
 * Each one mirrors a column type and its CHECK constraint, so a value the database
 * would refuse is refused here first, with a Danish message a person can act on. The
 * database remains the authority; this layer exists so a staff member is told what is
 * wrong instead of seeing a constraint violation.
 *
 * Two rules run through all of them:
 *
 *   * **Blank is absent.** Free text is trimmed, and a field left empty becomes `null`
 *     rather than `''`. The public site removes a block rather than rendering an empty
 *     one (1g), so an empty string would be a value that renders as a gap.
 *   * **`null` is a value.** Every nullable field accepts an explicit `null`, which is
 *     how a draft says "clear this". The overlay and the SQL merge both distinguish
 *     that from a field the draft never mentions.
 */

/** Text that must be there: a name, a heading, a section title. */
export function requiredText(max: number, what: string) {
  return z
    .string({ error: `${what} skal være tekst.` })
    .trim()
    .min(1, { error: `${what} må ikke være tomt.` })
    .max(max, { error: `${what} må højst være ${max} tegn.` })
}

/** Text that may be left out. Blank and `null` both mean "no value". */
export function optionalText(max: number, what: string) {
  return z
    .union([z.string(), z.null()], { error: `${what} skal være tekst.` })
    .transform((value) => (value === null ? null : value.trim()))
    .refine((value) => value === null || value.length <= max, {
      error: `${what} må højst være ${max} tegn.`,
    })
    .transform((value) => (value === null || value.length === 0 ? null : value))
}

/**
 * A price in øre. Prices are edited in kroner and stored in minor units (§4); the
 * conversion belongs to the editor, so what arrives here is already an integer.
 */
export function priceOre(what: string) {
  return z
    .union([z.int(), z.null()], { error: `${what} skal være et helt beløb.` })
    .refine((value) => value === null || (value >= 0 && value <= 1_000_000), {
      error: `${what} skal være mellem 0 og 10.000 kr.`,
    })
}

/** A non-negative ordering position. */
export const sortOrder = z
  .int({ error: 'Rækkefølgen skal være et helt tal.' })
  .min(0, { error: 'Rækkefølgen kan ikke være negativ.' })
  .max(10_000, { error: 'Rækkefølgen er urimeligt høj.' })

/** A row identifier the editor picked from a list we control. */
export function rowId(what: string) {
  return z.uuid({ error: `${what} er ikke en gyldig reference.` })
}

/** An optional reference to another row — an image, a category. */
export function optionalRowId(what: string) {
  return z.union([z.uuid({ error: `${what} er ikke en gyldig reference.` }), z.null()])
}

/** A civil date, `YYYY-MM-DD`, exactly as the database stores it (lib/time/calendar.ts). */
export function optionalIsoDate(what: string) {
  return z.union([
    z.iso.date({ error: `${what} skal være en dato (ÅÅÅÅ-MM-DD).` }),
    z.null(),
  ])
}

/** An instant, as an ISO 8601 string. Used for announcement expiry (§7c). */
export function optionalTimestamp(what: string) {
  return z.union([
    z.iso.datetime({ offset: true, error: `${what} skal være et tidspunkt.` }),
    z.null(),
  ])
}

/**
 * An external link. Only `https:` is accepted, and the renderer always adds
 * `rel="noopener noreferrer"` — the two halves of the open-redirect rule in §8.
 */
export function optionalHttpsUrl(what: string) {
  return z.union([
    z
      .url({ protocol: /^https$/, hostname: z.regexes.domain, error: `${what} skal være en https-adresse.` })
      .max(2048, { error: `${what} er for langt.` }),
    z.null(),
  ])
}

/** A telephone number as it is written on the site: digits, spaces and a leading `+`. */
export function optionalPhone(what: string) {
  return z
    .union([z.string(), z.null()])
    .transform((value) => (value === null ? null : value.trim()))
    .transform((value) => (value === null || value.length === 0 ? null : value))
    .refine((value) => value === null || /^\+?[\d ]{6,20}$/.test(value), {
      error: `${what} skal være et telefonnummer, fx +45 63 90 83 00.`,
    })
}

/** An email address, matching the CHECK constraint on `site_contact.email`. */
export function optionalEmail(what: string) {
  return z.union([
    z.email({ error: `${what} skal være en e-mailadresse.` }).max(254),
    z.null(),
  ])
}
