import { z } from 'zod'

/**
 * How a draft is described, once — technical plan §1 (adjustment 4), §4, §6.
 *
 * A draft is a partial row: the `draft jsonb` column holds only the fields somebody
 * edited, and nothing else. Two different things then need to be true about it, and
 * they are deliberately not the same thing:
 *
 *   * **On the way in**, an unknown key is a rejection. A form or a hand-crafted
 *     request that carries `role`, `updated_by`, `sold_out_on` or any other field
 *     outside the entity's editable scope must fail loudly rather than be quietly
 *     ignored — otherwise "we only write the fields we recognise" is a claim about
 *     the code rather than a property of the system.
 *
 *   * **On the way out**, an unknown key is dropped. A draft already stored by an
 *     older version of a schema must not make a preview throw on a staff member. It
 *     must also not reach a page component, which stripping guarantees.
 *
 * `defineDraft` builds both from one shape, so the two can never describe different
 * field sets, and exposes that field set as `fields` — the allow-list the merge in
 * `lib/drafts/overlay.ts` iterates. There is exactly one list per entity and it is
 * derived, never typed twice.
 *
 * Every field in a shape is `.optional()`: that is what makes the draft partial. A
 * field that is present with the value `null` is an edit that *clears* the value; a
 * field that is absent is not an edit at all. The overlay honours that distinction and
 * the SQL publish functions repeat it with `draft ? 'column'`.
 */

/** The two parses and the allow-list that belong to one entity's draft. */
export type DraftSpec<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  /** The editable field names, in declaration order. The merge allow-list. */
  readonly fields: readonly string[]
  /** Write path: unknown keys are rejected. */
  readonly input: z.ZodObject<Shape, z.core.$strict>
  /** Read path: known keys validated, unknown keys dropped. */
  readonly stored: z.ZodObject<Shape, z.core.$strip>
}

export function defineDraft<Shape extends z.ZodRawShape>(shape: Shape): DraftSpec<Shape> {
  return {
    fields: Object.keys(shape),
    input: z.strictObject(shape),
    stored: z.object(shape),
  }
}

/** The parsed shape of a draft for one entity — a partial row, in database casing. */
export type DraftValues<Spec extends DraftSpec> = z.infer<Spec['stored']>
