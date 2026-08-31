'use server'

import { redirect } from 'next/navigation'

import { applyGeneratedAnnouncement } from '@/lib/announcements/generated-operation'
import { requireStaff } from '@/lib/auth/guards'
import type { Profile } from '@/lib/auth/session'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readAdminAnnouncement } from '@/lib/content/announcement-admin'
import { readAdminOverrideOn } from '@/lib/content/hours-overrides-admin'
import { applyOverrideForm } from '@/lib/hours/override-admin'
import { overrideIsPending } from '@/lib/hours/override-form'
import { isIsoDate, type IsoDate } from '@/lib/time/calendar'
import { readPendingChanges } from '@/lib/publishing/pending'
import { publishPendingChange } from '@/lib/publishing/publish'

import { generatedAnnouncementHref } from './announcement-routes'
import {
  OVERRIDE_FORM,
  overrideSaveHref,
  readAnnouncementRequest,
  readOverrideForm,
  readOverrideVersionDate,
  type AnnouncementRequest,
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
 * `opening_hours` is named nowhere in this file: publishing a one-off change cannot move the
 * recurring week.
 *
 * ================= THE ORDERING RULE, AS THE SHAPE OF THIS FILE =================
 *
 * §7e item 8, and it is the reason `publishOverrideOn` reads the way it does:
 *
 *     "the hours override is written first and always; the announcement is only attempted
 *      afterwards ... There is no code path where a 'Behold eksisterende' choice can roll
 *      back the hours."
 *
 * That is kept **structurally**, not by care:
 *
 *   1. the override is published, by exactly the machinery phase 8B used;
 *   2. its cache tag is expired, so the first guest request already sees the new hours;
 *   3. **only then** is the optional announcement attempted, and it is attempted through
 *      `applyGeneratedAnnouncement()`, which issues no statement against
 *      `public.opening_hours` or `public.opening_hours_overrides` in any branch.
 *
 * Steps 1 and 2 are complete — committed, and the public cache already told — before step
 * 3 begins. There is nothing left holding a transaction open that a refusal could roll
 * back, and no branch below returns to step 1. A conflict, a "Behold eksisterende", a
 * refused message and an outright failure are all reported by adding a **second** code to
 * the address beside the hours' own, which is why `./announcement-routes.ts` takes the two
 * separately.
 *
 * WHAT THE BROWSER MAY SAY ABOUT THE ANNOUNCEMENT, AND WHAT IT MAY NOT
 *
 * Three fields (`./override-forms.ts`): whether the person asked for it, the wording they
 * approved, and the announcement version they were looking at. The expiry, the link, the
 * source and the owning override are **re-derived on the server** from the row that was
 * just published and the recurring week that was just read — never from the submission,
 * and never echoed from the first attempt on the confirmed second one.
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

  // Read before anything is written, and used only after everything is. A submission the
  // save refuses never reaches the announcement at all.
  const announcement = readAnnouncementRequest(formData)

  const outcome = await applyOverrideForm(profile, {
    form,
    version: formData.get(OVERRIDE_FORM.version),
    versionDate: readOverrideVersionDate(formData),
  })

  if (outcome.kind !== 'saved') redirect(overrideSaveHref(form, outcome))

  await publishOverrideOn(profile, outcome.date, announcement)
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
  const profile = await requireStaff()

  const date = formData.get(OVERRIDE_FORM.date)
  if (typeof date !== 'string' || !isIsoDate(date)) {
    redirect(openingHoursHref({ overrideFocus: true, status: 'enkelt_ugyldig' }))
  }

  // `null`, always. The band is 1aa's pending strip and carries one field — the date. 1t
  // draws the announcement option inside the **card**, so a publish from the band is a
  // publish of the hours and nothing else, and no announcement is ever created by a control
  // that did not offer one.
  await publishOverrideOn(profile, date, null)
}

/**
 * Publish whatever is pending on one date, and report.
 *
 * Three independent reads of "what am I publishing", none of them the form's: this
 * function resolves the date to a row, `pending_changes` confirms that row is pending and
 * hands back its current version, and `publishPendingChange` resolves it once more before
 * calling the database.
 */
async function publishOverrideOn(
  profile: Profile,
  date: string,
  announcement: AnnouncementRequest | null,
): Promise<void> {
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

  // Only now, and only for what actually went live. **Step 2 of the ordering rule**: the
  // hours are committed and the public cache has been told before a single line below runs.
  expirePublicCacheTags(result.cacheTags)

  const hoursStatus =
    result.status === 'published' ? 'enkelt_offentliggjort' : `enkelt_${result.status}`

  // A publish that did not happen has nothing to announce — there is no new opening time on
  // the hjemmeside for a message to describe. The hours' own refusal stands alone.
  if (result.status !== 'published' || announcement === null) {
    redirect(openingHoursHref({ date, overrideFocus: true, status: hoursStatus }))
  }

  await announceOverride({ profile, date: override.date, hoursStatus, announcement })
}

/**
 * **Step 3**: the optional message, attempted after the hours are already public.
 *
 * Everything authoritative is read here rather than accepted: the override is re-read for
 * the version token the publish just moved, and the announcement singleton for its own. The
 * coordinator then re-reads *both* again inside its own transaction, re-asks the generator
 * and composes the expiry, the link, the source and the owner from the published rows — so
 * the only thing that travels from the browser to the database is the wording.
 *
 * Nothing here can fail in a way that touches the hours. It issues no statement against
 * them, and every exit is a redirect carrying `hoursStatus` through unchanged.
 */
async function announceOverride({
  profile,
  date,
  hoursStatus,
  announcement,
}: {
  readonly profile: Profile
  readonly date: IsoDate
  readonly hoursStatus: string
  readonly announcement: AnnouncementRequest
}): Promise<void> {
  // The token the publish just moved. Read again rather than remembered: the row this
  // announcement will belong to is the row as it is *now*, and if anything has moved it
  // since, the coordinator's own `stale_override` says so instead of publishing a sentence
  // about hours nobody has.
  const published = await readAdminOverrideOn(date)
  const current = published === null ? null : await readAdminAnnouncement()

  if (published === null || current === null) {
    redirect(
      openingHoursHref({
        date,
        overrideFocus: true,
        status: hoursStatus,
        announcement: 'not_found',
      }),
    )
  }

  const result = await applyGeneratedAnnouncement(profile, {
    overrideId: published.id,
    overrideExpectedUpdatedAt: published.updatedAt,
    // The version the *card* was rendered from, so somebody else's edit between the render
    // and this press is `stale_announcement` rather than a silent overwrite (§6).
    expectedUpdatedAt: announcement.version,
    message: announcement.message,
  })

  // A conflict writes nothing at all, so there is nothing to expire for it: `cacheTags` is
  // empty for every status but `applied`, which is what makes one line correct for all of
  // them rather than a branch that has to be kept in step.
  expirePublicCacheTags(result.cacheTags)

  redirect(
    generatedAnnouncementHref({
      date,
      hoursStatus,
      overrideId: published.id,
      message: announcement.message,
      result,
    }),
  )
}
