'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { dishDraftDelta, DISH_EDITOR_FIELDS } from '@/lib/menu/admin'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import { readMenuEditContext } from './edit-context'

import {
  DISH_FORM,
  encodeDishFormEcho,
  readDishForm,
  toDishDraftValues,
  type DishErrorCode,
} from './dish-form'
import { menuHref } from './routes'

/**
 * Gem — saving a dish as a draft. Design 1r, technical plan §6.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking        — requireStaff()
 *   2. parse the target               — draftTargetSchema (entity, id, version token)
 *   3. read the server's own menu     — edit-context.ts
 *   4. map the form to draft values   — dish-form.ts, using the menu rules
 *   5. reduce it to what changed      — dishDraftDelta (§4)
 *   6. write the draft                — lib/publishing/drafts.ts
 *   7. report                         — a redirect back to the panel
 *
 * **Nothing here writes to the public site**, and nothing here expires a cache tag. A
 * draft is a draft: the live columns are untouched, so the public menu is byte-identical
 * to what it was before this ran. The only thing that expires a public tag in this
 * screen is a successful publish, in `publish-actions.ts`.
 *
 * No validation, authorization, SQL or merge logic lives in this file. `saveEntityDraft`
 * re-parses the values against `dishDraft` — strictly, so an unknown key is a refusal —
 * re-checks the role matrix, applies the version token as optimistic concurrency, and
 * merges the new values into any existing draft. None of that is reimplemented for the
 * menu, which is the whole reason phase 4 built it.
 *
 * THE CATEGORY RULE IS DECIDED HERE, NOT IN THE DROPDOWN
 *
 * `menu.categoryAllows` is built from the sections the *server* just read, and it is
 * what `toDishDraftValues` checks the submitted section against. A form that names Ugens
 * ret — or a section that does not exist — is refused with `sektion:not_allowed` no
 * matter what the browser was showing.
 */
export async function saveDishDraft(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const target = draftTargetSchema.safeParse({
    entity: 'dish',
    entityId: formData.get(DISH_FORM.dishId),
    expectedUpdatedAt: formData.get(DISH_FORM.version),
  })

  if (!target.success) redirect(menuHref({ status: 'ugyldig' }))

  const menu = await readMenuEditContext()
  const dish = menu.dish(target.data.entityId ?? '')

  if (dish === undefined) redirect(menuHref({ status: 'not_found' }))

  const form = readDishForm(formData)

  const mapped = toDishDraftValues(form, {
    existingLabels: dish.labels,
    categoryAllows: menu.categoryAllows,
  })

  if (!mapped.ok) {
    redirect(
      menuHref(
        { section: menu.slugOf(dish.categoryId), dish: dish.id, status: 'ugyldig' },
        encodeDishFormEcho(form, mapped.errors as readonly DishErrorCode[]),
      ),
    )
  }

  // A draft holds only the changed fields (§4). The form submits the whole dish, so it
  // is reduced to the difference against what is *live* — not against what the form was
  // rendered from, which already has any existing draft merged over it.
  //
  // A dish that has never been published is the one exception, and it is not a special
  // case so much as the honest reading of the same rule: nothing about it is live yet,
  // so *everything* about it is a pending change. Reducing it to a difference could
  // leave it with an empty draft, and `pending_changes` derives its list from
  // `draft is not null` — an unpublished dish with no draft would be invisible to the
  // publish machinery and could never be made public at all.
  const delta = dish.isNewDraft ? mapped.values : dishDraftDelta(mapped.values, dish.live)

  // Moving a dish to another section places it at the end of that section's order, in
  // the draft — the public position is unchanged until this is published (§6).
  const values: Record<string, unknown> =
    delta.category_id === undefined
      ? { ...delta }
      : { ...delta, sort_order: menu.endOfCategory(delta.category_id) }

  /*
   * `merge` plus an explicit `clear`, and **not** `replace`.
   *
   * `replace` used to be right, and its reasoning still is for the fields this panel
   * renders: a value somebody has just changed back to what is live must leave the
   * draft rather than survive invisibly inside it. What changed is that the panel is no
   * longer the only editor a dish has. Phase 5E writes `sort_order` from the list, and
   * `replace` would have thrown that away — silently — the next time anybody saved a
   * price on the same dish, leaving half a new order pending and nobody any the wiser.
   *
   * So the panel now says exactly what it means: merge the six fields it owns, and
   * remove the ones of *those six* that no longer differ from the published values.
   * `sort_order`, `details` and `image_id` belong to other interactions and are not
   * mentioned either way, so they survive a save from here untouched — which is the
   * same courtesy the reorder already extends to a pending price.
   */
  const clear = DISH_EDITOR_FIELDS.filter((field) => values[field] === undefined)

  const result = await saveEntityDraft(profile, {
    entity: 'dish',
    entityId: dish.id,
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values,
    clear,
  })

  // Stay on the section the dish is in *after* the save, so a move is visible at once.
  const section = menu.slugOf(
    result.status === 'saved' ? mapped.values.category_id : dish.categoryId,
  )

  redirect(
    menuHref({
      section,
      dish: result.status === 'saved' ? null : dish.id,
      status: result.status,
    }),
  )
}
