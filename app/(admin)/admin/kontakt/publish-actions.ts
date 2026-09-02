'use server'

import { redirect } from 'next/navigation'

import { requireOwner } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChanges, tagsToExpire } from '@/lib/publishing/publish'

import { contactHref } from './routes'

/**
 * "Offentliggør ændringer" on Kontaktoplysninger — design 1v, technical plan §5, §6.
 *
 * §6: *"Section screens publish their own scope."* This screen's scope is one entity
 * — `site_contact` — which is one singleton row, so there is one draft and one publish.
 *
 * The action takes **nothing at all** from the browser:
 *
 *   1. `requireOwner()` establishes who is asking, and refuses a staff session before
 *      anything is read (§5).
 *   2. `readPendingChanges()` — the `security_invoker` view — says what is pending.
 *      The list is narrowed to this screen's one entity, and an empty one ends here —
 *      which is what 1v's greyed button already told the person.
 *   3. `publishPendingChanges` publishes it, re-authorizing it against the entity the
 *      server resolved and re-validating the **stored** draft against
 *      `siteContactDraft` before `publish_site_contact()` merges it (§5, §8).
 *   4. Only then, and only if it actually published, is the `contact` tag expired —
 *      the one tag the registry names for this entity. It is on every public page (the
 *      header, the footer, both order bars, Find os), so the FIRST guest request for
 *      any page afterwards carries the new facts, and every `tel:` link with them.
 *
 * **There is no second publishing system here.** The transaction, the audit row, the
 * concurrency check and the draft-clearing live in `lib/publishing/publish.ts` and
 * `public.publish_site_contact()`.
 */
export async function publishContact(): Promise<void> {
  const profile = await requireOwner()

  const pending = (await readPendingChanges()).filter((change) => change.entity === 'site_contact')

  if (pending.length === 0) redirect(contactHref({ status: 'intet_valgt' }))

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
    redirect(contactHref({ status: result?.status ?? 'publish_failed' }))
  }

  redirect(contactHref({ status: 'offentliggjort' }))
}
