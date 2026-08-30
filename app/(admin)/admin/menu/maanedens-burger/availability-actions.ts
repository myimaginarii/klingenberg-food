'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { setMonthlyBurgerSoldOut } from '@/lib/menu/monthly-availability'

import { readMonthlyAvailabilityForm } from './forms'
import { monthlyHref } from './routes'

/**
 * Tilgængelig / Udsolgt on Månedens burger — design 1ah; §6, §7b.
 *
 * The immediate path, and the only action on this screen that changes the hjemmeside
 * without a publish. §6's table names it; 1ah says it beside the switch — *"Udsolgt slår
 * igennem straks"*.
 *
 * Six steps, in a fixed order, and nothing else:
 *
 *   1. establish who is asking          — requireStaff()
 *   2. parse the submission             — ./forms.ts, strictly
 *   3. perform the transaction          — lib/menu/monthly-availability.ts
 *   4. expire the public cache tag      — only after a result that changed something
 *   5. offer ~10 seconds of Fortryd     — as two query parameters, not as state
 *   6. report                           — a redirect back to the card
 *
 * **Fortryd is this same action.** The undo strip renders one more availability form
 * with `udsolgt` inverted and the version token this write returned, so pressing it is a
 * second authorized server write down the identical code path: guarded, validated,
 * concurrency-checked and audited. There is no undo endpoint, no undo token and no
 * server memory of what was undone. If the page is reloaded away the offer is gone and
 * the change stands — which is what §6 says happens, and why the log is the recovery
 * path.
 *
 * WHY THE CACHE IS EXPIRED HERE AND NOT IN THE DOMAIN MODULE
 *
 * The same split `lib/menu/sold-out.ts` and the publish actions use: the domain module
 * returns the tags, this action expires them, and only for a status that reached the
 * row. Expiring a tag for a write that was refused would show visitors a "new" page
 * identical to the old one while the screen reported an error.
 *
 * WHAT IT DOES NOT DO
 *
 * No draft is written, nothing is added to `pending_changes`, and `lib/publishing` is
 * not called at all beyond the role matrix and the cache tags stated once for the
 * `monthly_burger` entity. A sold-out burger gains no Kladde badge and appears in no
 * publish list, because nothing here has anything to do with publishing. It also cannot
 * move the date window or `show_on_homepage`: the database function names one column.
 *
 * **A sold-out burger is not a hidden burger.** Both public surfaces keep showing it,
 * carrying "Udsolgt i dag" — the Forside section stays where it is with its ordering
 * action withdrawn (§7d), and the menu card renders its sold-out state (§7b). Nothing
 * in this action removes anything; it expires a cache tag and lets the pure view rules
 * decide what that means.
 */
export async function setMonthlyAvailability(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const request = readMonthlyAvailabilityForm(formData)
  if (request === null) redirect(monthlyHref({ status: 'ugyldig', focus: true }))

  const result = await setMonthlyBurgerSoldOut(profile, {
    soldOut: request.soldOut,
    expectedUpdatedAt: request.expectedUpdatedAt,
  })

  if (result.status !== 'updated' && result.status !== 'unchanged') {
    redirect(monthlyHref({ focus: true, status: availabilityStatusCode(result.status) }))
  }

  // Committed. Only now may the public site be told, and only for a write that moved the
  // row — `unchanged` changed nothing, so there is nothing to expire and nothing to undo
  // either.
  if (result.status === 'updated') {
    expirePublicCacheTags(result.cacheTags)
  }

  redirect(
    monthlyHref({
      focus: true,
      undo:
        result.status === 'updated' && result.updatedAt !== null
          ? {
              version: result.updatedAt,
              // Fortryd puts it back the way it was, which is the opposite of what this
              // write asked for. No stored date travels with it: `sold_out_on` means
              // "marked on this Copenhagen date", so restoring a literal earlier date
              // would restore a value the reset rule already reads as cleared.
              soldOut: !request.soldOut,
            }
          : null,
      status: result.status === 'unchanged' ? 'uaendret' : null,
    }),
  )
}

/** The refusal codes this screen knows how to word. */
function availabilityStatusCode(
  status: 'conflict' | 'not_found' | 'forbidden' | 'invalid_date' | 'failed',
): string {
  return status === 'invalid_date' ? 'udsolgt_dato' : status
}
