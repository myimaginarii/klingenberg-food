import 'server-only'

import type { Profile } from '@/lib/auth/session'
import { newDishInput, type NewDishInput } from '@/lib/schemas/menu'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { mayChangeEntity } from './authorize'

/**
 * Creating content that has never been live — technical plan §4, §6; design 1r
 * ("+ Tilføj ret").
 *
 * A new dish is not a published dish that happens to be empty. It is a row carrying
 * `is_new_draft = true`, which is what keeps it out of the public menu until somebody
 * presses Offentliggør: `dishes_select_public` refuses it to `anon`, and
 * `publish_dish()` clears the flag in the same statement as the merge, so the dish
 * becoming visible and its draft being cleared cannot come apart.
 *
 * So creation is deliberately **not** a draft write. There is no row yet to attach a
 * draft to, and the phase brief's rule — "do not accidentally create a public live
 * dish first" — is kept by the flag rather than by ordering two writes carefully. The
 * insert either produces an invisible dish or produces nothing.
 *
 * Everything after creation is the ordinary machinery: the price, the description, the
 * labels and the section are edited with `saveEntityDraft` and go live with
 * `publishPendingChange`. Nothing about publishing is reimplemented here.
 *
 * FOUR GATES, IN ORDER
 *
 *   1. **The role matrix**, before the database sees anything (§5). Dishes are Staff,
 *      but the question is asked rather than assumed, so a future matrix change is one
 *      edit in one table.
 *   2. **The schema**, strictly. An unknown key is a refusal; a blank name is a
 *      refusal; a category that is not a uuid never reaches a query.
 *   3. **The caller's own rule**, passed in as `categoryAllows`. Whether a section may
 *      hold ordinary dishes is menu knowledge (`lib/menu/admin.ts`), not publishing
 *      knowledge, so this module asks rather than decides — and the caller cannot
 *      forget to, because the argument is required.
 *   4. **RLS**, through the caller's own JWT, which re-checks `is_staff()` on the
 *      insert itself. Neither layer is trusted to be the only one.
 *
 * The audit row goes through `public.log_audit()`, the single SECURITY DEFINER door
 * into `audit_log` (§8). It stamps the actor from the JWT, never from a parameter, so
 * "who created this dish" cannot be claimed by the application.
 */

export type CreateDishStatus =
  /** The dish exists, unpublished. `dishId` names it. */
  | 'created'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The submitted values did not satisfy `newDishInput`. */
  | 'invalid'
  /** The section does not exist, or is not one that may hold ordinary dishes. */
  | 'invalid_category'
  /** The database refused the insert. */
  | 'failed'

export type CreateDishResult = {
  readonly status: CreateDishStatus
  readonly dishId: string | null
  /**
   * The new row's version token (§6), so the caller can write the rest of the dish as
   * an ordinary draft without reading the row back. Present only when `created`.
   */
  readonly updatedAt: string | null
  /** Danish messages from the schema, ready to show. Empty unless `invalid`. */
  readonly messages: readonly string[]
}

export type CreateDishRequest = {
  /** Raw, unvalidated values. Parsed here and never used before that. */
  readonly values: unknown
  /**
   * Where the dish should sit in its section's order. The end of it (§ phase brief),
   * computed by the caller from the section it is actually joining.
   */
  readonly sortOrder: number
  /** Menu rule: may this section hold ordinary dishes? See `mayHoldDishes`. */
  readonly categoryAllows: (categoryId: string) => boolean
}

function refusal(status: CreateDishStatus, messages: readonly string[] = []): CreateDishResult {
  return { status, dishId: null, updatedAt: null, messages }
}

export async function createDishDraft(
  profile: Profile,
  request: CreateDishRequest,
): Promise<CreateDishResult> {
  if (!mayChangeEntity('dish', profile)) return refusal('forbidden')

  const parsed = newDishInput.safeParse(request.values)
  if (!parsed.success) {
    return refusal('invalid', [...new Set(parsed.error.issues.map((issue) => issue.message))])
  }

  const input: NewDishInput = parsed.data

  // Asked of the *server's* own view of the sections, never of the submitted form.
  // A uuid that is a real category is still refused when that category is Ugens ret.
  if (!request.categoryAllows(input.category_id)) return refusal('invalid_category')

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('dishes')
    .insert({
      category_id: input.category_id,
      name: input.name,
      sort_order: request.sortOrder,
      // The one column that makes this a creation rather than a publish.
      is_new_draft: true,
    })
    .select('id, updated_at')
    .maybeSingle<{ id: string; updated_at: string }>()

  if (error !== null) {
    // RLS refuses a non-staff insert with a row-level-security violation; anything else
    // is a constraint or an unreachable database. The message is for the server log.
    console.error(`Creating a dish failed: ${error.message}`)
    return refusal(error.code === '42501' ? 'forbidden' : 'failed')
  }

  if (data === null) return refusal('failed')

  // `before` is null: there was nothing before. `after` records what was created, which
  // is what makes an accidental creation recoverable from the log (§8).
  const audit = await supabase.rpc('log_audit', {
    p_action: 'create',
    p_entity: 'dish',
    p_entity_id: data.id,
    p_before: null,
    p_after: {
      category_id: input.category_id,
      name: input.name,
      sort_order: request.sortOrder,
      is_new_draft: true,
    },
  })

  if (audit.error !== null) {
    // The dish exists and is invisible to guests; failing the whole creation here would
    // leave the person with no dish and no explanation. Record it and carry on — the
    // creation is still visible in the administration, which is the recoverable state.
    console.error(`Could not write the audit row for dish ${data.id}: ${audit.error.message}`)
  }

  return { status: 'created', dishId: data.id, updatedAt: data.updated_at, messages: [] }
}
