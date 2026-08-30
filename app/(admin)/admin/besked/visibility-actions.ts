'use server'

import { redirect } from 'next/navigation'

import { setAnnouncementVisible } from '@/lib/announcements/visibility'
import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'

import { readAnnouncementVisibilityForm } from './forms'
import { announcementHref } from './routes'

/**
 * "Vis besked" off, "Fjern beskeden nu", and the Fortryd after either — design 1ad;
 * technical plan §6, §7c.
 *
 * The immediate path, and the only action on this screen that changes the hjemmeside
 * without a publish. §6's table names it; 1ad says it beside the buttons — *"Fjerne →
 * ét tryk … virker straks — ingen forhåndsvisning, ingen offentliggørelse."*
 *
 * Six steps, in a fixed order, and nothing else:
 *
 *   1. establish who is asking          — requireStaff()
 *   2. parse the submission             — ./forms.ts, strictly
 *   3. perform the transaction          — lib/announcements/visibility.ts
 *   4. expire the public cache tag      — only after a result that changed something
 *   5. offer ~10 seconds of Fortryd     — as two query parameters, not as state
 *   6. report                           — a redirect back to the card
 *
 * **ONE ACTION FOR BOTH OF 1ad's CONTROLS.** The switch at the top of the screen and the
 * button in the footer post the same field names here, so there is exactly one place
 * where an announcement is taken down, one authorization check, one concurrency check
 * and one audit row. Duplicating the business operation to serve two drawings of it is
 * the mistake this file exists not to make.
 *
 * **Fortryd is this same action.** The undo strip renders one more visibility form with
 * `vis` inverted and the version token this write returned, so pressing it is a second
 * authorized server write down the identical code path: guarded, validated,
 * concurrency-checked and audited. There is no undo endpoint, no undo token and no
 * server memory of what was undone. If the page is reloaded away the offer is gone and
 * the change stands — which is what §6 says happens, and why the log is the recovery
 * path. The ten seconds are a message's lifetime, not a permission window: a Fortryd
 * pressed from a stale tab is refused or honoured on exactly the same terms as the
 * first press, by the same checks.
 *
 * WHY THE CACHE IS EXPIRED HERE AND NOT IN THE DOMAIN MODULE
 *
 * The same split every other immediate path and every publish action uses: the domain
 * module returns the tags, this action expires them, and only for a status that reached
 * the row. Expiring `announcement` for a write that was refused, conflicted or changed
 * nothing would rebuild the public pages into exactly what they already were while the
 * screen reported an error — the cache telling a story the database does not agree with.
 *
 * WHAT IT DOES NOT DO
 *
 * No draft is written or read, nothing is added to or taken out of `pending_changes`,
 * and `lib/publishing` is not called at all beyond the role matrix and the cache tags
 * stated once for the `announcement` entity. **A pending draft is untouched by all of
 * this**: hiding a published announcement leaves the draft exactly as it was, still
 * pending, still invisible to a guest, and the undo leaves it there too. This action
 * cannot publish anything, because the database function names one column and `draft` is
 * not it.
 *
 * It also writes no `previous`, no `replaced_at` and no `source`. Replacing an active
 * announcement, and the generated opening-hours message 1ae draws a conflict sheet for,
 * are phase 8.
 */
export async function setAnnouncementVisibility(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const request = readAnnouncementVisibilityForm(formData)
  if (request === null) redirect(announcementHref({ status: 'ugyldig', focus: true }))

  const result = await setAnnouncementVisible(profile, {
    visible: request.visible,
    expectedUpdatedAt: request.expectedUpdatedAt,
  })

  if (result.status !== 'updated' && result.status !== 'unchanged') {
    redirect(announcementHref({ focus: true, status: visibilityStatusCode(result.status) }))
  }

  // Committed. Only now may the public site be told, and only for a write that moved the
  // row — `unchanged` changed nothing, so there is nothing to expire and nothing to undo
  // either.
  if (result.status === 'updated') {
    expirePublicCacheTags(result.cacheTags)
  }

  redirect(
    announcementHref({
      focus: true,
      undo:
        result.status === 'updated' && result.updatedAt !== null
          ? {
              version: result.updatedAt,
              // Fortryd puts it back the way it was, which is the opposite of what this
              // write asked for.
              visible: !request.visible,
            }
          : null,
      status: result.status === 'unchanged' ? 'uaendret' : null,
    }),
  )
}

/** The refusal codes this screen knows how to word. */
function visibilityStatusCode(
  status: 'conflict' | 'not_found' | 'forbidden' | 'expired' | 'blank' | 'failed',
): string {
  switch (status) {
    // The one refusal a person can actually meet: the message expired inside the ten
    // seconds the Fortryd was on offer. It is said plainly rather than reported as a
    // success, because nothing came back to the hjemmeside.
    case 'expired':
      return 'fortryd_udloebet'
    case 'blank':
      return 'fortryd_tom'
    default:
      return status
  }
}
