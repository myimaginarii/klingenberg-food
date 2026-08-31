'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readAdminOverrideOn } from '@/lib/content/hours-overrides-admin'
import { applyOverrideForm } from '@/lib/hours/override-admin'
import { overrideIsPending } from '@/lib/hours/override-form'
import { isIsoDate } from '@/lib/time/calendar'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChange } from '@/lib/publishing/publish'

import {
  OVERRIDE_FORM,
  overrideSaveHref,
  readOverrideForm,
  readOverrideVersionDate,
} from './override-forms'
import { openingHoursHref } from './routes'

/**
 * Publishing a one-off opening-hours change — design 1t (lower card); §5, §6, §7e.
 *
 * Two entrances, one publish. 1t draws **"Gem og offentliggør"** in the card's own footer,
 * and 1aa's pending band — the one every section screen in this administration has — draws
 * **"Offentliggør"** beside the sentence that says what is waiting. They reach the same
 * `publishOverrideOn` below, so there is no second publishing path to keep in step.
 *
 * WHAT IS PUBLISHED, AND WHAT CANNOT BE
 *
 * One entity, one row, one date, and **nothing the browser named**. The submission carries
 * a date and, for the editor's own button, the card's fields; the server then re-reads that
 * date's row through the caller's own JWT, looks the pending change up in `pending_changes` — the
 * `security_invoker` view, so RLS decides which rows exist at all — and publishes it with
 * the version *it* just read. `publishPendingChange` then re-authorizes the entity **it**
 * resolved, re-validates the **stored** draft against `openingHoursOverrideDraft`, and
 * hands the merge to `publish_opening_hours_override()`, which checks the version a third
 * time inside its own UPDATE. A forged POST can therefore ask for this staff member's own
 * pending override on a date they may edit, and for nothing else.
 *
 * `opening_hours` is named nowhere in this file. Neither is `public.announcement`: the
 * generated opening-hours message, `source='opening_hours'`, "Vis også som besked øverst på
 * hjemmesiden" and 1ae's conflict sheet are **phase 8C**, and no branch here writes,
 * replaces or hides one.
 *
 * THE CACHE, AFTER THE FACT
 *
 * The `hours` tag — the one the registry names for this entity — is expired **only** for a
 * result that says `published`, and only after the transaction has committed. It is the tag
 * on every public page, because a published override moves the open/closed badge and §7b's
 * sold-out reset, so the first guest request after a publish renders against the new answer
 * (§6, and `tests/e2e/public-cache.spec.ts` for why "first" is the word that matters).
 */

/**
 * 1t's own primary control: save the card, then publish what it left pending.
 *
 * The two halves are the same two functions the separate buttons use — `applyOverrideForm`
 * and `publishOverrideOn` — rather than a third implementation of either, and the order is
 * server-authoritative: a refused save ends here with the card re-opened and the reason on
 * screen, and nothing is published. There is no branch that publishes something the save
 * did not write.
 */
export async function saveAndPublishOverride(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  const form = readOverrideForm(formData)

  const outcome = await applyOverrideForm(profile, {
    form,
    version: formData.get(OVERRIDE_FORM.version),
    versionDate: readOverrideVersionDate(formData),
  })

  if (outcome.kind !== 'saved') redirect(overrideSaveHref(form, outcome))

  await publishOverrideOn(outcome.date)
}

/**
 * "Offentliggør" in the pending band.
 *
 * The band is drawn only while something is waiting, and it carries **one** field: the
 * date it is describing. Not an id, not a version, not an entity name — the server resolves
 * all three from the date, through the caller's own JWT, so the only thing a forged
 * submission can choose is which of this staff member's own dates is published.
 */
export async function publishPendingOverride(formData: FormData): Promise<void> {
  await requireStaff()

  const date = formData.get(OVERRIDE_FORM.date)
  if (typeof date !== 'string' || !isIsoDate(date)) {
    redirect(openingHoursHref({ overrideFocus: true, status: 'enkelt_ugyldig' }))
  }

  await publishOverrideOn(date)
}

/**
 * Publish whatever is pending on one date, and report.
 *
 * Three independent reads of "what am I publishing", none of them the form's: this
 * function resolves the date to a row, `pending_changes` confirms that row is pending and
 * hands back its current version, and `publishPendingChange` resolves it once more before
 * calling the database.
 */
async function publishOverrideOn(date: string): Promise<void> {
  const profile = await requireStaff()
  const override = await readAdminOverrideOn(date)

  if (override === null || !overrideIsPending(override.lifecycle)) {
    redirect(openingHoursHref({ date, overrideFocus: true, status: 'enkelt_intet_valgt' }))
  }

  const pending = (await readPendingChanges()).find(
    (change) => change.entity === 'opening_hours_override' && change.entityId === override.id,
  )

  if (pending === undefined) {
    redirect(openingHoursHref({ date, overrideFocus: true, status: 'enkelt_intet_valgt' }))
  }

  const result = await publishPendingChange(profile, {
    entity: 'opening_hours_override',
    entityId: pending.entityId,
    expectedUpdatedAt: pending.updatedAt,
  })

  // Only now, and only for what actually went live.
  expirePublicCacheTags(result.cacheTags)

  redirect(
    openingHoursHref({
      date,
      overrideFocus: true,
      status: result.status === 'published' ? 'enkelt_offentliggjort' : `enkelt_${result.status}`,
    }),
  )
}
