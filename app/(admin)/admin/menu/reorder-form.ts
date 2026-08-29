import { z } from 'zod'

/**
 * Everything a reorder submission may carry — design 1r / 1y, technical plan §6, §8.
 *
 * Its own module, for the two reasons the availability and deletion vocabularies each
 * have their own: a `'use server'` file may export nothing but async functions, and two
 * operations that must not be able to borrow each other's field names should not share
 * a file. A form carrying `til` cannot reach the deletion action, and one carrying
 * `slettet` cannot reach this one.
 *
 * Four fields, and none of them is authority:
 *
 *   * **`ret`** names the dish to move. A uuid used as a lookup value; the server finds
 *     it in the section it just read for itself, and a dish that is not there refuses
 *     the move.
 *   * **`til`** is the destination, as a **zero-based index into the section's list** —
 *     not a `sort_order`. That distinction is deliberate: a browser proposing a position
 *     is proposing something about a list it can see, while a browser proposing a
 *     `sort_order` would be proposing a database value. The server turns the first into
 *     the second (`lib/menu/reorder.ts`), so the numbering scheme is never a thing the
 *     browser gets an opinion about.
 *   * **`grundlag`** is the fingerprint of the order the screen was rendered from. The
 *     server recomputes it and refuses a move made against a list somebody else has
 *     since changed (§7e item 2). It authorises nothing; see `orderFingerprint`.
 *   * **`sektion`** is navigation only. It decides which chip the redirect reopens and
 *     is never used to decide anything about the dish, so a wrong one produces a
 *     wrong-looking page and nothing else.
 *
 * There is deliberately **no field for a `sort_order`, for a list of ids, for a
 * category, or for the dish's version token.** The order comes from the server's own
 * read; the version tokens come with it. A submission cannot propose which rows to
 * write or what to write into them — only which dish it wants where.
 */

/** Every field name the reorder forms use. */
export const REORDER_FORM = {
  dishId: 'ret',
  /** The destination, zero-based, in the section's current list. */
  toIndex: 'til',
  /** The fingerprint of the order the screen was rendered from. */
  baseline: 'grundlag',
  section: 'sektion',
} as const

export type MoveDishRequest = {
  readonly dishId: string
  readonly toIndex: number
  readonly baseline: string
  readonly section: string | null
}

const requestSchema = z.strictObject({
  dishId: z.uuid(),
  // A string of digits, so `'1e3'`, `'01'`, `' 2'` and `'-1'` are all refused before
  // anything becomes a number. The upper bound is the same one `sortOrder` carries in
  // `lib/schemas/primitives.ts`; the real bound is the section's length, which only the
  // server knows and which `reorderDishes` applies.
  toIndex: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,4})$/)
    .transform(Number)
    .refine((value) => value <= 10_000),
  // Sixteen lowercase hex characters — the shape `orderFingerprint` produces. Parsing it
  // by shape means a malformed token is a refusal rather than a comparison that happens
  // to fail, so the two cases stay tellable apart in a log.
  baseline: z.string().regex(/^[0-9a-f]{16}$/),
})

/** A single form value as a string, or `''`. Files and repeats never reach a rule. */
function text(source: FormData, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Parse a submission, or return `null`.
 *
 * `null` is the answer for anything malformed — a missing dish, an index that is not a
 * plain non-negative integer, a fingerprint of the wrong shape, or an extra key the
 * strict schema refuses. The action turns that into one refusal message and never
 * guesses at what was meant.
 */
export function readReorderForm(formData: FormData): MoveDishRequest | null {
  const parsed = requestSchema.safeParse({
    dishId: text(formData, REORDER_FORM.dishId),
    toIndex: text(formData, REORDER_FORM.toIndex),
    baseline: text(formData, REORDER_FORM.baseline),
  })

  if (!parsed.success) return null

  const section = text(formData, REORDER_FORM.section)

  return {
    dishId: parsed.data.dishId,
    toIndex: parsed.data.toIndex,
    baseline: parsed.data.baseline,
    section: section.length > 0 ? section : null,
  }
}
