'use server'

import { redirect } from 'next/navigation'

import { announcementExpirySuggestions } from '@/lib/announcements/expiry-editor'
import { announcementDraftWrite } from '@/lib/announcements/lifecycle'
import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { readAdminAnnouncement } from '@/lib/content/announcement-admin'
import { readOpeningHours } from '@/lib/content/hours'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import {
  ANNOUNCEMENT_FORM,
  encodeAnnouncementEcho,
  readAnnouncementForm,
  toAnnouncementSubmission,
} from './forms'
import { announcementHref } from './routes'

/**
 * Gem — saving the announcement as a draft. Design 1ad, technical plan §6.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking        — requireStaff()
 *   2. parse the target               — draftTargetSchema (entity + version token)
 *   3. read the server's own row      — lib/content/announcement-admin.ts
 *   4. read the published hours       — for 1ad's suggestion chips
 *   5. map the form to values         — ./forms.ts
 *   6. reduce it to what changed      — lib/announcements/lifecycle.ts (§4)
 *   7. write the draft                — lib/publishing/drafts.ts
 *   8. report                         — a redirect back to the card
 *
 * **Nothing here writes to the public site**, and nothing here expires a cache tag. A
 * draft is a draft: the live columns are untouched, so a guest still reads the published
 * message, at the published expiry, behind the published link, and the bar's visibility
 * is exactly what it was. 1ad says it in the card beside the buttons — *"Ret →
 * Forhåndsvis → Offentliggør. Det, gæsten læser, skal nogen have set først."* The only
 * thing on this screen that changes the hjemmeside is `./publish-actions.ts`.
 *
 * No validation, authorization, SQL or merge logic lives in this file. `saveEntityDraft`
 * re-parses the values against `announcementDraft` — strictly, so an unknown key is a
 * refusal — re-checks the role matrix, applies the version token as optimistic
 * concurrency, and merges the new values into any existing draft. None of that is
 * reimplemented here, which is the whole reason phase 4 built it.
 *
 * WHY THE SUGGESTION CHIPS ARE RESOLVED HERE AND NOT IN THE BROWSER
 *
 * 1ad's chips name instants — "Når vi lukker søndag kl. 20:00" — and an instant computed
 * from the opening hours is a *server* value: it depends on the published schedule, on
 * any published override, and on the server's own clock. A browser that computed one
 * could be wrong about all three, and a browser that *submitted* one would be submitting
 * an expiry rather than choosing a suggestion. So the form submits which chip was
 * chosen, this action recomputes what that chip means, and the result goes through the
 * same "must be in the future" rule as a date somebody typed.
 *
 * `merge` PLUS AN EXPLICIT `clear`, NEVER `replace`
 *
 * This editor owns every field `announcementDraft` carries, so `replace` would happen to
 * work today — and that is exactly the reasoning phase 5E had to undo once already
 * (`lib/publishing/drafts.ts` records it). The save merges the fields it owns and clears
 * only those of them that no longer differ from the published values; anything else a
 * stored draft holds is not mentioned in either direction and survives untouched.
 */
export async function saveAnnouncementDraft(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', announcementHref({ status: RATE_LIMIT_STATUS }))

  const target = draftTargetSchema.safeParse({
    entity: 'announcement',
    expectedUpdatedAt: formData.get(ANNOUNCEMENT_FORM.version),
  })
  if (!target.success) redirect(announcementHref({ status: 'ugyldig', focus: true }))

  const [announcement, hours] = await Promise.all([
    readAdminAnnouncement(),
    readOpeningHours(),
  ])
  if (announcement === null) redirect(announcementHref({ status: 'not_found' }))

  // One clock for the whole decision: the chips are computed against it and the
  // "in the future" rule is applied against it, so the two cannot disagree by the
  // milliseconds between two readings.
  const now = new Date()
  const suggestions = announcementExpirySuggestions(now, hours.schedule, hours.overrides)

  const form = readAnnouncementForm(formData)
  const submission = toAnnouncementSubmission(form, suggestions, now)

  if (!submission.ok) {
    redirect(
      announcementHref(
        { status: 'ugyldig', focus: true },
        encodeAnnouncementEcho(form, submission.errors),
      ),
    )
  }

  // The delta is measured against the **published** values, not against what the form
  // was rendered with, so a field edited back to what the hjemmeside already says stops
  // being a pending change (§4).
  const write = announcementDraftWrite(submission.values, announcement.live)

  const result = await saveEntityDraft(profile, {
    entity: 'announcement',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    announcementHref({
      focus: true,
      status: result.status === 'saved' ? 'gemt' : result.status,
    }),
  )
}
