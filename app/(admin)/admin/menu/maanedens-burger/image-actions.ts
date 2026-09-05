'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { imageExists } from '@/lib/content/images-admin'
import { readAdminMonthlyBurger } from '@/lib/content/monthly-admin'
import { imageDraftWrite, readImageSelectionForm } from '@/lib/images/selection'
import { saveEntityDraft } from '@/lib/publishing/drafts'

import { monthlyHref } from './routes'

/**
 * Choosing Månedens burger's photo — design 1ah's "Billede (valgfrit)"; phase
 * 10C-1.
 *
 * The same shape as the weekly screen's `saveWeeklyImage`, on this screen's own
 * singleton: an ordinary draft change (§6) through `saveEntityDraft`, so the
 * hjemmeside keeps the published photo until Offentliggør, the preview shows the
 * pending one, and no cache tag is expired here. The browser submits the version
 * token and an image id (or nothing — "Fjern billede", which clears the selection
 * and deletes no asset, brief §10); the server verifies the image exists through
 * the caller's own JWT before any draft is written, because draft JSON has no
 * foreign key to refuse a dangling id for it.
 */
export async function saveMonthlyImage(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', monthlyHref({ status: RATE_LIMIT_STATUS }))

  const request = readImageSelectionForm(formData)
  if (request === null) redirect(monthlyHref({ status: 'failed', focus: 'image' }))

  const burger = await readAdminMonthlyBurger()
  if (burger === null) redirect(monthlyHref({ status: 'not_found' }))

  if (request.imageId !== null && !(await imageExists(request.imageId))) {
    redirect(monthlyHref({ status: 'billede_findes_ikke', focus: 'image' }))
  }

  const write = imageDraftWrite(request.imageId, burger.live.image_id)

  const result = await saveEntityDraft(profile, {
    entity: 'monthly_burger',
    expectedUpdatedAt: request.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    monthlyHref({
      focus: 'image',
      status:
        result.status !== 'saved'
          ? result.status
          : request.imageId === null
            ? 'billede_fjernet'
            : 'billede_gemt',
    }),
  )
}
