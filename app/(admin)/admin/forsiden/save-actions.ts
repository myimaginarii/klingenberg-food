'use server'

import { redirect } from 'next/navigation'

import { requireOwner } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { readAdminHomePage } from '@/lib/content/home-admin'
import { homeSectionWrite } from '@/lib/pages/home'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import {
  encodeHomeSectionEcho,
  HOME_SECTION_FORM,
  readHomeSectionForm,
  readHomeSectionKey,
  toHomeSectionSubmission,
} from './forms'
import { homeHref, SECTION_ANCHOR } from './routes'

/**
 * Gem — saving one of the Forside's three text cards as a draft. Design 1u, technical
 * plan §4, §5, §6.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking        — requireOwner()
 *   2. parse the target               — draftTargetSchema (entity + version token)
 *   3. read the server's own row      — lib/content/home-admin.ts
 *   4. map the form to a section      — ./forms.ts (the two words, plus the slot's
 *                                       *current* image, so a pending photo survives)
 *   5. reduce it to what changed      — lib/pages/home.ts (§4, per section)
 *   6. write the draft                — lib/publishing/drafts.ts
 *   7. report                         — a redirect back to the card
 *
 * **`requireOwner()`, not `requireStaff()`.** §5's matrix puts *"Forsiden (hero, award,
 * featured dishes, about excerpt)"* in the Owner column and only there, and this is the
 * action a forged POST would aim at, so the guard is the first statement in it. It is
 * the first of three independent refusals: `saveEntityDraft` re-checks the same matrix
 * row through `mayChangeEntity`, and RLS re-checks it a third time in the database,
 * where `pages_update_scoped` admits the `home` row to `public.is_owner()` alone. A
 * staff session is refused by all three, and no SECURITY DEFINER function is involved
 * at any point.
 *
 * **Nothing here writes to the public site**, and nothing here expires a cache tag. A
 * draft is a draft: `published` is untouched, so the Forside is byte-identical until
 * somebody presses Offentliggør (`./publish-actions.ts`).
 *
 * THE SECTION IS WRITTEN WHOLE, AND ONLY THIS SECTION
 *
 * A page draft holds whole top-level sections (`lib/schemas/page-documents.ts`), so the
 * form's two words become the section object together with the slot's current image
 * — read from the merged document, never from the form, which has no field for it.
 * The save then names exactly one section: `merge` with a `clear` for that section
 * when it no longer differs from the published one, and nothing about the other three,
 * so a Gem on "Øverst på siden" can neither wipe nor publish a pending change on
 * "Udmærkelsen". No validation, authorization, SQL or merge logic lives in this file.
 */
export async function saveHomeSectionDraft(formData: FormData): Promise<void> {
  const profile = await requireOwner()
  await enforceRateLimit('content:save', homeHref({ status: RATE_LIMIT_STATUS }))

  const target = draftTargetSchema.safeParse({
    entity: 'page:home',
    expectedUpdatedAt: formData.get(HOME_SECTION_FORM.version),
  })
  if (!target.success) redirect(homeHref({ status: 'ugyldig' }))

  const form = readHomeSectionForm(formData)
  const section = readHomeSectionKey(form.section)
  if (section === null) redirect(homeHref({ status: 'ugyldig' }))

  const home = await readAdminHomePage()
  if (home === null) redirect(homeHref({ status: 'not_found' }))

  const anchor = SECTION_ANCHOR[section]
  const submission = toHomeSectionSubmission(section, form, home.current[section].image_id)

  if (!submission.ok) {
    redirect(
      homeHref({ status: 'ugyldig', focus: anchor }, encodeHomeSectionEcho(form, submission.errors)),
    )
  }

  // The delta is measured against the **published** section, not against what the
  // form was rendered with, so a card edited back to what the hjemmeside already says
  // stops being a pending change (§4).
  const write = homeSectionWrite(section, submission.values, home.live[section])

  const result = await saveEntityDraft(profile, {
    entity: 'page:home',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    homeHref({
      focus: anchor,
      status:
        result.status === 'saved'
          ? write.clear.length > 0
            ? 'uaendret'
            : 'gemt'
          : result.status,
    }),
  )
}
