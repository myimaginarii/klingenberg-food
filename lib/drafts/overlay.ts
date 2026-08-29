import type { DraftSpec } from '@/lib/schemas/define'

/**
 * The draft overlay — technical plan §6.
 *
 * **This is the only place in the repository where a draft is merged over other
 * values.** Reading a draft in preview, and adding an edit to an existing draft, are
 * the same operation with different inputs, so they are the same code. That is what
 * makes the merge rules a property of the system rather than a habit each caller has
 * to remember.
 *
 * The four rules, and why each is the way it is:
 *
 *   1. **A field the draft does not mention keeps its live value.** The merge asks
 *      `Object.hasOwn(draft, field)`, not `draft[field] !== undefined`. A draft holds
 *      only what somebody edited, so an absent field is "not edited" — never "set to
 *      nothing". Getting this wrong would blank a description the moment somebody
 *      changed a price.
 *
 *   2. **`null` is an edit.** A field present with the value `null` clears the live
 *      value, because "remove the note" is a real thing a person does. That is why
 *      rule 1 tests for presence rather than for a value.
 *
 *   3. **Only fields on the entity's allow-list are considered.** `spec.fields` comes
 *      from the entity's Zod shape, so the list cannot drift from the schema. A draft
 *      that somehow contains `updated_by`, `sold_out_on` or `role` contributes
 *      nothing, whatever else is true about it.
 *
 *   4. **A stored draft that does not parse is not applied at all.** Half of a
 *      malformed draft is worse than none of it: the preview would show a mixture
 *      nobody wrote and nobody could publish. `malformed` is returned so the preview
 *      bar can say so out loud rather than looking identical to "no draft".
 *
 * The SQL publish functions repeat rules 1–3 with `draft ? 'column'`, over the same
 * field lists, because the merge that produces the preview and the merge that produces
 * the live row have to agree. The unit suite asserts both against the same fixtures.
 *
 * Nothing here knows about Supabase, React or Next.js, so the tests exercise the real
 * thing rather than a stand-in.
 */

export type DraftOverlay<Row> = {
  /** The base with the draft applied, or the untouched base. */
  readonly row: Row
  /** The allow-listed fields the draft actually changed, in schema order. */
  readonly changedFields: readonly string[]
  /** True when a draft was present but could not be parsed, and was therefore ignored. */
  readonly malformed: boolean
}

/**
 * A JSON object, as opposed to an array, a scalar or null.
 *
 * Exported because a draft, a stored page document and an existing draft being added to
 * all have to answer the same question, and three copies of it would be three chances
 * to forget that `typeof null === 'object'` and that an array is one too.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge already-validated draft values over a base object.
 *
 * Rules 1–3 live here and nowhere else. `values` must already have passed the entity's
 * schema; this function does not validate, it only decides which keys move across.
 * Nothing is spread wholesale: every key that survives is a key `spec.fields` names.
 */
export function mergeDraftValues<Base extends object>(
  base: Base,
  values: Record<string, unknown>,
  spec: DraftSpec,
): { row: Base; changedFields: readonly string[] } {
  const merged = { ...base } as Record<string, unknown>
  const changedFields: string[] = []

  for (const field of spec.fields) {
    if (!Object.hasOwn(values, field)) continue
    merged[field] = values[field]
    changedFields.push(field)
  }

  return { row: merged as Base, changedFields }
}

/**
 * Apply a stored `draft` value over a live row or document.
 *
 * `live` is the row exactly as the database returned it — database casing, database
 * types — because that is what the loaders map to domain types afterwards, and what
 * the SQL publish functions merge with the same rules. Overlaying before the mapping
 * step is what keeps the public components free of any knowledge that drafts exist.
 */
export function overlayDraft<Row extends object>(
  live: Row,
  storedDraft: unknown,
  spec: DraftSpec,
): DraftOverlay<Row> {
  if (storedDraft === null || storedDraft === undefined) {
    return { row: live, changedFields: [], malformed: false }
  }

  if (!isPlainObject(storedDraft)) {
    return { row: live, changedFields: [], malformed: true }
  }

  // `spec.stored` drops keys the schema does not know and validates the ones it does.
  // Rule 4: a known field that fails validation invalidates the whole draft.
  const parsed = spec.stored.safeParse(storedDraft)
  if (!parsed.success) {
    return { row: live, changedFields: [], malformed: true }
  }

  const { row, changedFields } = mergeDraftValues(
    live,
    parsed.data as Record<string, unknown>,
    spec,
  )

  return { row, changedFields, malformed: false }
}
