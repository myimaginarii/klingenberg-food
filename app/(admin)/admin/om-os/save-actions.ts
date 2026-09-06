'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { readAdminAboutPage } from '@/lib/content/about-admin'
import {
  aboutSectionWrite,
  aboutStoryWrite,
  toAboutMethod,
  toAboutStory,
  toAboutTeam,
} from '@/lib/pages/about'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

import {
  ABOUT_METHOD_FORM,
  ABOUT_STORY_FORM,
  ABOUT_TEAM_FORM,
  encodeAboutMethodEcho,
  encodeAboutStoryEcho,
  encodeAboutTeamEcho,
  readAboutMethodForm,
  readAboutStoryForm,
  readAboutTeamForm,
} from './forms'
import { aboutHref, CARD_ANCHOR } from './routes'

/**
 * Gem on the three Om os cards — design 1i, technical plan §4, §5, §6; phase 14B1.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking        — requireStaff() (§5: Staff and Owner alike)
 *   2. parse the target               — draftTargetSchema (entity + version token)
 *   3. read the server's own row      — lib/content/about-admin.ts
 *   4. map the form to values         — lib/pages/about.ts
 *   5. reduce it to what changed      — lib/pages/about.ts (§4)
 *   6. write the draft                — lib/publishing/drafts.ts
 *   7. report                         — a redirect back to the card
 *
 * `requireStaff()` is the first of three independent refusals: `saveEntityDraft`
 * re-checks the same matrix row through `mayChangeEntity`, and RLS re-checks it a third
 * time in the database (`pages_update_scoped` admits the `about` row to
 * `public.is_staff()`). No SECURITY DEFINER function is involved at any point.
 *
 * **Nothing here writes to the public site**, and nothing here expires a cache tag. A
 * draft is a draft: `published` is untouched, so the page is byte-identical until
 * somebody presses Offentliggør (`./publish-actions.ts`).
 *
 * EACH CARD NAMES ITS OWN KEYS, AND ONLY THOSE. The story card's two keys are top-level,
 * so its save is `merge` with a `clear` for whichever of them no longer differs from the
 * published document — and it says nothing about the facade photograph, the team or the
 * method. The team and method cards write their section **whole**, the slot's current
 * image included (read from the merged document, never from the form, which has no
 * field for it), so a Gem of the words can neither wipe nor publish a pending picture.
 */

type CardTarget = { readonly expectedUpdatedAt: string }

async function targetOf(formData: FormData, versionField: string): Promise<CardTarget> {
  const target = draftTargetSchema.safeParse({
    entity: 'page:about',
    expectedUpdatedAt: formData.get(versionField),
  })
  if (!target.success) redirect(aboutHref({ status: 'ugyldig' }))
  return { expectedUpdatedAt: target.data.expectedUpdatedAt }
}

function reportSave(
  anchor: string,
  status: string,
  wroteSomething: boolean,
): never {
  redirect(
    aboutHref({
      focus: anchor,
      status: status === 'saved' ? (wroteSomething ? 'gemt' : 'uaendret') : status,
    }),
  )
}

export async function saveAboutStory(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', aboutHref({ status: RATE_LIMIT_STATUS }))

  const target = await targetOf(formData, ABOUT_STORY_FORM.version)

  const page = await readAdminAboutPage()
  if (page === null) redirect(aboutHref({ status: 'not_found' }))

  const form = readAboutStoryForm(formData)
  const submission = toAboutStory(form)

  if (!submission.ok) {
    redirect(
      aboutHref({ status: 'ugyldig', focus: CARD_ANCHOR.story }, encodeAboutStoryEcho(form, submission.issues)),
    )
  }

  // The delta is measured against the **published** values, not against what the
  // form was rendered with, so a field edited back to what the hjemmeside already
  // says stops being a pending change (§4).
  const write = aboutStoryWrite(submission.values, page.live)

  const result = await saveEntityDraft(profile, {
    entity: 'page:about',
    expectedUpdatedAt: target.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  reportSave(CARD_ANCHOR.story, result.status, Object.keys(write.values).length > 0)
}

export async function saveAboutTeam(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', aboutHref({ status: RATE_LIMIT_STATUS }))

  const target = await targetOf(formData, ABOUT_TEAM_FORM.version)

  const page = await readAdminAboutPage()
  if (page === null) redirect(aboutHref({ status: 'not_found' }))

  const form = readAboutTeamForm(formData)
  const submission = toAboutTeam(form, page.current.team.image_id)

  if (!submission.ok) {
    redirect(
      aboutHref({ status: 'ugyldig', focus: CARD_ANCHOR.team }, encodeAboutTeamEcho(form, submission.issues)),
    )
  }

  const write = aboutSectionWrite('team', submission.values, page.live.team)

  const result = await saveEntityDraft(profile, {
    entity: 'page:about',
    expectedUpdatedAt: target.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  reportSave(CARD_ANCHOR.team, result.status, write.clear.length === 0)
}

export async function saveAboutMethod(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', aboutHref({ status: RATE_LIMIT_STATUS }))

  const target = await targetOf(formData, ABOUT_METHOD_FORM.version)

  const page = await readAdminAboutPage()
  if (page === null) redirect(aboutHref({ status: 'not_found' }))

  const form = readAboutMethodForm(formData)
  const submission = toAboutMethod(form, page.current.method.image_id)

  if (!submission.ok) {
    redirect(
      aboutHref(
        { status: 'ugyldig', focus: CARD_ANCHOR.method },
        encodeAboutMethodEcho(form, submission.issues),
      ),
    )
  }

  const write = aboutSectionWrite('method', submission.values, page.live.method)

  const result = await saveEntityDraft(profile, {
    entity: 'page:about',
    expectedUpdatedAt: target.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  reportSave(CARD_ANCHOR.method, result.status, write.clear.length === 0)
}
