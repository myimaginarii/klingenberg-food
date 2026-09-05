'use server'

import { redirect } from 'next/navigation'

import { requireOwner } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { readAdminOpeningHours } from '@/lib/content/hours-admin'
import { toWeeklySchedule, weeklyHoursDraftWrite } from '@/lib/hours/weekly-form'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import { encodeOpeningHoursEcho, OPENING_HOURS_FORM, readOpeningHoursForm } from './forms'
import { openingHoursHref } from './routes'

/**
 * Gem — saving the normal weekly opening hours as a draft. Design 1t, technical plan §5, §6.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking        — requireOwner()
 *   2. parse the target               — draftTargetSchema (entity + version token)
 *   3. read the server's own row      — lib/content/hours-admin.ts
 *   4. map the form to a schedule     — lib/hours/weekly-form.ts
 *   5. reduce it to what changed      — the same module (§4)
 *   6. write the draft                — lib/publishing/drafts.ts
 *   7. report                         — a redirect back to the card
 *
 * **`requireOwner()`, not `requireStaff()`.** §5's matrix puts *"Normal weekly opening
 * hours"* in the Owner column and only there, and this is the action a forged POST would
 * aim at, so the guard is the first statement in it. It is the first of three independent
 * refusals: `saveEntityDraft` re-checks the same matrix row through `mayChangeEntity`, and
 * RLS re-checks it a third time in the database, where `opening_hours_update_owner` is the
 * only UPDATE policy on the table and `public.is_owner()` is its condition. A staff
 * session is refused by all three, and no SECURITY DEFINER function is involved at any
 * point — the write goes through the caller's own JWT exactly as every other draft write
 * in this administration does.
 *
 * **Nothing here writes to the public site**, and nothing here expires a cache tag. A
 * draft is a draft: `schedule` is untouched, so the footer, the open/closed badge, Find os
 * and the §7b sold-out reset all still resolve against the published week. The only thing
 * on this screen that expires the `hours` tag is a successful publish
 * (`./publish-actions.ts`).
 *
 * No validation, authorization, SQL or merge logic lives in this file. `toWeeklySchedule`
 * produces the document and the day-specific refusals; `saveEntityDraft` re-parses the
 * values against `openingHoursDraft` — strictly, so an unknown key is a refusal — applies
 * the version token as optimistic concurrency, and merges. None of that is reimplemented
 * for the opening hours, which is the whole reason phase 4 built it.
 *
 * `merge` PLUS AN EXPLICIT `clear`, NEVER `replace`
 *
 * `opening_hours` has exactly one editable field, so `replace` would happen to work today
 * — and that is precisely the reasoning phase 5E had to undo once already. The save
 * therefore names the one field it owns and clears it when the week has been edited back
 * to what is already published, which is how §4's "a draft holds only the changed fields"
 * stays literally true and how a reverted edit stops being a pending change.
 */
export async function saveOpeningHoursDraft(formData: FormData): Promise<void> {
  const profile = await requireOwner()
  await enforceRateLimit('content:save', openingHoursHref({ status: RATE_LIMIT_STATUS }))

  const target = draftTargetSchema.safeParse({
    entity: 'opening_hours',
    expectedUpdatedAt: formData.get(OPENING_HOURS_FORM.version),
  })
  if (!target.success) redirect(openingHoursHref({ status: 'ugyldig', focus: true }))

  const hours = await readAdminOpeningHours()
  if (hours === null) redirect(openingHoursHref({ status: 'not_found' }))

  const form = readOpeningHoursForm(formData)
  const parsed = toWeeklySchedule(form)

  if (!parsed.ok) {
    redirect(
      openingHoursHref(
        { status: 'ugyldig', focus: true },
        encodeOpeningHoursEcho(form, parsed.errors),
      ),
    )
  }

  // The delta is measured against the **published** schedule, not against what the form
  // was rendered with, so a week edited back to what the hjemmeside already says stops
  // being a pending change (§4).
  const write = weeklyHoursDraftWrite(parsed.schedule, hours.live)

  const result = await saveEntityDraft(profile, {
    entity: 'opening_hours',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    openingHoursHref({
      focus: true,
      status:
        result.status === 'saved'
          ? write.clear.length > 0
            ? 'uaendret'
            : 'gemt'
          : result.status,
    }),
  )
}
