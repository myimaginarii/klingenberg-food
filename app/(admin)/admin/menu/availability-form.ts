import { z } from 'zod'

/**
 * Everything the availability control may submit — design 1r / 1y, technical plan §8.
 *
 * Its own module rather than part of `availability-actions.ts`, because a `'use server'`
 * file may export nothing but async functions, and rather than part of `dish-form.ts`,
 * because these are not the dish editor's fields: the availability switch is a separate
 * `<form>` posting to a separate action, and the two must not be able to borrow each
 * other's names.
 *
 * The shape is deliberately the smallest one that can express the operation, and every
 * value in it is either an identifier the server re-checks or a token the database
 * re-checks:
 *
 *   * **`ret`** names a dish. It is a uuid used as a filter value; the database decides
 *     whether it exists, whether RLS shows it to this caller and whether it is deleted.
 *   * **`version`** is the `updated_at` the screen was rendered from — the concurrency
 *     token (§6). A wrong one causes a refusal, never a wrong write.
 *   * **`udsolgt`** is the *intended state*, one of two literals. It is not a date:
 *     the browser cannot choose when a dish was sold out (§7b, and rule 4 of the
 *     `set_dish_sold_out` migration).
 *   * **`sektion`** is navigation only. It decides which chip the redirect reopens and
 *     is never used to decide anything about the dish, so a wrong one produces a
 *     wrong-looking page and nothing else.
 *   * **`ret_aabn`** likewise: it says the editor panel was open, so the redirect
 *     reopens it. A person who flips the switch inside the panel should still be in the
 *     panel afterwards.
 *
 * There is deliberately no field for a price, a name, a category, a draft or a
 * deletion. The negative test in the E2E suite forges each of those onto this form and
 * asserts the dish is untouched; it passes because the schema below is `strictObject`
 * and the database function names three columns.
 */

/** Every field name the availability form uses. */
export const AVAILABILITY_FORM = {
  dishId: 'ret',
  version: 'version',
  /** '1' = mark Udsolgt i dag, '0' = return to Tilgængelig. */
  soldOut: 'udsolgt',
  section: 'sektion',
  /** '1' when the request came from the open editor panel. */
  editorOpen: 'ret_aabn',
} as const

export type AvailabilityRequest = {
  readonly dishId: string
  readonly soldOut: boolean
  readonly expectedUpdatedAt: string
  readonly section: string | null
  readonly editorOpen: boolean
}

const requestSchema = z.strictObject({
  dishId: z.uuid(),
  soldOut: z.enum(['0', '1']),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

/** A single form value as a string, or `''`. Files and repeats never reach a rule. */
function text(source: FormData, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Parse a submission, or return `null`.
 *
 * `null` is the answer for anything malformed — a missing id, a version that is not a
 * timestamp, an `udsolgt` that is neither literal, or an extra key the strict schema
 * refuses. The action turns that into one refusal message; it never guesses at what
 * was meant.
 */
export function readAvailabilityForm(formData: FormData): AvailabilityRequest | null {
  const parsed = requestSchema.safeParse({
    dishId: text(formData, AVAILABILITY_FORM.dishId),
    soldOut: text(formData, AVAILABILITY_FORM.soldOut),
    expectedUpdatedAt: text(formData, AVAILABILITY_FORM.version),
  })

  if (!parsed.success) return null

  const section = text(formData, AVAILABILITY_FORM.section)

  return {
    dishId: parsed.data.dishId,
    soldOut: parsed.data.soldOut === '1',
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    section: section.length > 0 ? section : null,
    editorOpen: text(formData, AVAILABILITY_FORM.editorOpen) === '1',
  }
}
