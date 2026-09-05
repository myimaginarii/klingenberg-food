'use server'

import { redirect } from 'next/navigation'

import { requireOwner } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { readAdminHomePage } from '@/lib/content/home-admin'
import { readAdminMenuContent } from '@/lib/content/menu-admin'
import { applyFeaturedEdit, featuredDishesWrite } from '@/lib/pages/home'
import { saveEntityDraft } from '@/lib/publishing/drafts'

import { readHomeFeaturedForm } from './forms'
import { featuredSlotAnchor, homeHref, SECTION_ANCHOR } from './routes'

/**
 * "Udvalgte burgere (vælg 3)" — 1u's list controls; technical plan §4, §5, §6, §7e
 * item 4.
 *
 * One action for the five controls — add, change, remove, move up, move down — because
 * they are five presses on one list, and the list is what is written: the whole
 * `featured_dish_ids` array, as an ordinary draft change (§6). The rules that decide
 * what a press does (at most three, no dish twice, a slot that exists, a move that goes
 * somewhere) are `applyFeaturedEdit` in `lib/pages/home.ts`, pure and unit-tested;
 * this file turns its refusals into sentences and nothing more.
 *
 * WHAT THE SERVER CHECKS THAT THE BROWSER CANNOT DECIDE
 *
 *   * **The dish exists on the menu**, read through the caller's own JWT and excluding
 *     soft-deleted dishes — draft JSON has no foreign key, so a dangling id is refused
 *     here rather than stored. A dish the *published* document already names but that
 *     has since been deleted is a different case (§7e item 4): it stays where the Owner
 *     wrote it until the Owner removes it, which "Fjern" on that slot does.
 *   * **The version token**, applied as optimistic concurrency by `saveEntityDraft`.
 *   * **The role**, three times over: `requireOwner()`, `mayChangeEntity`, RLS.
 *
 * The delta is measured against the **published** list, so a list edited back to what
 * the hjemmeside already shows stops being a pending change (§4). Nothing here expires a
 * cache tag; "Tre fra menuen" moves only when the Forside is published.
 */
export async function updateFeaturedDishes(formData: FormData): Promise<void> {
  const profile = await requireOwner()
  await enforceRateLimit('content:save', homeHref({ status: RATE_LIMIT_STATUS }))

  const anchor = SECTION_ANCHOR.featured_dish_ids

  const request = readHomeFeaturedForm(formData)
  if (request === null) redirect(homeHref({ status: 'ret_ugyldig', focus: anchor }))

  const [home, menu] = await Promise.all([readAdminHomePage(), readAdminMenuContent()])
  if (home === null) redirect(homeHref({ status: 'not_found' }))

  const edit = request.edit

  if (
    (edit.kind === 'add' || edit.kind === 'replace') &&
    !menu.dishes.some((dish) => dish.id === edit.dishId)
  ) {
    redirect(homeHref({ status: 'ret_findes_ikke', focus: anchor }))
  }

  const applied = applyFeaturedEdit(home.current.featured_dish_ids, edit)

  if (!applied.ok) {
    redirect(homeHref({ status: FEATURED_REFUSALS[applied.error], focus: anchor }))
  }

  const write = featuredDishesWrite(applied.ids, home.live.featured_dish_ids)

  const result = await saveEntityDraft(profile, {
    entity: 'page:home',
    expectedUpdatedAt: request.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  if (result.status !== 'saved') {
    redirect(homeHref({ status: result.status, focus: anchor }))
  }

  // Land on the slot the press was about, so the keyboard continues from there; a
  // removal lands on the list itself, because the slot is gone.
  const focus =
    edit.kind === 'remove'
      ? anchor
      : edit.kind === 'add'
        ? featuredSlotAnchor(applied.ids.length - 1)
        : edit.kind === 'move'
          ? featuredSlotAnchor(edit.direction === 'up' ? edit.index - 1 : edit.index + 1)
          : featuredSlotAnchor(edit.index)

  redirect(homeHref({ status: FEATURED_OUTCOMES[edit.kind], focus }))
}

/** The screen's own code per press — one sentence each in `HomeNotices`. */
const FEATURED_OUTCOMES = {
  add: 'ret_tilfoejet',
  replace: 'ret_skiftet',
  remove: 'ret_fjernet',
  move: 'ret_flyttet',
} as const

const FEATURED_REFUSALS = {
  full: 'ret_fuld',
  duplicate: 'ret_allerede_valgt',
  no_such_slot: 'ret_ugyldig',
  unmovable: 'ret_ugyldig',
} as const
