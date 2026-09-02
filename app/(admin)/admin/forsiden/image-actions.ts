'use server'

import { redirect } from 'next/navigation'

import { requireOwner } from '@/lib/auth/guards'
import { readAdminHomePage } from '@/lib/content/home-admin'
import { imageExists } from '@/lib/content/images-admin'
import { readImageSelectionForm } from '@/lib/images/selection'
import { homeSectionWrite } from '@/lib/pages/home'
import { saveEntityDraft } from '@/lib/publishing/drafts'

import { HOME_IMAGE_FORM, readHomeSectionKey } from './forms'
import { homeHref, imageSlotAnchor, SECTION_ANCHOR } from './routes'

/**
 * Choosing one of the Forside's three photographs — 1u's "Hovedbillede",
 * "Udmærkelsesfoto" and "Holdfoto"; phase 11A over the 10C-1 picker.
 *
 * The same shape as the other editors' image actions, on the Owner-only document: an
 * ordinary draft change (§6) through `saveEntityDraft`, so the hjemmeside keeps the
 * published photo until Offentliggør, the preview shows the pending one, and no cache
 * tag is expired here. The browser submits the version token, an image id (or nothing
 * — "Fjern billede", which clears the selection and deletes no asset) and which of the
 * three slots it means; the server verifies the image exists through the caller's own
 * JWT before any draft is written, because draft JSON has no foreign key to refuse a
 * dangling id for it.
 *
 * The section is written **whole** (`lib/schemas/page-documents.ts`): the slot's new
 * value beside the section's current words, read from the merged document — so a
 * pending edit to the heading survives choosing a photo, and choosing the photo that is
 * already live takes the section back out of the draft when nothing else in it differs.
 *
 * `requireOwner()` first, `mayChangeEntity` second, `pages_update_scoped` third (§5):
 * the same three refusals every write on this screen meets.
 */
export async function saveHomeImage(formData: FormData): Promise<void> {
  const profile = await requireOwner()

  const section = readHomeSectionKey(formData.get(HOME_IMAGE_FORM.section))
  if (section === null) redirect(homeHref({ status: 'ugyldig' }))

  const request = readImageSelectionForm(formData)
  if (request === null) redirect(homeHref({ status: 'failed', focus: imageSlotAnchor(section) }))

  const home = await readAdminHomePage()
  if (home === null) redirect(homeHref({ status: 'not_found' }))

  if (request.imageId !== null && !(await imageExists(request.imageId))) {
    redirect(homeHref({ status: 'billede_findes_ikke', focus: imageSlotAnchor(section) }))
  }

  const submitted = { ...home.current[section], image_id: request.imageId }
  const write = homeSectionWrite(section, submitted, home.live[section])

  const result = await saveEntityDraft(profile, {
    entity: 'page:home',
    expectedUpdatedAt: request.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    homeHref({
      focus: result.status === 'saved' ? imageSlotAnchor(section) : SECTION_ANCHOR[section],
      status:
        result.status !== 'saved'
          ? result.status
          : request.imageId === null
            ? 'billede_fjernet'
            : 'billede_gemt',
    }),
  )
}
