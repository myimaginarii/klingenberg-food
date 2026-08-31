'use server'

import { redirect } from 'next/navigation'

import { applyGeneratedAnnouncement } from '@/lib/announcements/generated-operation'
import { restoreAnnouncement } from '@/lib/announcements/replacement'
import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readAdminOverrides } from '@/lib/content/hours-overrides-admin'

import { generatedAnnouncementHref, restoredAnnouncementHref } from './announcement-routes'
import { OVERRIDE_CONFLICT_FORM, OVERRIDE_UNDO_FORM } from './override-forms'
import { openingHoursHref } from './routes'

/**
 * The two presses that follow 1ae — design 1ae, 1aa; technical plan §6, §7e item 8.
 * **Phase 8C-3B.**
 *
 * The sheet offers three ways out and only two of them are here, which is the point:
 *
 *   * **"Behold eksisterende besked"** is a `<a href>` and appears in no action file at
 *     all. §12 of the brief: the published hours stay published, the current announcement
 *     stays byte-identical, the proposed one is dropped, no ownership moves, no snapshot
 *     is taken and no audit row is written. A branch that "did nothing" would still be a
 *     branch that could one day do something; a link cannot become one. The screen simply
 *     comes back without `konflikt` and says so.
 *   * **"Erstat med den nye besked"** is {@link replaceGeneratedAnnouncement} below — the
 *     same coordinator the first attempt called, with the one bit a person may contribute
 *     to the decision set to true.
 *   * **Fortryd**, in the green strip afterwards, is {@link undoGeneratedAnnouncement}.
 *
 * ================= THE HOURS ARE ALREADY PUBLIC BEFORE EITHER RUNS =================
 *
 * By the time the sheet is on screen the override has been published and the `hours` tag
 * has been expired (`./override-publish-actions.ts`). Neither action below names
 * `public.opening_hours` or `public.opening_hours_overrides` in a write, and neither can
 * reach one: `applyGeneratedAnnouncement()` and `restoreAnnouncement()` issue no statement
 * against either table in any branch. So "Behold eksisterende" cannot roll the hours back,
 * and neither can a stale token, a failed replacement or a refused restore.
 *
 * ================= WHAT THE SHEET IS ALLOWED TO CARRY =================
 *
 * A row id, two version tokens, the wording, and one confirmation bit. The tokens are the
 * ones the **sheet was rendered with**, deliberately: §13 of the brief asks that a change
 * made while the sheet stood open be refused rather than overwritten, and comparing what
 * the person was looking at against what the database now holds is how that refusal
 * happens. Everything authoritative — the expiry, the link, the source, the owning
 * override — is re-derived inside the coordinator from the published rows, on this call as
 * much as on the first one.
 */

/**
 * 1ae's "Erstat med den nye besked".
 *
 * `confirmReplace: true` is the whole difference from the first attempt. The coordinator
 * re-reads the override, the recurring week and the announcement singleton, re-asks the
 * generator, re-validates the wording and decides the conflict again from the row it just
 * read — so a sheet that sat open while somebody else published a different message ends
 * at `stale_announcement`, and one that sat open while somebody re-published the hours
 * ends at `stale_override`. Neither writes anything.
 */
export async function replaceGeneratedAnnouncement(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const overrideId = formData.get(OVERRIDE_CONFLICT_FORM.override)
  const overrideVersion = formData.get(OVERRIDE_CONFLICT_FORM.overrideVersion)
  const version = formData.get(OVERRIDE_CONFLICT_FORM.version)
  const message = formData.get(OVERRIDE_CONFLICT_FORM.message)

  if (
    typeof overrideId !== 'string' ||
    typeof overrideVersion !== 'string' ||
    typeof version !== 'string' ||
    typeof message !== 'string'
  ) {
    redirect(openingHoursHref({ overrideFocus: true, announcement: 'invalid_payload' }))
  }

  // The server's own view of which date this is, so the redirect lands on the card the
  // person was working in. A row RLS will not show them is not found, and one dated in the
  // past is not listed at all — so neither can be announced from here.
  const override = (await readAdminOverrides()).find((candidate) => candidate.id === overrideId)

  if (override === undefined) {
    redirect(openingHoursHref({ overrideFocus: true, announcement: 'not_found' }))
  }

  const result = await applyGeneratedAnnouncement(profile, {
    overrideId,
    overrideExpectedUpdatedAt: overrideVersion,
    expectedUpdatedAt: version,
    message,
    confirmReplace: true,
  })

  // Committed, and only then. `cacheTags` is empty for every status but `applied`.
  expirePublicCacheTags(result.cacheTags)

  redirect(
    generatedAnnouncementHref({
      date: override.date,
      // The hours were published by the press that opened the sheet, and this action did
      // not touch them. Saying so again here would be a second claim about a fact that has
      // not moved, so the address carries the announcement's outcome alone.
      hoursStatus: '',
      overrideId,
      message,
      result,
      // The sheet took focus, so the sheet gives it back: this address ends at the publish
      // button's own fragment, which is the control 1ae was opened from (§11).
      focus: 'publish',
    }),
  )
}

/**
 * Fortryd — design 1ae (*"Grøn besked med Fortryd i 10 sekunder sætter den gamle tilbage"*),
 * 1aa; technical plan §6.
 *
 * 8C-1's `restoreAnnouncement()` unchanged, and that is the whole of it. The browser sends
 * **one field**: the announcement version token the replacement returned. What comes back
 * is read from `previous` inside the database — its message, its link, its expiry, its
 * visibility and the override that owned it — so a manual announcement returns manual, a
 * generated one returns to the override that owned it, and an expired one returns with its
 * own expiry rather than a fresh one.
 *
 * It cannot resurrect the wrong thing. The token binds it to the write the strip was drawn
 * for: a second replacement in another tab moves `updated_at`, and this restore is then
 * `conflict` rather than an undo of somebody else's change.
 */
export async function undoGeneratedAnnouncement(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const version = formData.get(OVERRIDE_UNDO_FORM.version)

  if (typeof version !== 'string') {
    redirect(openingHoursHref({ overrideFocus: true, announcement: 'fortryd_conflict' }))
  }

  const result = await restoreAnnouncement(profile, { expectedUpdatedAt: version })

  expirePublicCacheTags(result.cacheTags)

  redirect(restoredAnnouncementHref({ date: null, result }))
}
