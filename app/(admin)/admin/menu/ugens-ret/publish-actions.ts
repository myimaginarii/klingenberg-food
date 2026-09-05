'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChanges, tagsToExpire } from '@/lib/publishing/publish'

import { weeklyHref } from './routes'

/**
 * "Offentliggør" on the Ugens ret screen — design 1ag, technical plan §6.
 *
 * §6: *"Section screens publish their own scope."* This screen's scope is one entity —
 * `weekly_special` — which carries **both** Ugens ret and Lørdagsmenuen, because they
 * are one row (§4) and `publish_weekly_special()` merges them in one transaction. That
 * is also why the two cards do not get a publish button each: there is one draft, and
 * publishing half of a row is not a thing the schema can do.
 *
 * The action takes **no input from the browser at all**:
 *
 *   1. `requireStaff()` establishes who is asking.
 *   2. `readPendingChanges()` — the `security_invoker` view — says what is pending,
 *      through this person's own JWT, so RLS decides which rows exist.
 *   3. The list is narrowed to this screen's one entity.
 *   4. `publishPendingChanges` publishes it, re-authorizing it against the entity the
 *      server resolved (§5, §8).
 *   5. Only then is the `weekly` cache tag expired, and only if it actually published.
 *
 * So there is no entity name, no id and no version token in the request. A forged POST
 * can ask for this person's own pending weekly change to be published and nothing else.
 *
 * **There is no second publishing system here.** The transaction, the audit row, the
 * concurrency check and the draft-clearing all live in `lib/publishing/publish.ts` and
 * `public.publish_weekly_special()`, both untouched since phase 4. The menu screen's
 * own button deliberately excludes this entity (`lib/menu/pending.ts`), so publishing
 * Ugens ret from a screen that never showed it to anybody is not possible either.
 */
export async function publishWeeklySpecial(): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:publish', weeklyHref({ status: RATE_LIMIT_STATUS }))

  const pending = (await readPendingChanges()).filter(
    (change) => change.entity === 'weekly_special',
  )

  if (pending.length === 0) redirect(weeklyHref({ status: 'intet_valgt' }))

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

  redirect(weeklyHref({ status: published > 0 ? 'offentliggjort' : 'publish_failed' }))
}
