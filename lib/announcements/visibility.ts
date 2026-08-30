import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { publishableEntity } from '@/lib/publishing/entities'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Taking the announcement down by hand — design 1ad; technical plan §6, §7c.
 *
 * The immediate path. §6's table names it in one line — *"'Vis besked' off / 'Fjern
 * beskeden nu' — writes `is_visible=false` + revalidate — 10 s Fortryd"* — and 1ad says
 * why in the card beside the buttons: *"Fjerne → ét tryk … En forkert besked skal kunne
 * stoppes med det samme."* So it writes no draft, waits for no Offentliggør, and offers
 * about ten seconds of Fortryd.
 *
 * A **wrapper, not a mechanism**, exactly as `lib/menu/sold-out.ts`,
 * `lib/menu/weekly-availability.ts` and `lib/menu/monthly-availability.ts` are for §7b.
 * The transaction is `public.set_announcement_visible()`; what happens here is the three
 * things that cannot happen inside the database:
 *
 *   1. the role matrix is asked first, so a refusal is a sentence rather than a silent
 *      no-op from RLS (§5);
 *   2. the browser's intent is reduced to one boolean — there is nothing else to send;
 *   3. the database's reply is mapped to a status the Server Action can act on.
 *
 * ONE OPERATION, TWO CONTROLS
 *
 * 1ad draws "Vis besked" as a switch at the top of the screen and "Fjern beskeden nu" as
 * a button in the footer. They are **two entrances to this one function**, not two
 * operations: both submit the same field names to the same Server Action, which calls
 * this once. Nothing about "which control was pressed" reaches the server, because
 * nothing about it could change the answer.
 *
 * WHY THIS IS ITS OWN MODULE RATHER THAN A FOURTH ARGUMENT ON A SHARED ONE
 *
 * The same reading §0e answer A records for the three sold-out functions, applied to a
 * fourth immediate operation that is not a sold-out at all: it writes a different column
 * on a different table with a different rule attached to one of its two directions
 * (see {@link AnnouncementVisibilityStatus}'s `not_showable`). A shared "immediate
 * action" module would have to take a table, a column, a row locator and a per-direction
 * guard as arguments — which is a module that can be pointed at a table nobody reviewed.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   * **It does not touch a draft.** Not `lib/publishing/drafts`, not `lib/drafts/`, not
 *     `pending_changes`. A hidden announcement gains no Kladde badge, loses none it had,
 *     and appears in no publish list. A draft written before the hide is byte-identical
 *     after it, and after the undo.
 *   * **It does not publish.** It cannot make pending draft content public: the database
 *     function names one column, and `draft` is not it.
 *   * **It does not write `previous` or `replaced_at`.** Replacing an active announcement
 *     is §6's third immediate row and belongs to phase 8, with 1ae's conflict sheet.
 *     Neither column is named here or in the migration.
 *   * **It does not write `source`.** Generated opening-hours announcements are phase 8.
 *   * **It does not move `expires_at`.** An undo restores visibility; it never extends a
 *     deadline to make itself succeed.
 *   * **It does not expire a cache tag.** It returns the tags, and the Server Action
 *     expires them only after a result that reached the row.
 *
 * UNDO IS A SECOND WRITE
 *
 * §6: *"Undo is not server-held state. The change is already live; undo is simply a
 * second authorized write."* Fortryd calls this function again with `visible: true` and
 * the version token the first write returned, so it is guarded, validated,
 * concurrency-checked and audited exactly as the first press was. If a colleague changes
 * the row in between, the undo is a `conflict` and writes nothing. If the browser
 * navigates away inside the ten seconds the offer is lost and the change stands — which
 * is what §6 says happens, and why the audit log is the recovery path.
 */

/** The outcome vocabulary. Only `updated` changed anything. */
export type AnnouncementVisibilityStatus =
  /** The column changed and an audit row was written. */
  | 'updated'
  /** It already stood that way. Nothing was written and nothing was logged. */
  | 'unchanged'
  /** Somebody else changed the row first (§6). Nothing was written. */
  | 'conflict'
  /** No row, or the caller may not see it. */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /**
   * Asked to switch **on** a bar a guest could not be given — the message is blank, or
   * the expiry has passed. 1ac's two standing rules, applied to the one direction they
   * can apply to. This is the answer when an expiry passes inside the Fortryd window.
   */
  | 'expired'
  /** The same refusal, for the unreachable half: there is no message to show. */
  | 'blank'
  /** The database refused the write, was unreachable, or answered something unknown. */
  | 'failed'

export type SetAnnouncementVisibleResult = {
  readonly status: AnnouncementVisibilityStatus
  /** The state the bar is in now, when the operation reached the row. */
  readonly visible: boolean | null
  /** The new version token, so the undo the screen offers is bound to *this* write. */
  readonly updatedAt: string | null
  /** The tags to expire — empty unless something actually changed. */
  readonly cacheTags: readonly CacheTag[]
}

export type SetAnnouncementVisibleRequest = {
  /** `true` shows the published announcement again; `false` takes it down now. */
  readonly visible: boolean
  /** The `updated_at` the screen was rendered from. The concurrency token (§6). */
  readonly expectedUpdatedAt: string
}

/**
 * The database function's reply. Anything else is treated as a failure.
 *
 * `invalid_request` is in the enum because the function can return it, and is mapped to
 * `failed` below because the application cannot produce it — the form parser refuses a
 * submission that names no intent long before this is called. The same treatment
 * `set_weekly_special_sold_out`'s `invalid_target` gets (§0e answer B): stated, mapped,
 * unreachable.
 */
const rpcResultSchema = z.object({
  status: z.enum([
    'updated',
    'unchanged',
    'conflict',
    'not_found',
    'forbidden',
    'not_showable',
    'invalid_request',
  ]),
  reason: z.enum(['message', 'expires_at']).nullish(),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
  after: z.object({ is_visible: z.boolean() }).nullish(),
})

function refusal(status: AnnouncementVisibilityStatus): SetAnnouncementVisibleResult {
  return { status, visible: null, updatedAt: null, cacheTags: [] }
}

export async function setAnnouncementVisible(
  profile: Profile,
  request: SetAnnouncementVisibleRequest,
): Promise<SetAnnouncementVisibleResult> {
  // The announcement is a Staff row of the §5 matrix, and owners are staff — but the
  // question is asked of the same registry publishing asks, so a future matrix change is
  // one edit rather than several.
  if (!mayChangeEntity('announcement', profile)) return refusal('forbidden')

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('set_announcement_visible', {
    p_visible: request.visible,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    // The transaction rolled back: the row and the audit log are as they were. The
    // message is for the server log, never for the browser.
    console.error(`Announcement visibility change failed: ${error.message}`)
    return refusal('failed')
  }

  const parsed = rpcResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error('Unexpected announcement visibility result.')
    return refusal('failed')
  }

  const { status, reason } = parsed.data

  if (status === 'not_showable') {
    return refusal(reason === 'message' ? 'blank' : 'expired')
  }

  if (status !== 'updated' && status !== 'unchanged') {
    return refusal(status === 'invalid_request' ? 'failed' : status)
  }

  return {
    status,
    // Read back from the row the database returned rather than echoed from the request:
    // what the screen reports must be what was stored.
    visible: parsed.data.after?.is_visible ?? null,
    updatedAt: parsed.data.updated_at ?? null,
    // Stated once, for the `announcement` entity, in the publishing registry.
    cacheTags: status === 'updated' ? publishableEntity('announcement').cacheTags : [],
  }
}

/**
 * The Fortryd strip's sentence, after a visibility change went through.
 *
 * The phase brief's own wording for the removal — *"Beskeden er fjernet fra
 * hjemmesiden."* — and its counterpart for the undo. It lives here rather than inside
 * the strip for the reason `describeAvailabilityChange` lives in `lib/menu/sold-out.ts`:
 * the vocabulary of an operation belongs beside the operation's rules, where the unit
 * suite can assert it without rendering anything.
 *
 * `visible` is the state the bar is in **now**, which is what the sentence reports. It
 * is deliberately not the state Fortryd would restore: a strip that described the undo
 * rather than the change would be reporting something that has not happened.
 */
export function describeAnnouncementVisibilityChange({
  visible,
}: {
  readonly visible: boolean
}): string {
  return visible
    ? 'Beskeden vises igen på hjemmesiden.'
    : 'Beskeden er fjernet fra hjemmesiden.'
}
