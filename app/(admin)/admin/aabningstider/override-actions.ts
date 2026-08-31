'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { applyOverrideForm } from '@/lib/hours/override-admin'

import {
  OVERRIDE_FORM,
  overrideSaveHref,
  readOverrideForm,
  readOverrideVersionDate,
} from './override-forms'

/**
 * Gem — saving a one-off opening-hours change as a pending change. Design 1t (lower
 * card); technical plan §5, §6, §7e.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking   — requireStaff()
 *   2. read the card             — ./override-forms.ts, five names and no others
 *   3. do the work               — lib/hours/override-admin.ts
 *   4. report                    — a redirect back to the card, on the date it was about
 *
 * **`requireStaff()`, not `requireOwner()` — and that is the §5 matrix, not a relaxation.**
 * The matrix puts *"One-off opening-hour overrides ('Ret kun i dag')"* in **both** columns
 * and *"Normal weekly opening hours"* in the owner's alone, so the two cards on this one
 * screen are two different permission domains. This action is Staff; the recurring
 * schedule's two actions in `./save-actions.ts` and `./publish-actions.ts` still call
 * `requireOwner()` for themselves. Nothing in this file, or in anything it imports, names
 * `public.opening_hours`, the `opening_hours` entity or any of the twenty-one weekday field
 * names — so a staff member submitting this form gains no authority over the week at any of
 * the three layers that decide it (this guard, `mayChangeEntity`, and
 * `opening_hours_update_owner` in the database).
 *
 * **Nothing here writes to the public site, and nothing here expires a cache tag.** A
 * pending override is invisible — `overrides_select_public` hands a guest only published
 * rows — so the open/closed badge, Find os, the footer and §7b's sold-out reset all still
 * resolve against what is live. The two things on this card a guest can notice are
 * Offentliggør and the removal of a *published* override, and each expires the `hours` tag
 * itself, after its own transaction has committed.
 *
 * No validation, authorization, SQL or merge logic lives in this file: `toOverrideDraft`
 * decides what the card means, `applyOverrideForm` decides whether that is a creation or a
 * draft, `saveEntityDraft` re-parses strictly and applies the version token, and RLS
 * re-checks the role. None of it is reimplemented for this screen.
 */
export async function saveOverride(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  const form = readOverrideForm(formData)

  const outcome = await applyOverrideForm(profile, {
    form,
    version: formData.get(OVERRIDE_FORM.version),
    versionDate: readOverrideVersionDate(formData),
  })

  redirect(overrideSaveHref(form, outcome))
}
