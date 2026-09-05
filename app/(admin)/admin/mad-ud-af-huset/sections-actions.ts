'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { readAdminTakeawayPage } from '@/lib/content/takeaway-admin'
import { applyTakeawaySectionsEdit, takeawaySectionsWrite } from '@/lib/pages/takeaway'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import { encodeTakeawaySectionsEcho, readTakeawaySectionsForm, TAKEAWAY_SECTIONS_FORM } from './forms'
import { CARD_ANCHOR, sectionAnchor, takeawayHref } from './routes'

/**
 * Editing the Tekstafsnit list — design 1aj; technical plan §4, §6; phase 11B.
 *
 * **An ordinary draft change**, and the whole file is arranged to make that obvious.
 * There is no `expirePublicCacheTags` here, no publish call and no live-column
 * write: the list goes into `pages.draft` under `sections`, the public page keeps the
 * published sections, and the new ones reach guests when somebody presses
 * Offentliggør — the same button and the same phase-4 machinery a heading uses.
 *
 * Every button saves (the phase-5F Tapas arrangement): Gem, Tilføj tekstafsnit, Fjern,
 * Flyt op and Flyt ned each submit the whole list as it is currently typed, so a
 * person who edited two sections and then moved a third keeps all three changes — and
 * none of them is an immediate change to the hjemmeside, so Fjern needs no Fortryd
 * and no confirmation.
 *
 * WHAT THE BROWSER IS AND IS NOT ALLOWED TO SAY
 *
 * It says: which version it loaded, the headings and texts by position, and which
 * button it pressed. The section **ids** are the server's own — the document it just
 * read, drafts applied — and a submission whose length does not match that list is
 * refused rather than guessed at (the version token would refuse the write anyway).
 * `saveEntityDraft` then re-parses the finished list against the strict section
 * schema, which is the second, independent statement of the same rules.
 */
export async function editTakeawaySections(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', takeawayHref({ status: RATE_LIMIT_STATUS }))

  const target = draftTargetSchema.safeParse({
    entity: 'page:takeaway',
    expectedUpdatedAt: formData.get(TAKEAWAY_SECTIONS_FORM.version),
  })
  if (!target.success) redirect(takeawayHref({ status: 'ugyldig' }))

  const form = readTakeawaySectionsForm(formData)
  if (form.edit === null) redirect(takeawayHref({ status: 'ugyldig', focus: CARD_ANCHOR.sections }))

  const page = await readAdminTakeawayPage()
  if (page === null) redirect(takeawayHref({ status: 'not_found' }))

  // The list the *server* holds, drafts applied — never one a browser sent.
  const edited = applyTakeawaySectionsEdit(page.current.sections, {
    headings: form.headings,
    bodies: form.bodies,
    edit: form.edit,
  })

  if (!edited.ok) {
    // A stale or forged position: there is nothing to show beneath a field, so this
    // is the same plain refusal a malformed submission gets.
    if (edited.issues === null) {
      redirect(takeawayHref({ status: 'ugyldig', focus: CARD_ANCHOR.sections }))
    }

    redirect(
      takeawayHref(
        { status: 'ugyldig', focus: CARD_ANCHOR.sections },
        encodeTakeawaySectionsEcho(edited.sections, edited.issues),
      ),
    )
  }

  const write = takeawaySectionsWrite(edited.sections, page.live.sections)

  const result = await saveEntityDraft(profile, {
    entity: 'page:takeaway',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  if (result.status !== 'saved') {
    redirect(takeawayHref({ status: result.status, focus: CARD_ANCHOR.sections }))
  }

  // Tilføj comes back to the new section, so it can be written straight away; every
  // other press comes back to the card.
  const focus =
    form.edit.kind === 'add' ? sectionAnchor(edited.sections.length - 1) : CARD_ANCHOR.sections

  const status =
    form.edit.kind === 'add'
      ? 'afsnit_tilfoejet'
      : form.edit.kind === 'remove'
        ? 'afsnit_fjernet'
        : form.edit.kind === 'move'
          ? 'afsnit_flyttet'
          : write.clear.length > 0
            ? 'uaendret'
            : 'gemt'

  redirect(takeawayHref({ status, focus }))
}
