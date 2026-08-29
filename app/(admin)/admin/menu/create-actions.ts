'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { createDishDraft } from '@/lib/publishing/create'
import { saveEntityDraft } from '@/lib/publishing/drafts'

import { encodeDishFormEcho, readDishForm, toDishDraftValues } from './dish-form'
import { readMenuEditContext } from './edit-context'
import { menuHref } from './routes'

/**
 * "+ Tilføj ret" — creating a dish. Design 1r, technical plan §4, §6.
 *
 * The same form as an edit, and deliberately so: a person filling in a new dish should
 * not meet a different panel from the one they use to correct an old one. What differs
 * is only that there is no row yet, so the write happens in two steps:
 *
 *   1. `createDishDraft` inserts the dish with `is_new_draft = true`, which is what
 *      keeps it out of the public menu until somebody publishes it, and writes the
 *      audit row. Name and section are the only values it needs.
 *   2. `saveEntityDraft` then stores the rest — price, description, the ekstra linje,
 *      labels — as an ordinary draft on the row that now exists.
 *
 * Both steps are validated and authorized on the server; neither trusts the browser
 * for anything but text. If step 2 fails the dish still exists, unpublished and
 * invisible to guests, and the person is returned to its editor with the refusal — a
 * recoverable state, rather than a half-created dish they cannot see.
 *
 * The order matters and is the whole of the phase brief's "do not accidentally create a
 * public live dish first": the row is invisible from the instant it exists, because the
 * flag is part of the insert rather than something set afterwards.
 */
export async function createDish(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const menu = await readMenuEditContext()
  const form = readDishForm(formData)

  // A new dish has no labels yet, so nothing can be preserved and nothing can be lost.
  const mapped = toDishDraftValues(form, {
    existingLabels: [],
    categoryAllows: menu.categoryAllows,
  })

  if (!mapped.ok) {
    redirect(
      menuHref(
        { section: menu.slugOf(form.categoryId), creating: true, status: 'ugyldig' },
        encodeDishFormEcho(form, mapped.errors),
      ),
    )
  }

  const created = await createDishDraft(profile, {
    values: { category_id: mapped.values.category_id, name: mapped.values.name },
    sortOrder: menu.endOfCategory(mapped.values.category_id),
    categoryAllows: menu.categoryAllows,
  })

  if (created.status !== 'created' || created.dishId === null || created.updatedAt === null) {
    redirect(
      menuHref(
        {
          section: menu.slugOf(mapped.values.category_id),
          creating: true,
          status: created.status,
        },
        encodeDishFormEcho(form, []),
      ),
    )
  }

  // The row exists and is invisible. Its draft carries the *whole* dish rather than a
  // difference: nothing about a dish that has never been published is live, and
  // `pending_changes` lists a dish only while `draft is not null`, so this is also what
  // makes the new dish appear as something that can be published at all.
  //
  // The rest is an ordinary draft edit, guarded
  // by optimistic concurrency like any other (§6) — the version token is the one the
  // insert itself returned, so no read-back is needed and a genuine conflict would still
  // be reported. Name and section are re-sent unchanged, so the draft describes the
  // whole dish rather than a fragment of it.
  const detail = await saveEntityDraft(profile, {
    entity: 'dish',
    entityId: created.dishId,
    expectedUpdatedAt: created.updatedAt,
    values: mapped.values,
  })

  redirect(
    menuHref({
      section: menu.slugOf(mapped.values.category_id),
      dish: detail.status === 'saved' ? null : created.dishId,
      status: detail.status === 'saved' ? 'created' : detail.status,
    }),
  )
}
