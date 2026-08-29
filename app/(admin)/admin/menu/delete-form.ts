import { z } from 'zod'

/**
 * Everything the Slet ret confirmation and its Fortryd may submit — design 1r / 1y,
 * technical plan §8.
 *
 * Its own module rather than part of `delete-actions.ts`, because a `'use server'` file
 * may export nothing but async functions — and its own module rather than part of
 * `availability-form.ts`, because the two are separate operations that must not be able
 * to borrow each other's field names. A form that submits `udsolgt` cannot reach the
 * deletion action, and a form that submits `slettet` cannot reach the availability one.
 *
 * The shape is the smallest one that can express the operation, and every value in it
 * is either an identifier the server re-checks or a token the database re-checks:
 *
 *   * **`ret`** names a dish. It is a uuid used as a filter value; the database decides
 *     whether it exists and whether RLS shows it to this caller.
 *   * **`version`** is the `updated_at` the screen was rendered from — the concurrency
 *     token (§6). A wrong one causes a refusal, never a wrong write. It is what stops a
 *     Fortryd offered ten seconds ago, in a tab nobody closed, from undoing a
 *     colleague's later work.
 *   * **`slettet`** is the *intended state*, one of two literals. Deleting and
 *     restoring travel the same guarded path, so there is no second, less-examined
 *     endpoint for the reverse direction.
 *   * **`sektion`** is navigation only. It decides which chip the redirect reopens and
 *     is never used to decide anything about the dish, so a wrong one produces a
 *     wrong-looking page and nothing else.
 *
 * There is deliberately no field for a name, a price, a category, a label, a draft, a
 * sold-out date — or for whether the dish is featured on Forsiden. That last one is the
 * point of §5 of the phase brief: the warning is decided by the server from the
 * published Forside document, so there is nothing here for a browser to assert about
 * it, truthfully or otherwise.
 */

/** Every field name the deletion forms use. */
export const DELETE_FORM = {
  dishId: 'ret',
  version: 'version',
  /** '1' = soft-delete the dish, '0' = restore it. */
  deleted: 'slettet',
  section: 'sektion',
} as const

export type DeleteDishRequest = {
  readonly dishId: string
  readonly deleted: boolean
  readonly expectedUpdatedAt: string
  readonly section: string | null
}

const requestSchema = z.strictObject({
  dishId: z.uuid(),
  deleted: z.enum(['0', '1']),
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
 * timestamp, a `slettet` that is neither literal, or an extra key the strict schema
 * refuses. The action turns that into one refusal message; it never guesses at what was
 * meant, least of all for a destructive operation.
 */
export function readDeleteForm(formData: FormData): DeleteDishRequest | null {
  const parsed = requestSchema.safeParse({
    dishId: text(formData, DELETE_FORM.dishId),
    deleted: text(formData, DELETE_FORM.deleted),
    expectedUpdatedAt: text(formData, DELETE_FORM.version),
  })

  if (!parsed.success) return null

  const section = text(formData, DELETE_FORM.section)

  return {
    dishId: parsed.data.dishId,
    deleted: parsed.data.deleted === '1',
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    section: section.length > 0 ? section : null,
  }
}
