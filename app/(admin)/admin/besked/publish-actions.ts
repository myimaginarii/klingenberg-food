'use server'

import { redirect } from 'next/navigation'

import { announcementPublishOutlook } from '@/lib/announcements/lifecycle'
import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readAdminAnnouncement } from '@/lib/content/announcement-admin'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChanges, tagsToExpire } from '@/lib/publishing/publish'

import { announcementHref } from './routes'

/**
 * "Offentliggør" on the Besked screen — design 1ad, technical plan §6, §7c.
 *
 * §6: *"Section screens publish their own scope."* This screen's scope is one entity —
 * `announcement` — which is one singleton row, so there is one draft and one publish.
 *
 * The action takes **nothing at all** from the browser:
 *
 *   1. `requireStaff()` establishes who is asking.
 *   2. `readPendingChanges()` — the `security_invoker` view — says what is pending, so
 *      RLS decides which rows exist. The list is narrowed to this screen's one entity,
 *      and an empty one ends here: a screen with nothing waiting must say so rather than
 *      publish something it never showed anybody.
 *   3. `readAdminAnnouncement()` says what publishing *would produce* — the live row with
 *      the draft merged over it — through this person's own JWT.
 *   4. 1ac's two rules are applied to that: a message, and an expiry still in the future.
 *   5. `publishPendingChanges` publishes it, re-authorizing it against the entity the
 *      server resolved (§5, §8).
 *   6. Only then is the `announcement` cache tag expired, and only if it published.
 *
 * So there is no entity name, no id and no version token in the request. A forged POST
 * can ask for this person's own pending announcement to be published and nothing else.
 *
 * **There is no second publishing system here.** The transaction, the audit row, the
 * concurrency check and the draft-clearing all live in `lib/publishing/publish.ts` and
 * `public.publish_announcement()`. The dashboard's own "Offentliggør ændringer" reaches
 * the same function through the same module.
 *
 * WHY THE OUTLOOK IS CHECKED HERE WHEN THE DATABASE CHECKS IT TOO
 *
 * `publish_announcement()` refuses a blank message or a missing/past expiry and returns
 * `invalid_draft`, which is the answer a forged request gets. This check exists so that a
 * *person* gets a sentence naming what is wrong instead of a generic refusal — and so the
 * screen can grey Offentliggør out before they press it at all, which is what 1ad draws
 * ("Offentliggør er nedtonet, indtil feltet er gyldigt"). Neither layer is the only one.
 *
 * **Publishing is what puts the bar on the hjemmeside.** `publish_announcement()` sets
 * `is_visible`, because 1ad's three-step path is how a message becomes public. Taking one
 * down again is the immediate path — "Vis besked" off, "Fjern beskeden nu" — and lives in
 * `./visibility-actions.ts`, deliberately not here: §6's table is explicit that it never
 * travels through a draft, and this action is nothing but a draft being published.
 * Nothing in this file writes `is_visible`, `previous`, `replaced_at` or `source`.
 */
export async function publishAnnouncement(): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:publish', announcementHref({ status: RATE_LIMIT_STATUS }))

  const pending = (await readPendingChanges()).filter(
    (change) => change.entity === 'announcement',
  )

  if (pending.length === 0) redirect(announcementHref({ status: 'intet_valgt' }))

  const announcement = await readAdminAnnouncement()
  if (announcement === null) redirect(announcementHref({ status: 'not_found' }))

  // What a guest would read afterwards — the live row with the draft over it, which is
  // exactly what `publish_announcement()` merges. One clock for the whole decision.
  const outlook = announcementPublishOutlook(
    announcement.current,
    new Date(),
    announcement.draftMalformed,
  )

  if (outlook !== 'ready') {
    // Nothing has happened. The screen already says what is wrong, beneath the field it
    // belongs to; this is the answer for the press that got past a disabled button.
    redirect(announcementHref({ focus: true, status: `kan_ikke_${outlook}` }))
  }

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
    /*
     * `invalid_draft` is not "try again" and must not be worded as one.
     * `publishPendingChanges` re-reads the stored draft and refuses before it calls any
     * database function, so the draft is still there, the published row is untouched, and
     * pressing Offentliggør again will meet exactly the same answer. It is separated from
     * the generic failure so the sentence names the one thing that does help — saving the
     * fields again to replace the unreadable draft.
     *
     * The screen normally greys the button out for this state (`unreadable_draft` above),
     * so reaching it here means the draft became unreadable between the render and the
     * press. It is the same answer either way.
     */
    const unreadable = results.some((result) => result.status === 'invalid_draft')

    redirect(
      announcementHref({
        focus: unreadable,
        status: unreadable ? 'kan_ikke_unreadable_draft' : 'publish_failed',
      }),
    )
  }

  redirect(announcementHref({ focus: true, status: 'offentliggjort' }))
}
