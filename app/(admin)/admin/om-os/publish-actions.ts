'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChanges, tagsToExpire } from '@/lib/publishing/publish'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

import { aboutHref } from './routes'

/**
 * "Offentliggør ændringer" on the Om os screen — technical plan §5, §6; phase 14B1.
 *
 * §6: *"Section screens publish their own scope."* This screen's scope is one entity —
 * `page:about` — which is one keyed row, so there is one draft and one publish.
 *
 * The action takes **nothing at all** from the browser:
 *
 *   1. `requireStaff()` establishes who is asking (§5: Staff and Owner alike).
 *   2. `readPendingChanges()` — the `security_invoker` view — says what is pending, so
 *      RLS decides which rows exist. The list is narrowed to this screen's one entity,
 *      and an empty one ends here.
 *   3. `publishPendingChanges` publishes it, re-authorizing it against the entity the
 *      server resolved and re-validating the **stored** draft against the strict
 *      `aboutDraft` before the merge (§5, §8) — so a draft written past the editor with
 *      a key the sections do not know, or by the retired phase-4 editor without the
 *      image keys, is refused as `invalid_draft`, not merged.
 *   4. Only then, and only if it actually published, is the `page:about` tag expired —
 *      the one tag the registry names for this entity, and the tag the page's document
 *      and its three photographs are cached under. The FIRST guest request afterwards
 *      carries the new words and the new pictures together.
 *
 * **There is no second publishing system here.** The transaction, the audit row, the
 * concurrency check and the draft-clearing all live in `lib/publishing/publish.ts` and
 * `public.publish_page()`, which raises the published-image marker around its one
 * merge, so the three photographs go live through this path and no other.
 */
export async function publishAboutPage(): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:publish', aboutHref({ status: RATE_LIMIT_STATUS }))

  const pending = (await readPendingChanges()).filter((change) => change.entity === 'page:about')

  if (pending.length === 0) redirect(aboutHref({ status: 'intet_valgt' }))

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
    redirect(aboutHref({ status: result?.status ?? 'publish_failed' }))
  }

  redirect(aboutHref({ status: 'offentliggjort' }))
}
