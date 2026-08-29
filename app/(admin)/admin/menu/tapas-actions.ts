'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { applyTapasGroupEdit, tapasDetailsWrite } from '@/lib/menu/tapas'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import { readMenuEditContext } from './edit-context'
import { menuHref, tapasGroupAnchor, tapasNewItemAnchor } from './routes'
import { encodeTapasEcho, readTapasForm } from './tapas-form'

/**
 * Editing one Tapas list — technical plan §4 (decision 3), §6; phase 5F.
 *
 * **An ordinary draft change**, and the whole file is arranged to make that obvious.
 * There is no `expirePublicCacheTags` here, no publish call, no live-column write and no
 * Tapas-specific RPC: the document goes into `dishes.draft` under `details`, the public
 * menu keeps the published lists, and the new ones reach guests when somebody presses
 * Offentliggør — the same button and the same phase-4 machinery a price change uses.
 *
 * Seven steps, in a fixed order:
 *
 *   1. establish who is asking       — requireStaff()
 *   2. parse the submission          — tapas-form.ts, strictly
 *   3. read the server's own menu    — edit-context.ts
 *   4. apply the edit                — lib/menu/tapas.ts, pure
 *   5. decide set or clear           — tapasDetailsWrite, pure
 *   6. write the draft               — lib/publishing/drafts.ts
 *   7. report                        — a redirect back to the group
 *
 * WHAT THE BROWSER IS AND IS NOT ALLOWED TO SAY
 *
 * It says: which dish, which version it loaded, which of the three groups, the heading,
 * the item texts and which button it pressed. Every structural fact — that there are
 * exactly three groups, in that order, with those ids, that mode and that `choose` count
 * — comes from `TAPAS_GROUP_RULES`, and the other two groups' contents come from the
 * document the server just read in step 3. A submission has no field for any of them,
 * so there is nothing to forge and nothing to validate away; `saveEntityDraft` then
 * re-parses the finished document against `tapasDetailsSchema` strictly, which is the
 * second, independent statement of the same rules.
 *
 * WHY `merge`, NEVER `replace`
 *
 * This editor knows about exactly one field. `replace` mode says "these values *are* the
 * draft", which would delete a colleague's pending price, name, description, section or
 * position the moment anybody edited a dressing. `merge` adds the document to whatever
 * is already there, and `clear` takes it out again when the lists end up identical to
 * the published ones — see `tapasDetailsWrite`.
 */
export async function editTapasList(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const request = readTapasForm(formData)
  if (request === null) redirect(menuHref({ status: 'ugyldig' }))

  const target = draftTargetSchema.safeParse({
    entity: 'dish',
    entityId: request.dishId,
    expectedUpdatedAt: request.version,
  })

  if (!target.success) redirect(menuHref({ status: 'ugyldig' }))

  const menu = await readMenuEditContext()
  const dish = menu.dish(request.dishId)

  if (dish === undefined) redirect(menuHref({ status: 'not_found' }))

  const section = menu.slugOf(dish.categoryId)
  const { groupId } = request.submission

  // The Tapas editor exists only where a Tapas document does. A submission naming an
  // ordinary dish is refused here rather than turning one into a Tapas entry — becoming
  // or ceasing to be the Tapas entry is not an edit this screen offers.
  if (dish.tapas === null) {
    redirect(menuHref({ section, dish: dish.id, status: 'ikke_tapas' }))
  }

  // The document the *server* holds, drafts applied — never one a browser sent, because
  // a browser never sends one.
  const edited = applyTapasGroupEdit(dish.tapas, request.submission)

  if (!edited.ok) {
    // A stale or forged position: there is nothing to show beneath a field, so this is
    // the same plain refusal a malformed submission gets.
    if (edited.issues === null) {
      redirect(menuHref({ section, dish: dish.id, status: 'ugyldig' }))
    }

    redirect(
      menuHref(
        {
          section,
          dish: dish.id,
          status: 'ugyldig',
          tapasFocus: tapasGroupAnchor(groupId),
        },
        encodeTapasEcho(groupId, edited.heading, edited.items, edited.issues),
      ),
    )
  }

  const write = tapasDetailsWrite(edited.document, dish.liveTapas)

  const result = await saveEntityDraft(profile, {
    entity: 'dish',
    entityId: dish.id,
    // The version this form was rendered from. Optimistic concurrency (§6): a colleague
    // who saved first wins, and this person is told rather than overwriting them.
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.action === 'set' ? { details: write.details } : {},
    clear: write.action === 'clear' ? ['details'] : undefined,
  })

  // Tilføj punkt comes back to the empty field, so the next item can be typed straight
  // away; every other edit comes back to the group it was about. The target travels as a
  // parameter as well as a fragment — see the note in `routes.ts`: two saves whose
  // addresses differed only by their fragment would store the edit and leave the screen
  // showing the old lists.
  const anchor =
    result.status === 'saved' && request.submission.edit.kind === 'add'
      ? tapasNewItemAnchor(groupId)
      : tapasGroupAnchor(groupId)

  redirect(
    menuHref({
      section,
      dish: dish.id,
      status: result.status === 'saved' ? 'tapas_gemt' : result.status,
      tapasFocus: anchor,
    }),
  )
}
