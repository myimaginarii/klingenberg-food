'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { readAdminAboutPage } from '@/lib/content/about-admin'
import { imageExists } from '@/lib/content/images-admin'
import { readImageSelectionForm } from '@/lib/images/selection'
import { aboutImageWrite, readAboutImageSlot } from '@/lib/pages/about'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

import { ABOUT_IMAGE_FORM } from './forms'
import { aboutHref, CARD_ANCHOR, imageSlotAnchor } from './routes'

/**
 * Choosing one of Om os's three photographs — 1i's "Stedet", "Ét holdfoto" and
 * "Køkken / tilberedning"; phase 14B1 over the 10C-1 picker.
 *
 * The same shape as the other editors' image actions: an ordinary draft change (§6)
 * through `saveEntityDraft`, so the hjemmeside keeps the published photo until
 * Offentliggør, the preview shows the pending one, and no cache tag is expired here.
 * The browser submits the version token, an image id (or nothing — "Fjern billede",
 * which clears the selection and deletes no asset) and which of the three slots it
 * means; the server verifies the image exists through the caller's own JWT before any
 * draft is written, because draft JSON has no foreign key to refuse a dangling id for
 * it.
 *
 * The facade is a top-level key and follows the one-field delta; the team and the
 * kitchen sit inside their sections, which are written whole with the slot's new value
 * beside the section's current words (`aboutImageWrite`) — so a pending edit to the
 * words survives choosing a photo, and choosing the photo that is already live takes
 * the key or the section back out of the draft.
 *
 * `requireStaff()` first, `mayChangeEntity` second, `pages_update_scoped` third (§5).
 */
export async function saveAboutImage(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', aboutHref({ status: RATE_LIMIT_STATUS }))

  const slot = readAboutImageSlot(formData.get(ABOUT_IMAGE_FORM.slot))
  if (slot === null) redirect(aboutHref({ status: 'ugyldig' }))

  const request = readImageSelectionForm(formData)
  if (request === null) redirect(aboutHref({ status: 'failed', focus: imageSlotAnchor(slot) }))

  const page = await readAdminAboutPage()
  if (page === null) redirect(aboutHref({ status: 'not_found' }))

  if (request.imageId !== null && !(await imageExists(request.imageId))) {
    redirect(aboutHref({ status: 'billede_findes_ikke', focus: imageSlotAnchor(slot) }))
  }

  const write = aboutImageWrite(slot, request.imageId, page.current, page.live)

  const result = await saveEntityDraft(profile, {
    entity: 'page:about',
    expectedUpdatedAt: request.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  const card = slot === 'sted' ? CARD_ANCHOR.story : slot === 'holdet' ? CARD_ANCHOR.team : CARD_ANCHOR.method

  redirect(
    aboutHref({
      focus: result.status === 'saved' ? imageSlotAnchor(slot) : card,
      status:
        result.status !== 'saved'
          ? result.status
          : request.imageId === null
            ? 'billede_fjernet'
            : 'billede_gemt',
    }),
  )
}
