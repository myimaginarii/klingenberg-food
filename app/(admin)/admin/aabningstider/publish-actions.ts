'use server'

import { redirect } from 'next/navigation'

import { requireOwner } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChanges, tagsToExpire } from '@/lib/publishing/publish'

import { openingHoursHref } from './routes'

/**
 * "Offentliggør" on the Åbningstider screen — design 1t, technical plan §5, §6.
 *
 * §6: *"Section screens publish their own scope."* This screen's scope is one entity —
 * `opening_hours` — which is one singleton row, so there is one draft and one publish.
 *
 * The action takes **nothing at all** from the browser. Not an entity name, not an id, not
 * a version token, not a schedule:
 *
 *   1. `requireOwner()` establishes who is asking, and refuses a staff session before
 *      anything is read (§5).
 *   2. `readPendingChanges()` — the `security_invoker` view — says what is pending, so RLS
 *      decides which rows exist. The list is narrowed to this screen's one entity, and an
 *      empty one ends here: a screen with nothing waiting must say so rather than report a
 *      publish that was never going to happen.
 *   3. `publishPendingChanges` publishes it, re-authorizing it against the entity **the
 *      server resolved** and re-validating the **stored** draft against
 *      `openingHoursDraft` before the merge (§5, §8).
 *   4. Only then, and only if it actually published, is the `hours` cache tag expired.
 *
 * So a forged POST can ask for this owner's own pending opening-hours change to be
 * published and nothing else. It cannot name a different entity, publish somebody else's
 * pending item, or carry a schedule of its own.
 *
 * **There is no second publishing system here.** The transaction, the audit row, the
 * concurrency check and the draft-clearing all live in `lib/publishing/publish.ts` and
 * `public.publish_opening_hours()`, both untouched since phase 4 — including that
 * function's own re-reading of the row, its `conflict` and `forbidden` answers, and the
 * `is_valid_opening_schedule()` CHECK that the merged document must still satisfy. This
 * phase adds no migration and no database function.
 *
 * WHAT PUBLISHING THE WEEK ACTUALLY MOVES (§7)
 *
 * The `hours` tag is the one this entity's registry entry names, and expiring it is
 * expiring every public page: the schedule is in the footer of all of them, in the header's
 * open/closed badge, on the Forside's Besøg os panel and on Find os. It is also what §7b's
 * sold-out reset resolves against — the reset is *derived on read* from `sold_out_on` plus
 * the current hours, with nothing stored — so the new schedule becomes the one those
 * calculations use from the moment this commits, with no reset job to run and no second
 * code path to keep in step. That is a property of phase 2's design, not something this
 * action arranges, and it is why nothing here mentions a dish.
 *
 * **No announcement is written, in any branch.** The generated opening-hours message
 * belongs to the one-off card's own publish (`./override-publish-actions.ts`, phase
 * 8C-3B); publishing the recurring week never composes one, and nothing in this file
 * names `public.announcement` or its cache tag.
 */
export async function publishOpeningHours(): Promise<void> {
  const profile = await requireOwner()
  await enforceRateLimit('content:publish', openingHoursHref({ status: RATE_LIMIT_STATUS }))

  const pending = (await readPendingChanges()).filter(
    (change) => change.entity === 'opening_hours',
  )

  if (pending.length === 0) redirect(openingHoursHref({ status: 'intet_valgt' }))

  const results = await publishPendingChanges(
    profile,
    pending.map((change) => ({
      entity: change.entity,
      entityId: change.entityId,
      expectedUpdatedAt: change.updatedAt,
    })),
  )

  // Only now, and only for what actually went live.
  expirePublicCacheTags(tagsToExpire(results))

  const published = results.some((result) => result.status === 'published')

  if (!published) {
    // The reason is the one the machinery returned, not a guess: a stale token is a
    // conflict, a draft that no longer parses is `invalid_draft`, and RLS refusing an
    // owner-only merge is `forbidden`. Each has its own sentence on the screen.
    const [result] = results

    redirect(openingHoursHref({ status: result?.status ?? 'publish_failed' }))
  }

  redirect(openingHoursHref({ focus: true, status: 'offentliggjort' }))
}
