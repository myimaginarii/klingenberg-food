'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { imageExists } from '@/lib/content/images-admin'
import { readAdminWeeklySpecial } from '@/lib/content/weekly-admin'
import { imageDraftWrite, readImageSelectionForm } from '@/lib/images/selection'
import { saveEntityDraft } from '@/lib/publishing/drafts'

import { weeklyHref } from './routes'

/**
 * Choosing Ugens ret's photo — design 1ag's "Billede (valgfrit)"; phase 10C-1.
 *
 * An ordinary draft change (§6), exactly like every other field on the card: the
 * selection is written into `weekly_special.draft` through `saveEntityDraft`, so
 * the hjemmeside keeps the published photo — or its lack of one — until somebody
 * presses Offentliggør, the preview shows the pending one, and no cache tag is
 * expired here.
 *
 * The browser says two things and only two (brief §6): the version token, and the
 * chosen image's id — or nothing, which is "Fjern billede" (a pending clearing,
 * never a library deletion; brief §10). The server verifies the rest: the id must
 * name an image this caller can read, `saveEntityDraft` re-parses the value
 * against `weeklySpecialDraft` strictly, re-checks the role matrix, and applies
 * the version token as optimistic concurrency. The delta rule
 * (`imageDraftWrite`) keeps §4's "only the changed fields" literally true —
 * choosing the photo that is already live takes `image_id` back out of the
 * draft, and every other pending field survives untouched in both directions.
 */
export async function saveWeeklyImage(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', weeklyHref({ status: RATE_LIMIT_STATUS }))

  const request = readImageSelectionForm(formData)
  if (request === null) redirect(weeklyHref({ status: 'failed', focus: 'image' }))

  const weekly = await readAdminWeeklySpecial()
  if (weekly === null) redirect(weeklyHref({ status: 'not_found' }))

  // Draft JSON has no foreign key, so an id that names nothing must be refused
  // here — a dangling pending reference is exactly what 10C-1 exists to prevent.
  if (request.imageId !== null && !(await imageExists(request.imageId))) {
    redirect(weeklyHref({ status: 'billede_findes_ikke', focus: 'image' }))
  }

  const write = imageDraftWrite(request.imageId, weekly.live.image_id)

  const result = await saveEntityDraft(profile, {
    entity: 'weekly_special',
    expectedUpdatedAt: request.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    weeklyHref({
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
