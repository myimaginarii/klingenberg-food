'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { isMenuPublishable } from '@/lib/menu/pending'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChanges, tagsToExpire } from '@/lib/publishing/publish'

import { menuHref } from './routes'

/**
 * "Offentliggør ændringer" on the menu screen — design 1r / 1y, technical plan §6.
 *
 * The dashboard publishes a *selection*, so it has checkboxes and a decoder for them.
 * The menu screen's button publishes **this screen's scope**, which is a different
 * thing and is drawn as a single button in the approved frame. So this action takes no
 * input from the browser at all:
 *
 *   1. `requireStaff()` establishes who is asking.
 *   2. `readPendingChanges()` — the `security_invoker` view — says what is pending,
 *      through this person's own JWT, so RLS decides which rows exist.
 *   3. The list is narrowed to the entities this screen owns: dishes and sections.
 *   4. `publishPendingChanges` publishes them, re-authorizing **each item
 *      individually** against the entity the server resolved (§5, §8).
 *   5. Only then are the cache tags of the items that actually published expired.
 *
 * There is no entity name, no id and no version token in the request, so the phase
 * brief's "do not trust entity IDs/types sent from the browser" is not a check this
 * action performs — it is a shape it does not have. A forged POST can ask for this
 * person's own pending menu changes to be published and nothing else.
 *
 * The publish machinery itself is phase 4's, unchanged: the transaction, the audit row,
 * the concurrency check and the draft-clearing all live in `lib/publishing/publish.ts`
 * and the SQL functions beneath it. Nothing about publishing is reimplemented here.
 */
export async function publishMenuChanges(): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:publish', menuHref({ status: RATE_LIMIT_STATUS }))

  // The same predicate the screen's own pending banner counts with, so the button and
  // the sentence above it can never disagree about what "this screen's changes" means.
  const pending = (await readPendingChanges()).filter((change) =>
    isMenuPublishable(change.entity),
  )

  if (pending.length === 0) redirect(menuHref({ status: 'intet_valgt' }))

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

  const published = results.filter((result) => result.status === 'published').length
  const failed = results.length - published

  redirect(
    menuHref({
      status: failed === 0 ? 'offentliggjort' : published === 0 ? 'publish_failed' : 'delvist',
    }),
  )
}
