'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { imageExists } from '@/lib/content/images-admin'
import { readAdminTakeawayPage } from '@/lib/content/takeaway-admin'
import { imageDraftWrite, readImageSelectionForm } from '@/lib/images/selection'
import { saveEntityDraft } from '@/lib/publishing/drafts'

import { CARD_ANCHOR, IMAGE_SLOT_ANCHOR, takeawayHref } from './routes'

/**
 * Choosing Mad ud af huset's photograph — 1aj's "Billede (valgfrit)"; phase 11B over
 * the 10C-1 picker.
 *
 * The same shape as the other editors' image actions: an ordinary draft change (§6)
 * through `saveEntityDraft`, so the hjemmeside keeps the published photo until
 * Offentliggør, the preview shows the pending one, and no cache tag is expired here.
 * The browser submits the version token and an image id (or nothing — "Fjern
 * billede", which clears the selection and deletes no asset); the server verifies
 * the image exists through the caller's own JWT before any draft is written, because
 * draft JSON has no foreign key to refuse a dangling id for it.
 *
 * `image_id` is a **top-level** key of this document, so the delta is the one-field
 * rule every column entity uses (`imageDraftWrite`): choosing the photo that is
 * already live takes the key back out of the draft, and removing a live photo writes
 * an explicit `null`.
 *
 * `requireStaff()` first, `mayChangeEntity` second, `pages_update_scoped` third (§5).
 */
export async function saveTakeawayImage(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const request = readImageSelectionForm(formData)
  if (request === null) redirect(takeawayHref({ status: 'failed', focus: IMAGE_SLOT_ANCHOR }))

  const page = await readAdminTakeawayPage()
  if (page === null) redirect(takeawayHref({ status: 'not_found' }))

  if (request.imageId !== null && !(await imageExists(request.imageId))) {
    redirect(takeawayHref({ status: 'billede_findes_ikke', focus: IMAGE_SLOT_ANCHOR }))
  }

  const write = imageDraftWrite(request.imageId, page.live.image_id)

  const result = await saveEntityDraft(profile, {
    entity: 'page:takeaway',
    expectedUpdatedAt: request.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    takeawayHref({
      focus: result.status === 'saved' ? IMAGE_SLOT_ANCHOR : CARD_ANCHOR.text,
      status:
        result.status !== 'saved'
          ? result.status
          : request.imageId === null
            ? 'billede_fjernet'
            : 'billede_gemt',
    }),
  )
}
