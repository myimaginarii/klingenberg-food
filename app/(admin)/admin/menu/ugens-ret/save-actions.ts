'use server'

import { redirect } from 'next/navigation'

import { readAdminWeeklySpecial } from '@/lib/content/weekly-admin'
import {
  planWeekEdit,
  weeklyDraftWrite,
  SATURDAY_EDITOR_FIELDS,
} from '@/lib/menu/weekly'
import { requireStaff } from '@/lib/auth/guards'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import {
  encodeSaturdayEcho,
  encodeWeekEcho,
  readSaturdayForm,
  readWeekForm,
  SATURDAY_FORM,
  toSaturdaySubmission,
  toWeekSubmission,
  WEEK_FORM,
} from './forms'
import { weeklyHref } from './routes'

/**
 * Gem — saving Ugens ret and Lørdagsmenuen as drafts. Design 1ag, technical plan §6.
 *
 * Two actions, because 1ag draws two cards with two save buttons, and because they own
 * two disjoint sets of fields. Both are thin, and both follow the same fixed order:
 *
 *   1. establish who is asking        — requireStaff()
 *   2. parse the target               — draftTargetSchema (entity + version token)
 *   3. read the server's own row      — lib/content/weekly-admin.ts
 *   4. map the form to values         — ./forms.ts
 *   5. reduce it to what changed      — lib/menu/weekly.ts (§4)
 *   6. write the draft                — lib/publishing/drafts.ts
 *   7. report                         — a redirect back to the card
 *
 * **Nothing here writes to the public site**, and nothing here expires a cache tag. A
 * draft is a draft: the live columns are untouched, so the public menu is byte-identical
 * to what it was before this ran. The only thing on this screen that expires a public
 * tag is a successful publish (`./publish-actions.ts`) or an immediate Udsolgt
 * (`./availability-actions.ts`).
 *
 * No validation, authorization, SQL or merge logic lives in this file. `saveEntityDraft`
 * re-parses the values against `weeklySpecialDraft` — strictly, so an unknown key is a
 * refusal — re-checks the role matrix, applies the version token as optimistic
 * concurrency, and merges the new values into any existing draft. None of that is
 * reimplemented for the weekly special, which is the whole reason phase 4 built it.
 *
 * `merge` PLUS AN EXPLICIT `clear`, NEVER `replace`
 *
 * The two cards share one row and one `draft` column. `mode: 'replace'` says "these
 * values *are* the draft", which from either card would silently delete the other card's
 * pending work — a Saturday save would drop a pending price on Ugens ret, and the
 * reverse. So each save merges the fields **it owns** and clears the ones of *those*
 * that no longer differ from the published values. Everything else in the draft, and
 * `image_id` in particular, is not mentioned in either direction and survives untouched.
 * This is the same deliberate partial-draft approach phase 5E and 5F arrived at.
 */

/** The version token both forms carry, parsed the way every other save parses one. */
function readVersion(formData: FormData, field: string) {
  return draftTargetSchema.safeParse({
    entity: 'weekly_special',
    expectedUpdatedAt: formData.get(field),
  })
}

/**
 * 1ag's first card: the week, the serving days, the dish and its two portion prices.
 *
 * The one rule here that is not an ordinary save is the **week rollover** (§7e item 5),
 * and it is not decided here either: `planWeekEdit` in `lib/menu/weekly.ts` compares the
 * submitted week against the week the row currently shows and answers with the values
 * to write. The comparison is made against the **server's** reading of the current week,
 * not against a hidden field, so nothing the browser sends decides whether a form is
 * blanked.
 */
export async function saveWeeklyDraft(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const target = readVersion(formData, WEEK_FORM.version)
  if (!target.success) redirect(weeklyHref({ status: 'ugyldig', focus: 'week' }))

  const weekly = await readAdminWeeklySpecial()
  if (weekly === null) redirect(weeklyHref({ status: 'not_found' }))

  const form = readWeekForm(formData)
  const submission = toWeekSubmission(form)

  if (!submission.ok) {
    redirect(
      weeklyHref(
        { status: 'ugyldig', focus: 'week' },
        encodeWeekEcho(form, submission.errors),
      ),
    )
  }

  const plan = planWeekEdit({
    submitted: submission.values,
    current: weekly.current,
    live: weekly.live,
  })

  const result = await saveEntityDraft(profile, {
    entity: 'weekly_special',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: plan.values,
    clear: plan.clear,
  })

  redirect(
    weeklyHref({
      focus: 'week',
      status:
        result.status !== 'saved'
          ? result.status
          : plan.blanked
            ? 'uge_skiftet'
            : plan.restored
              ? 'uge_gendannet'
              : 'gemt',
    }),
  )
}

/**
 * 1ag's second card: "Lørdagsmenu denne uge", its content and its on/off state.
 *
 * Turning the menu off is an **ordinary draft change**, exactly like editing its text.
 * The technical plan defines two immediate exceptions and only two (§6) — availability
 * and, elsewhere, hiding an announcement — and the Saturday toggle is neither of them.
 * So switching it off writes `sat_enabled: false` into the draft, the public card keeps
 * showing last week's menu until somebody presses Offentliggør, and 1af's
 * "Ingen lørdagsmenu denne uge" appears at that moment and not before.
 *
 * Nothing is deleted by turning it off. `sat_name`, `sat_description`, `sat_price_ore`
 * and `sat_deadline` are submitted and stored exactly as they stand, which is the
 * frame's own promise: *"Teksten bevares til næste gang."*
 */
export async function saveSaturdayDraft(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const target = readVersion(formData, SATURDAY_FORM.version)
  if (!target.success) redirect(weeklyHref({ status: 'ugyldig', focus: 'saturday' }))

  const weekly = await readAdminWeeklySpecial()
  if (weekly === null) redirect(weeklyHref({ status: 'not_found' }))

  const form = readSaturdayForm(formData)
  const submission = toSaturdaySubmission(form)

  if (!submission.ok) {
    redirect(
      weeklyHref(
        { status: 'ugyldig', focus: 'saturday' },
        encodeSaturdayEcho(form, submission.errors),
      ),
    )
  }

  // Only the five `sat_*` fields, in both directions. Ugens ret's pending price, its
  // week and its serving days are not named here and therefore cannot be touched.
  const write = weeklyDraftWrite(submission.values, weekly.live, SATURDAY_EDITOR_FIELDS)

  const result = await saveEntityDraft(profile, {
    entity: 'weekly_special',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    weeklyHref({
      focus: 'saturday',
      status: result.status === 'saved' ? 'loerdag_gemt' : result.status,
    }),
  )
}
