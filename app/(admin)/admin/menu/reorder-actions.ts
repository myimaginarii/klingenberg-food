'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { orderFingerprint, reorderDishes, sortOrderWrites } from '@/lib/menu/reorder'
import { saveEntityDraft } from '@/lib/publishing/drafts'

import { readMenuEditContext } from './edit-context'
import { readReorderForm } from './reorder-form'
import { menuHref } from './routes'

/**
 * Moving a dish inside its section — design 1r / 1y, technical plan §4, §6.
 *
 * **An ordinary draft change**, and the whole file is arranged to make that obvious.
 * There is no `expirePublicCacheTags` here, no publish call and no live-column write:
 * `sort_order` goes into `draft`, the public menu keeps the published order, and the
 * new order reaches guests when somebody presses Offentliggør — the same button, the
 * same phase-4 machinery, no reorder-specific publish path anywhere in the system.
 *
 * Eight steps, in a fixed order:
 *
 *   1. establish who is asking          — requireStaff()
 *   2. parse the submission             — reorder-form.ts, strictly
 *   3. read the server's own menu       — edit-context.ts
 *   4. refuse a move against a stale list — orderFingerprint (§7e item 2)
 *   5. compute the new order            — reorderDishes, pure
 *   6. reduce it to draft changes       — sortOrderWrites, pure
 *   7. write them                       — lib/publishing/drafts.ts, one dish at a time
 *   8. report                           — a redirect back to the section
 *
 * WHAT THE BROWSER IS AND IS NOT ALLOWED TO SAY
 *
 * It says two things: *which dish*, and *which position in the list it can see*. It does
 * not send the list, the resulting order, any `sort_order` value, or any dish's version
 * token. Every one of those comes from the read in step 3, which is also where the
 * category comes from — so a submission cannot move a dish into another section, cannot
 * choose the numbering, and cannot name a row to write. Cross-category movement stays
 * where phase 5B put it: a field in the dish editor, saved as an ordinary draft.
 *
 * WHY THE FINGERPRINT IS CHECKED BEFORE ANYTHING IS WRITTEN
 *
 * A move is one intention that becomes several row writes, and each row carries its own
 * `updated_at` into its own UPDATE (§6). Without step 4, a colleague's intervening edit
 * would be discovered *during* the writes — after some had already landed — and the
 * person would be told "conflict" about a section that had been half-rearranged. The
 * fingerprint turns that into a refusal before the first write, with nothing changed.
 *
 * It cannot close the window completely: between the read and the last write another
 * session can still act, and then a later write is refused while an earlier one stands.
 * That residue is bounded and harmless by construction — every one of those writes is a
 * **draft**, so no guest ever sees a half-applied order, and the screen the person lands
 * on is re-rendered from the database rather than from what they hoped. Making it
 * impossible rather than merely harmless would mean a multi-row transaction in SQL,
 * which is a heavier mechanism than a draft ordering needs and is not what §6 asks for.
 *
 * WHY `merge`, NEVER `replace`
 *
 * A reorder knows about exactly one field. `replace` mode says "these values *are* the
 * draft" and is right for the dish editor, which renders and submits every editable
 * field; here it would delete a colleague's pending price or description the moment
 * somebody dragged a row. `merge` adds the position to whatever is already there, and
 * `clear` takes it out again when the dish lands back where it is published — see
 * `sortOrderWrites`.
 */
export async function moveDishInSection(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', menuHref({ status: RATE_LIMIT_STATUS }))

  const request = readReorderForm(formData)
  if (request === null) redirect(menuHref({ status: 'ugyldig' }))

  const menu = await readMenuEditContext()
  const dish = menu.dish(request.dishId)

  if (dish === undefined) redirect(menuHref({ status: 'not_found' }))

  // Ugens ret holds no dishes and never will (`mayHoldDishes`), so a dish cannot be in
  // it — but the question is asked of the same rule the editor and the create action
  // ask, rather than assumed from the fact that the read returned something.
  if (!menu.categoryAllows(dish.categoryId)) {
    redirect(menuHref({ status: 'invalid_category' }))
  }

  const section = menu.slugOf(dish.categoryId)
  const back = { section, movedDish: dish.id }
  const ordered = menu.dishesIn(dish.categoryId)

  // Step 4. The order the person acted on, against the order that is there now.
  if (orderFingerprint(dish.categoryId, ordered) !== request.baseline) {
    redirect(menuHref({ section, status: 'conflict' }))
  }

  const fromIndex = ordered.findIndex((candidate) => candidate.id === dish.id)
  const moved = reorderDishes(ordered, fromIndex, request.toIndex)

  // An index outside the section is a stale screen or a forged submission, and neither
  // is worth guessing at. `reorderDishes` refuses rather than clamping, and so does this.
  if (!moved.ok) redirect(menuHref({ section, status: 'ugyldig' }))

  // The pure rule works on four numbers per dish, not on an `AdminDish`. Mapping here
  // rather than widening `OrderedDish` keeps `lib/menu/reorder.ts` free of the admin
  // read layer's shape — and makes "does this dish's draft already carry a position"
  // one expression, in one place, derived from the fields the stored draft changes.
  const writes = sortOrderWrites(
    moved.items.map((candidate) => ({
      id: candidate.id,
      sortOrder: candidate.sortOrder,
      liveSortOrder: candidate.liveSortOrder,
      hasDraftSortOrder: candidate.draftFields.includes('sort_order'),
    })),
  )

  // Nothing to do: the dish was dropped back where it started, or the move produced the
  // positions the drafts already carry. Reported as a plain return to the section — a
  // success message about a change nobody made is noise, and the live region announces
  // the position either way.
  if (writes.length === 0) redirect(menuHref(back))

  const byId = new Map(ordered.map((candidate) => [candidate.id, candidate]))

  for (const write of writes) {
    const target = byId.get(write.id)

    /* v8 ignore next -- every write names a dish from `ordered`, which built the map. */
    if (target === undefined) redirect(menuHref({ section, status: 'failed' }))

    const result = await saveEntityDraft(profile, {
      entity: 'dish',
      entityId: target.id,
      // This dish's own version, from the server's read — never a token the browser
      // supplied, and never one borrowed from the dish that was dragged.
      expectedUpdatedAt: target.updatedAt,
      mode: 'merge',
      values: write.action === 'set' ? { sort_order: write.sortOrder } : {},
      clear: write.action === 'clear' ? ['sort_order'] : undefined,
    })

    // The first refusal stops the run. Its status is already a sentence
    // `MenuStatusNotice` knows how to say, and the screen the person lands on is
    // re-rendered from the database, so it shows what is actually stored.
    if (result.status !== 'saved') redirect(menuHref({ section, status: result.status }))
  }

  redirect(menuHref({ ...back, status: 'flyttet' }))
}
