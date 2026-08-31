'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readAdminOverrides } from '@/lib/content/hours-overrides-admin'
import { removeOverride } from '@/lib/hours/override-admin'
import { describeOverrideRemoval, OVERRIDE_CONTENT_FIELDS } from '@/lib/hours/override-form'
import { saveEntityDraft } from '@/lib/publishing/drafts'

import { OVERRIDE_ROW_FORM } from './override-forms'
import { openingHoursHref } from './routes'

/**
 * "Fjern" — taking a one-off change away again. Design 1t (lower card); §5, §6, §7e item 6.
 *
 * One control, and **three** operations behind it, because "remove this" means three
 * different things depending on where the date is in its lifecycle. Which one runs is
 * decided from the row the **server** read, never from a field the browser sent, and the
 * screen says which one it is offering before it is pressed
 * (`describeOverrideRemoval` — one table, used by the button's label and by this action).
 *
 * | The date is… | "Fjern" does | A guest notices |
 * |---|---|---|
 * | pending, never live | deletes the row | nothing — it was never public |
 * | live, with a pending edit | drops the **draft** only | nothing — the live override stays |
 * | live | deletes the row; the date follows the weekly schedule again | **yes**, at once |
 *
 * The third is the only one that changes the hjemmeside, and it is the only one that asks
 * first — through the address (`?bekraeft=1`), like 1ah's expired-window publish, so the
 * confirmation needs no JavaScript to exist. It is also the only one that expires a cache
 * tag, and only after its transaction has committed.
 *
 * WHY THIS IS A DELETE AND NOT A SOFT DELETE
 *
 * §7e item 6 states a rule about *an override that is deleted*, and phase 1 gave staff a
 * DELETE policy on this table — the only content table besides `images` with one. A
 * soft-deleted dish is kept because the row *is* the recovery story (§8, §0a D2): it holds
 * a name, a description, a price, labels and a position nobody could retype. An override
 * holds a date and at most two times, and re-creating one is the same three presses that
 * created it. The reasoning is written out once more in the phase-8B migration, beside the
 * function.
 *
 * **No Fortryd strip, and that is a decision rather than an omission.** §6 names exactly
 * four immediate operations with a ten-second undo, and each of them undoes something a
 * person could not simply retype — a sold-out marking with its computed reset, a dish with
 * its whole content, an announcement with its message and expiry. This is the one press on
 * this screen that a person can reverse completely by filling in the same three fields
 * again, and the sentence beside the button says so in as many words before it is pressed.
 * What it does get is the confirmation §6's table does not give any of those four.
 *
 * Nothing here names `public.opening_hours` or `public.announcement`. Removing an override
 * cannot touch the recurring week, and §7e item 6's other half — *"default to removing the
 * announcement too when `source='opening_hours'`"* — belongs with the generated message
 * that creates the situation, which is **phase 8C**. There is no announcement to remove in
 * phase 8B, because phase 8B never creates one.
 */
export async function removeOverrideAction(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const id = formData.get(OVERRIDE_ROW_FORM.id)
  const version = formData.get(OVERRIDE_ROW_FORM.version)

  if (typeof id !== 'string' || typeof version !== 'string') {
    redirect(openingHoursHref({ overrideFocus: true, status: 'enkelt_ugyldig' }))
  }

  // The server's own view of what this id is. A row this caller may not see is not found,
  // and a row dated in the past is not listed at all — so neither can be removed from here.
  const override = (await readAdminOverrides()).find((candidate) => candidate.id === id)

  if (override === undefined) {
    redirect(openingHoursHref({ overrideFocus: true, status: 'enkelt_not_found' }))
  }

  const removal = describeOverrideRemoval(override.lifecycle)
  if (removal === null) {
    redirect(
      openingHoursHref({
        date: override.date,
        overrideFocus: true,
        status: 'enkelt_intet_valgt',
      }),
    )
  }

  /*
   * The press that a guest would notice asks first. The confirmation is a field on the
   * *second* submission — the address carries `bekraeft=1` and the form renders it — so
   * the first press writes nothing at all, exactly as 1ah's expired-window publish does.
   */
  if (removal.confirms && formData.get(OVERRIDE_ROW_FORM.confirm) !== '1') {
    redirect(
      openingHoursHref({
        date: override.date,
        overrideFocus: true,
        confirm: true,
      }),
    )
  }

  /*
   * A live override with an edit waiting behind it loses **only the edit**. That is a
   * draft write, not a removal: the same `saveEntityDraft` every other card uses, clearing
   * the three fields a draft on this table may hold, so the published override the
   * hjemmeside is showing is byte-identical afterwards.
   */
  if (override.lifecycle === 'live_med_kladde') {
    const result = await saveEntityDraft(profile, {
      entity: 'opening_hours_override',
      entityId: override.id,
      expectedUpdatedAt: override.updatedAt,
      mode: 'merge',
      values: {},
      clear: [...OVERRIDE_CONTENT_FIELDS],
    })

    redirect(
      openingHoursHref({
        date: override.date,
        overrideFocus: true,
        status: result.status === 'saved' ? 'enkelt_kladde_fjernet' : `enkelt_${result.status}`,
      }),
    )
  }

  const result = await removeOverride(profile, {
    overrideId: override.id,
    expectedUpdatedAt: version,
  })

  // Only after the transaction, and only when a guest's answer actually moved.
  expirePublicCacheTags(result.cacheTags)

  redirect(
    openingHoursHref({
      // Not the removed date: there is nothing there any more, and the card would offer to
      // create it again under a "removed" message. The card falls back to today.
      overrideFocus: true,
      status:
        result.status === 'removed'
          ? result.wasPublished
            ? 'enkelt_fjernet'
            : 'enkelt_kladde_fjernet'
          : `enkelt_${result.status}`,
    }),
  )
}
