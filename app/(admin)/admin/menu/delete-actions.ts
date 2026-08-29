'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { setDishDeleted } from '@/lib/menu/delete'

import { readDeleteForm } from './delete-form'
import { menuHref } from './routes'

/**
 * Slet ret, and its Fortryd — design 1r / 1y, technical plan §6, §7e item 4.
 *
 * The second of this administration's two immediate paths, and it is written to look
 * exactly like the first (`availability-actions.ts`) without being the first. Six steps,
 * in a fixed order, and nothing else:
 *
 *   1. establish who is asking          — requireStaff()
 *   2. parse the submission             — delete-form.ts, strictly
 *   3. perform the transaction          — lib/menu/delete.ts → set_dish_deleted()
 *   4. expire the public cache tag      — only after a result that changed something
 *   5. offer ~10 seconds of Fortryd     — as two query parameters, not as state
 *   6. report                           — a redirect back to the section
 *
 * **Fortryd is this same action.** The undo strip renders one more deletion form with
 * `slettet` inverted and the version token this write returned, so pressing it is a
 * second authorized server write down the identical code path: guarded, validated,
 * concurrency-checked and audited. There is no undo endpoint, no undo token and no
 * server memory of what was undone. If the page is navigated away from inside the ten
 * seconds the offer is gone and the deletion stands — which is what §6 says happens,
 * and why `audit_log` is the recovery path. The row itself is never removed, so the
 * recovery is real rather than notional.
 *
 * WHY THE TEN SECONDS ARE NOT A SECURITY BOUNDARY
 *
 * Nothing here consults a clock. A Fortryd pressed at second one and a Fortryd pressed
 * from a stale tab an hour later travel the same path and meet the same two gates:
 * `requireStaff()`, and the version token the database checks. The second one is
 * refused not because it is late but because the row has moved on — which is the
 * refusal that actually protects a colleague's work. `AutoDismiss` decides how long a
 * *message* is on screen and nothing else.
 *
 * WHAT IT DOES NOT DO
 *
 * It writes no draft, it publishes nothing, it removes no row, and it does not touch
 * `pages.home` — not through a helper, not through a SECURITY DEFINER function, not at
 * all. A dish that Forsiden features leaves the Forside because the reference stops
 * resolving, and the Owner's document is exactly as they left it. The confirmation says
 * so before the fact; see `lib/menu/delete.ts`.
 */
export async function setDishDeletion(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const request = readDeleteForm(formData)
  if (request === null) redirect(menuHref({ status: 'ugyldig' }))

  const result = await setDishDeleted(profile, {
    dishId: request.dishId,
    deleted: request.deleted,
    expectedUpdatedAt: request.expectedUpdatedAt,
  })

  const back = { section: request.section }

  // Every refusal is one of four codes, and every one of them is already a sentence
  // `MenuStatusNotice` knows how to say. Passing the status straight through keeps the
  // two in step: a fifth status would be a type error there rather than a blank screen
  // here.
  if (result.status !== 'deleted' && result.status !== 'restored' && result.status !== 'unchanged') {
    redirect(menuHref({ ...back, status: result.status }))
  }

  // Committed. Only now may the public site be told, and only for a write that moved
  // the row — `unchanged` changed nothing, so there is nothing to expire and nothing to
  // undo either.
  if (result.status === 'unchanged') {
    redirect(menuHref({ ...back, status: 'uaendret' }))
  }

  expirePublicCacheTags(result.cacheTags)

  // A restore is reported and then finished with. It is deliberately **not** given a
  // Fortryd of its own: the reverse of "put it back" is "delete it", and this screen
  // never offers a deletion that has not been confirmed (§4 of the phase brief). The
  // person who wants it gone again opens the dish and presses Slet ret, and reads the
  // question one more time.
  if (result.status === 'restored') {
    redirect(menuHref({ ...back, dish: request.dishId, status: 'gendannet' }))
  }

  // A deletion is reported by the green Fortryd strip and by nothing else — two
  // confirmations of one change is one too many, which is the rule the availability
  // path already follows. The status code below is the fallback for the case the strip
  // cannot be drawn, so a person is never left with a screen that says nothing.
  redirect(
    menuHref({
      ...back,
      status: result.updatedAt === null ? 'slettet' : null,
      undoDelete:
        result.updatedAt === null
          ? null
          : { dishId: request.dishId, version: result.updatedAt },
    }),
  )
}
