'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChanges, tagsToExpire } from '@/lib/publishing/publish'

import { takeawayHref } from './routes'

/**
 * "Offentliggør ændringer" on the Mad ud af huset screen — design 1aj, technical
 * plan §5, §6, §9 (E2E 8).
 *
 * §6: *"Section screens publish their own scope."* This screen's scope is one entity
 * — `page:takeaway` — which is one keyed row, so there is one draft and one publish.
 *
 * The action takes **nothing at all** from the browser:
 *
 *   1. `requireStaff()` establishes who is asking (§5: Staff and Owner alike).
 *   2. `readPendingChanges()` — the `security_invoker` view — says what is pending, so
 *      RLS decides which rows exist. The list is narrowed to this screen's one entity,
 *      and an empty one ends here.
 *   3. `publishPendingChanges` publishes it, re-authorizing it against the entity the
 *      server resolved and re-validating the **stored** draft against `takeawayDraft`
 *      before the merge (§5, §8) — so a draft written past the editor with a key the
 *      strict section schema does not know is refused as `invalid_draft`, not merged.
 *   4. Only then, and only if it actually published, is the `page:takeaway` tag
 *      expired — the one tag the registry names for this entity, and the tag the
 *      page's document, its photograph, the navigation's visibility read and the
 *      sitemap are all cached under. The FIRST guest request afterwards carries the
 *      new words, the new photo and the new visibility, page and navigation together.
 *
 * **There is no second publishing system here.** The transaction, the audit row, the
 * concurrency check, the draft-clearing and the switch's move into its column all
 * live in `lib/publishing/publish.ts` and `public.publish_page()`.
 */
export async function publishTakeawayPage(): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:publish', takeawayHref({ status: RATE_LIMIT_STATUS }))

  const pending = (await readPendingChanges()).filter((change) => change.entity === 'page:takeaway')

  if (pending.length === 0) redirect(takeawayHref({ status: 'intet_valgt' }))

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
    const [result] = results
    redirect(takeawayHref({ status: result?.status ?? 'publish_failed' }))
  }

  redirect(takeawayHref({ status: 'offentliggjort' }))
}
