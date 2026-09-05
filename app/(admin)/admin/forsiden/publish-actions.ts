'use server'

import { redirect } from 'next/navigation'

import { requireOwner } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChanges, tagsToExpire } from '@/lib/publishing/publish'

import { homeHref } from './routes'

/**
 * "Offentliggør ændringer" on the Forsiden screen — design 1u, technical plan §5, §6.
 *
 * §6: *"Section screens publish their own scope."* This screen's scope is one entity —
 * `page:home` — which is one keyed row, so there is one draft and one publish.
 *
 * The action takes **nothing at all** from the browser. Not an entity name, not an id,
 * not a version token, not a document:
 *
 *   1. `requireOwner()` establishes who is asking, and refuses a staff session before
 *      anything is read (§5).
 *   2. `readPendingChanges()` — the `security_invoker` view — says what is pending, so
 *      RLS decides which rows exist. The list is narrowed to this screen's one entity,
 *      and an empty one ends here.
 *   3. `publishPendingChanges` publishes it, re-authorizing it against the entity **the
 *      server resolved** and re-validating the **stored** draft against `homeDraft`
 *      before the merge (§5, §8) — so a draft an older editor wrote in a shape this
 *      one no longer accepts is refused as `invalid_draft`, not merged.
 *   4. Only then, and only if it actually published, is the `page:home` cache tag
 *      expired — the one tag the registry names for this entity, and the one the
 *      Forside's document, its three photographs and its featured ids are cached under.
 *      The FIRST guest request afterwards carries the new document.
 *
 * **There is no second publishing system here.** The transaction, the audit row, the
 * concurrency check and the draft-clearing all live in `lib/publishing/publish.ts` and
 * `public.publish_page()` — which since phase 11A raises the published-image marker
 * around its one merge, so the three photographs go live through this path and no
 * other.
 */
export async function publishHomePage(): Promise<void> {
  const profile = await requireOwner()
  await enforceRateLimit('content:publish', homeHref({ status: RATE_LIMIT_STATUS }))

  const pending = (await readPendingChanges()).filter((change) => change.entity === 'page:home')

  if (pending.length === 0) redirect(homeHref({ status: 'intet_valgt' }))

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

    redirect(homeHref({ status: result?.status ?? 'publish_failed' }))
  }

  redirect(homeHref({ status: 'offentliggjort' }))
}
