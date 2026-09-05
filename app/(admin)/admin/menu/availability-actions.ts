'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { setDishSoldOut } from '@/lib/menu/sold-out'

import { readAvailabilityForm } from './availability-form'
import { menuHref } from './routes'

/**
 * Tilgængelig / Udsolgt — design 1r / 1y, technical plan §6, §7b.
 *
 * The immediate path, and the *only* action in this administration that changes the
 * hjemmeside without a publish. Six steps, in a fixed order, and nothing else:
 *
 *   1. establish who is asking          — requireStaff()
 *   2. parse the submission             — availability-form.ts, strictly
 *   3. perform the transaction          — lib/menu/sold-out.ts → set_dish_sold_out()
 *   4. expire the public cache tag      — only after a result that changed something
 *   5. offer ~10 seconds of Fortryd     — as three query parameters, not as state
 *   6. report                           — a redirect back to the section
 *
 * **Fortryd is this same action.** The undo strip renders one more availability form
 * with `udsolgt` inverted and the version token this write returned, so pressing it is
 * a second authorized server write down the identical code path: guarded, validated,
 * concurrency-checked and audited. There is no undo endpoint, no undo token, no server
 * memory of what was undone, and nothing the browser can assert about it. If the page
 * is reloaded away the offer is gone and the change stands — which is what §6 says
 * happens, and why the log is the recovery path.
 *
 * WHY THE CACHE IS EXPIRED HERE AND NOT IN THE DOMAIN MODULE
 *
 * The same split `publish-actions.ts` uses: `setDishSoldOut` returns the tags, this
 * action expires them, and only for a status that reached the row. Expiring a tag for
 * a write that was refused would show visitors a "new" page identical to the old one
 * while the screen reported an error — the cache telling a story the database does not
 * agree with. Keeping the two apart makes that checkable by reading one function.
 *
 * WHAT IT DOES NOT DO
 *
 * No draft is written, nothing is added to `pending_changes`, and `lib/publishing` is
 * not called at all. A dish marked Udsolgt gains no Kladde badge and appears in no
 * publish list, because nothing here has anything to do with publishing.
 */
export async function setDishAvailability(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('operation:immediate', menuHref({ status: RATE_LIMIT_STATUS }))

  const request = readAvailabilityForm(formData)
  if (request === null) redirect(menuHref({ status: 'ugyldig' }))

  const result = await setDishSoldOut(profile, {
    dishId: request.dishId,
    soldOut: request.soldOut,
    expectedUpdatedAt: request.expectedUpdatedAt,
  })

  const back = {
    section: request.section,
    dish: request.editorOpen ? request.dishId : null,
  }

  if (result.status !== 'updated' && result.status !== 'unchanged') {
    redirect(menuHref({ ...back, status: availabilityStatusCode(result.status) }))
  }

  // Committed. Only now may the public site be told, and only for a write that moved
  // the row — `unchanged` changed nothing, so there is nothing to expire and nothing
  // to undo either.
  if (result.status === 'updated') {
    expirePublicCacheTags(result.cacheTags)
  }

  redirect(
    menuHref({
      ...back,
      undo:
        result.status === 'updated' && result.updatedAt !== null
          ? {
              dishId: request.dishId,
              version: result.updatedAt,
              // Fortryd puts it back the way it was, which is the opposite of what
              // this write asked for. No stored date travels with it — see the note on
              // `setDishSoldOut`.
              soldOut: !request.soldOut,
            }
          : null,
      status: result.status === 'unchanged' ? 'uaendret' : null,
    }),
  )
}

/** The refusal codes this screen already knows how to word, plus the one new one. */
function availabilityStatusCode(status: 'conflict' | 'not_found' | 'forbidden' | 'invalid_date' | 'failed'): string {
  return status === 'invalid_date' ? 'udsolgt_dato' : status
}
