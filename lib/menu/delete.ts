import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { publishableEntity } from '@/lib/publishing/entities'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Slet ret, and Fortryd — technical plan §6, §7e item 4; design 1r / 1y.
 *
 * The second immediate path (§6): *"Delete a dish | soft delete (`deleted_at`) | 10 s
 * Fortryd clears `deleted_at`"*. The dish leaves the hjemmeside on the next request
 * with no draft, no preview and no publish, and Fortryd is a second authorized write
 * rather than a rollback of the first.
 *
 * It is a **sibling of `lib/menu/sold-out.ts`, not a generalisation of it.** The two
 * are the same shape from a distance and different underneath — one writes a date the
 * database validates, the other an instant the database chooses; one refuses to touch a
 * deleted dish, the other has to reach one; one is about today, the other about
 * whether the dish exists at all. Two explicit modules of forty lines are easier to
 * audit than one parameterised module of forty, and the negative promise each of them
 * makes — *this operation cannot move anything else* — stays readable in the SQL rather
 * than becoming a function argument.
 *
 * This module is a **wrapper, not a mechanism**. The transaction is
 * `public.set_dish_deleted()`; what happens here is the three things that cannot happen
 * inside the database: the role matrix is asked first so a refusal is a sentence rather
 * than a silent no-op from RLS (§5), the database's reply is mapped to a status the
 * Server Action can act on, and the cache tags to expire are named without being
 * expired — the action does that, and only after a result that changed something.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   * **It does not touch `pages.home`.** §7e item 4 anticipated nulling the Forside's
 *     reference to a deleted dish. That is withdrawn: Forsiden is Owner-only (§5), and
 *     a Staff member deleting a dish must not become a path that edits it. The
 *     reference is left exactly as the Owner wrote it and simply stops resolving —
 *     `selectFeaturedDishes()` has always dropped an id it cannot resolve, so the
 *     Forside stays valid with two cards rather than three, and the Owner can tidy the
 *     stale slot in the Forsiden editor whenever they like. See
 *     {@link describeDishDeletion} for the warning that says so before the fact.
 *   * **It does not touch the draft.** Deleting a dish somebody was midway through
 *     editing preserves their work; restoring it hands the work back untouched, and
 *     the dish reappears in `pending_changes` exactly as it was. The database function
 *     names two columns, so this is a property of the SQL rather than a promise made
 *     here.
 *   * **It does not remove the row.** There is no hard delete and no purge anywhere in
 *     phase 5D. §8's recovery story for a dish is the row itself.
 *   * **It does not expire a cache tag.** It returns the tags; the Server Action
 *     expires them after the transaction has committed — the same split, for the same
 *     reason, as `lib/publishing/publish.ts` and `lib/menu/sold-out.ts`.
 */

/** The outcome vocabulary. Only `deleted` and `restored` changed anything. */
export type DishDeletionStatus =
  /** The dish was soft-deleted and an audit row was written. */
  | 'deleted'
  /** The dish came back, with its draft and its sold-out state intact. */
  | 'restored'
  /** It already stood that way. Nothing was written and nothing was logged. */
  | 'unchanged'
  /** Somebody else changed the dish first (§6). Nothing was written. */
  | 'conflict'
  /** No such dish, or the caller may not see it. */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The database refused the write, or was unreachable. */
  | 'failed'

export type SetDishDeletedResult = {
  readonly status: DishDeletionStatus
  /** Whether the dish is deleted now, as the database reported the row back. */
  readonly deleted: boolean | null
  /**
   * The new version token, so the Fortryd the screen offers is bound to *this* write.
   * Present when the row was reached; `null` on a refusal that never read it.
   */
  readonly updatedAt: string | null
  /** The tags to expire — empty unless something actually changed. */
  readonly cacheTags: readonly CacheTag[]
}

export type SetDishDeletedRequest = {
  readonly dishId: string
  /** `true` soft-deletes the dish; `false` restores it. */
  readonly deleted: boolean
  /** The `updated_at` the screen was rendered from. The concurrency token (§6). */
  readonly expectedUpdatedAt: string
}

/** The database function's reply. Anything else is treated as a failure. */
const rpcResultSchema = z.object({
  status: z.enum(['deleted', 'restored', 'unchanged', 'conflict', 'not_found', 'forbidden']),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
  after: z.object({ deleted_at: z.string().nullable() }).nullish(),
})

function refusal(status: DishDeletionStatus): SetDishDeletedResult {
  return { status, deleted: null, updatedAt: null, cacheTags: [] }
}

export async function setDishDeleted(
  profile: Profile,
  request: SetDishDeletedRequest,
): Promise<SetDishDeletedResult> {
  // Dishes are Staff in the §5 matrix ("Dishes: create, edit, **delete**, reorder"),
  // and owners are staff — but the question is asked of the same table publishing asks,
  // so a future matrix change is one edit in one place.
  if (!mayChangeEntity('dish', profile)) return refusal('forbidden')

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('set_dish_deleted', {
    p_id: request.dishId,
    p_deleted: request.deleted,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    // The transaction rolled back: the dish, its draft and the audit log are all as
    // they were. The message is for the server log, never for the browser.
    console.error(`Deletion change failed for dish ${request.dishId}: ${error.message}`)
    return refusal('failed')
  }

  const parsed = rpcResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error(`Unexpected deletion result for dish ${request.dishId}.`)
    return refusal('failed')
  }

  const { status } = parsed.data
  if (status !== 'deleted' && status !== 'restored' && status !== 'unchanged') {
    return refusal(status)
  }

  return {
    status,
    // Read back from the row the database returned rather than echoed from the
    // request: what the screen reports must be what was stored.
    deleted: (parsed.data.after?.deleted_at ?? null) !== null,
    updatedAt: parsed.data.updated_at ?? null,
    // Stated once, for the `dish` entity, in the publishing registry — the Forside's
    // featured burgers come from the same cached read as the menu, so this one tag
    // covers both pages. Which matters here more than anywhere else: a deleted dish
    // must leave the Forside in the same request it leaves the menu.
    cacheTags: status === 'unchanged' ? [] : publishableEntity('dish').cacheTags,
  }
}

/**
 * What the confirmation asks, and what it warns about — design 1r, technical plan §7e
 * item 4.
 *
 * Pure, and separate from the write above, because it is the half of this feature that
 * has a decision in it. Three things are decided here and nowhere else:
 *
 *   1. **Which question to ask.** A published dish disappears from the hjemmeside; a
 *      dish that has never been published (`is_new_draft`) has never been on it, so
 *      promising a guest-visible consequence would be untrue. The design's own wording
 *      is used for the first case, unchanged: *"Slet Odin? Den forsvinder fra
 *      hjemmesiden."*
 *   2. **Whether to warn about Forsiden.** `featuredOnHomepage` is answered by the
 *      *server*, from the published Forside document, and never by a flag the browser
 *      sent — see `readHomeFeaturedDishIds()`. It changes nothing about what the
 *      deletion does; it is information, not authority.
 *   3. **What the warning says.** Precisely what will happen, in the administration's
 *      own language: the dish goes from the Forside, and the Forside itself is left
 *      alone. No id, no page key and no "reference" — nobody deleting a burger mid-shift
 *      needs to know that `pages.home` exists.
 *
 * The wording lives here rather than inside a component for the reason `lib/menu/admin.ts`
 * already gives about the same kind of sentence: menu vocabulary belongs beside the menu
 * rules, where it can be asserted.
 */
export type DishDeletionPrompt = {
  /** The question, including the dish's name. The dialog's accessible name. */
  readonly question: string
  /** The consequence, one sentence. */
  readonly consequence: string
  /** The Forside warning, or `null` when the dish is not featured there. */
  readonly homepageWarning: string | null
  /** The label on the button that performs it. */
  readonly confirmLabel: string
}

export function describeDishDeletion({
  dishName,
  isNewDraft,
  featuredOnHomepage,
}: {
  readonly dishName: string
  /** True while the dish has never been published and no guest has ever seen it (§4). */
  readonly isNewDraft: boolean
  /** Does the published Forside document currently list this dish? Server-decided. */
  readonly featuredOnHomepage: boolean
}): DishDeletionPrompt {
  return {
    question: `Slet ${dishName}?`,
    consequence: isNewDraft
      ? 'Den er ikke offentliggjort endnu, så den forsvinder kun herfra.'
      : 'Den forsvinder fra hjemmesiden.',
    // A dish nobody has published cannot be on Forsiden, whatever a stale reference
    // says — so the warning is about the published document *and* about a dish that is
    // actually on it.
    homepageWarning:
      featuredOnHomepage && !isNewDraft
        ? 'Denne ret vises også på forsiden. Den forsvinder derfra, men forsiden bliver ikke ændret permanent.'
        : null,
    confirmLabel: 'Slet ret',
  }
}

/**
 * The Fortryd strip's sentence, after a deletion went through.
 *
 * The brief's wording for a published dish, unchanged: *"«Odin» er fjernet fra
 * hjemmesiden."* A dish that was never published was never on the hjemmeside, so it
 * says where it actually went instead — the same distinction {@link describeDishDeletion}
 * draws, kept in step because both are here.
 */
export function describeDishDeleted({
  dishName,
  isNewDraft,
}: {
  readonly dishName: string
  readonly isNewDraft: boolean
}): string {
  return isNewDraft
    ? `«${dishName}» er fjernet fra listen.`
    : `«${dishName}» er fjernet fra hjemmesiden.`
}
