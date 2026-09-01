'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { imageExists } from '@/lib/content/images-admin'
import { readAdminMenuContent } from '@/lib/content/menu-admin'
import { imageDraftWrite, readImageSelectionForm } from '@/lib/images/selection'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { rowId } from '@/lib/schemas/primitives'

import { DISH_FORM } from './dish-form'
import { menuHref } from './routes'

/**
 * Choosing a dish's photo — design 1r's FOTO slot; phase 10C-1.
 *
 * An ordinary draft change (§6), exactly like renaming the dish: the selection is
 * written into `dishes.draft` through `saveEntityDraft`, so the hjemmeside keeps
 * the published photo until somebody presses Offentliggør, the preview shows the
 * pending one, and no cache tag is expired here.
 *
 * The browser says three things (brief §6): which dish (`ret`, an id the server
 * resolves against its own read), the version token, and the chosen image's id —
 * or nothing, which is "Fjern billede" (a pending clearing, never a library
 * deletion; brief §10). `sektion` is navigation only, exactly as it is on the
 * availability form. The server verifies the rest: the image must exist for this
 * caller, `saveEntityDraft` re-parses against `dishDraft` strictly, re-checks the
 * role matrix, and applies the version token as optimistic concurrency. The delta
 * rule (`imageDraftWrite`) keeps §4's "only the changed fields" literally true,
 * and the panel's own six fields are not named in either direction — a selection
 * can never overwrite a half-typed description, and a Gem can never clear a
 * pending photo.
 */
export async function saveDishImage(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const rawSection = formData.get('sektion')
  const section = typeof rawSection === 'string' && rawSection.length > 0 ? rawSection : null

  const dishId = rowId('Retten').safeParse(formData.get(DISH_FORM.dishId))
  const request = readImageSelectionForm(formData)

  if (!dishId.success || request === null) {
    redirect(menuHref({ section, status: 'failed' }))
  }

  const menu = await readAdminMenuContent()
  const dish = menu.dishes.find((candidate) => candidate.id === dishId.data)
  if (dish === undefined) redirect(menuHref({ section, status: 'not_found' }))

  // Draft JSON has no foreign key, so an id that names nothing must be refused
  // here — a dangling pending reference is exactly what 10C-1 exists to prevent.
  if (request.imageId !== null && !(await imageExists(request.imageId))) {
    redirect(
      menuHref({
        section,
        dish: dish.id,
        focusImage: true,
        status: 'billede_findes_ikke',
      }),
    )
  }

  const write = imageDraftWrite(request.imageId, dish.liveImageId)

  const result = await saveEntityDraft(profile, {
    entity: 'dish',
    entityId: dish.id,
    expectedUpdatedAt: request.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    menuHref({
      section,
      dish: dish.id,
      focusImage: true,
      status:
        result.status !== 'saved'
          ? result.status
          : request.imageId === null
            ? 'billede_fjernet'
            : 'billede_gemt',
    }),
  )
}
