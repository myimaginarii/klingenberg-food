import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { publishableEntity } from '@/lib/publishing/entities'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { IsoDate } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

/**
 * Marking a dish Udsolgt i dag, and taking it back — technical plan §6, §7b.
 *
 * The immediate path, and the only one in this system. Everything else a person edits
 * about a dish becomes a draft and waits for Offentliggør; availability changes the
 * public menu on the next request. Design 1aa states the exception in as many words:
 * *"Tilgængelig / Udsolgt er den eneste undtagelse fra kladde → offentliggør."*
 *
 * This module is a **wrapper, not a mechanism**. The transaction is
 * `public.set_dish_sold_out()`; what happens here is only the three things that cannot
 * happen inside the database:
 *
 *   1. the role matrix is asked first, so a refusal is a sentence rather than a silent
 *      no-op from RLS (§5);
 *   2. **today's Copenhagen date is determined**, by the same boundary module the
 *      hours engine uses — never by the browser, and never by the host's clock;
 *   3. the database's reply is mapped to a status the Server Action can act on.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   * **It does not decide when a marking resets.** That is `resolveSoldOut()` in
 *     `lib/menu/availability.ts` (§7b), which the public menu and the administration
 *     both already call. Nothing here computes an opening instant, and nothing here
 *     stores one.
 *   * **It does not touch a draft.** Not `dishes.draft`, not `pending_changes`, not
 *     `lib/publishing/*` beyond borrowing the role matrix and the cache tags that are
 *     stated once for the `dish` entity. A dish marked sold out gains no Kladde badge
 *     and appears in no publish list, which is exactly what §6 promises.
 *   * **It does not expire a cache tag.** It returns the tags to expire, and the
 *     Server Action expires them only after a result that says something changed —
 *     the same split, and for the same reason, as `lib/publishing/publish.ts`.
 *
 * UNDO IS A SECOND WRITE, AND IT WRITES A *STATE*, NOT A STORED DATE
 *
 * `soldOut` is a boolean, not a date, and that is the design rather than a
 * simplification. `sold_out_on` means "marked sold out on this Copenhagen date"; a
 * Fortryd that restored a literal earlier date would restore a value that
 * `resolveSoldOut()` reads as *already cleared*, so the undo would visibly not undo.
 * Restoring the state and letting the server date it again is the only reading that
 * behaves correctly across midnight — which is the one moment the ten seconds can
 * actually straddle. The caller therefore needs nothing from the browser but the dish,
 * the version token and which of the two states to put it in.
 */

/** The outcome vocabulary. Only `updated` changed anything. */
export type SoldOutStatus =
  /** The dish changed, the attribution columns moved, an audit row was written. */
  | 'updated'
  /** It already held that value. Nothing was written and nothing was logged. */
  | 'unchanged'
  /** Somebody else changed the dish first (§6). Nothing was written. */
  | 'conflict'
  /** No such dish, or the caller may not see it, or it is deleted. */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The date was neither NULL nor today in Copenhagen — the database refused it. */
  | 'invalid_date'
  /** The database refused the write, or was unreachable. */
  | 'failed'

export type SetDishSoldOutResult = {
  readonly status: SoldOutStatus
  /** The state the dish is in now, when the operation reached the row. */
  readonly soldOut: boolean | null
  /**
   * The new version token, so the undo the screen offers is bound to *this* write.
   * Present when the row was reached; `null` on a refusal that never read it.
   */
  readonly updatedAt: string | null
  /** The tags to expire — empty unless something actually changed. */
  readonly cacheTags: readonly CacheTag[]
}

export type SetDishSoldOutRequest = {
  readonly dishId: string
  /** `true` marks it Udsolgt i dag; `false` returns it to Tilgængelig. */
  readonly soldOut: boolean
  /** The `updated_at` the screen was rendered from. The concurrency token (§6). */
  readonly expectedUpdatedAt: string
  /** The instant to date the marking from. Injected so the rule is testable. */
  readonly now?: Date
}

/** The database function's reply. Anything else is treated as a failure. */
const rpcResultSchema = z.object({
  status: z.enum([
    'updated',
    'unchanged',
    'conflict',
    'not_found',
    'forbidden',
    'invalid_date',
  ]),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
  after: z.object({ sold_out_on: z.string().nullable() }).nullish(),
})

function refusal(status: SoldOutStatus): SetDishSoldOutResult {
  return { status, soldOut: null, updatedAt: null, cacheTags: [] }
}

/**
 * The Copenhagen calendar date to write, for a given intent.
 *
 * Exported because it is the whole of rule 4 in the migration's header, and a rule
 * worth stating in a comment is worth asserting in a test.
 */
export function soldOutDateFor(soldOut: boolean, now: Date): IsoDate | null {
  return soldOut ? copenhagenDateOf(now) : null
}

export async function setDishSoldOut(
  profile: Profile,
  request: SetDishSoldOutRequest,
): Promise<SetDishSoldOutResult> {
  // Dishes are Staff in the §5 matrix, and owners are staff — but the question is
  // asked of the same table publishing asks, so a future matrix change is one edit.
  if (!mayChangeEntity('dish', profile)) return refusal('forbidden')

  const soldOutOn = soldOutDateFor(request.soldOut, request.now ?? new Date())

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('set_dish_sold_out', {
    p_id: request.dishId,
    p_sold_out_on: soldOutOn,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    // The transaction rolled back: the dish, its attribution columns and the audit log
    // are all as they were. The message is for the server log, never for the browser.
    console.error(`Availability change failed for dish ${request.dishId}: ${error.message}`)
    return refusal('failed')
  }

  const parsed = rpcResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error(`Unexpected availability result for dish ${request.dishId}.`)
    return refusal('failed')
  }

  const { status } = parsed.data
  if (status !== 'updated' && status !== 'unchanged') return refusal(status)

  return {
    status,
    // Read back from the row the database returned rather than echoed from the
    // request: what the screen reports must be what was stored.
    soldOut: (parsed.data.after?.sold_out_on ?? null) !== null,
    updatedAt: parsed.data.updated_at ?? null,
    // Stated once, for the `dish` entity, in the publishing registry — the Forside's
    // featured burgers come from the same cached read as the menu, so this one tag
    // covers both pages.
    cacheTags: status === 'updated' ? publishableEntity('dish').cacheTags : [],
  }
}

/**
 * The Fortryd strip's sentence, after an availability change went through.
 *
 * 1r's own wording, unchanged: *"«Thor» er nu markeret som udsolgt på hjemmesiden."*
 * The available half is its mirror.
 *
 * It lives here rather than inside the strip for the reason `describeDishDeleted` in
 * `lib/menu/delete.ts` gives: the two immediate operations (§6) each own their
 * own vocabulary, both are asserted by the unit suite, and neither is composed in a
 * component that a test would have to render to read. `AvailabilityUndo` is then the
 * same shape as `DeleteUndo` — a strip that is handed a sentence rather than one that
 * decides one.
 *
 * `soldOut` is the state the dish is in **now**, which is what the sentence reports.
 * It is deliberately not the state Fortryd would restore: a strip that described the
 * undo rather than the change would be reporting something that has not happened.
 */
export function describeAvailabilityChange({
  dishName,
  soldOut,
}: {
  readonly dishName: string
  readonly soldOut: boolean
}): string {
  return soldOut
    ? `«${dishName}» er nu markeret som udsolgt på hjemmesiden.`
    : `«${dishName}» er nu tilgængelig på hjemmesiden.`
}
