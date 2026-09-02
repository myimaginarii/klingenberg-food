'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { readAdminTakeawayPage } from '@/lib/content/takeaway-admin'
import { takeawayCtaWrite, takeawayTextWrite, toTakeawayCta, toTakeawayText } from '@/lib/pages/takeaway'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import {
  encodeTakeawayCtaEcho,
  encodeTakeawayTextEcho,
  readTakeawayCtaForm,
  readTakeawayTextForm,
  TAKEAWAY_CTA_FORM,
  TAKEAWAY_TEXT_FORM,
} from './forms'
import { CARD_ANCHOR, takeawayHref } from './routes'

/**
 * Gem on the "Tekst" and "Knap nederst" cards — design 1aj, technical plan §4, §5, §6.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking        — requireStaff() (§5: Staff and Owner alike)
 *   2. parse the target               — draftTargetSchema (entity + version token)
 *   3. read the server's own row      — lib/content/takeaway-admin.ts
 *   4. map the form to values         — lib/pages/takeaway.ts
 *   5. reduce it to what changed      — lib/pages/takeaway.ts (§4, per key)
 *   6. write the draft                — lib/publishing/drafts.ts
 *   7. report                         — a redirect back to the card
 *
 * `requireStaff()` is the first of three independent refusals: `saveEntityDraft`
 * re-checks the same matrix row through `mayChangeEntity`, and RLS re-checks it a
 * third time in the database (`pages_update_scoped` admits the `takeaway` row to
 * `public.is_staff()`). No SECURITY DEFINER function is involved at any point.
 *
 * **Nothing here writes to the public site**, and nothing here expires a cache tag. A
 * draft is a draft: `published` is untouched, so the page is byte-identical until
 * somebody presses Offentliggør (`./publish-actions.ts`).
 *
 * EACH CARD NAMES ITS OWN KEYS, AND ONLY THOSE. The draft holds top-level keys, so the
 * text card's save is `merge` with a `clear` for whichever of its two keys no longer
 * differs from the published document — and it says nothing about the sections, the
 * image, the button or the switch, so a Gem here can neither wipe nor publish a
 * pending change elsewhere on the screen.
 */
export async function saveTakeawayText(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const target = draftTargetSchema.safeParse({
    entity: 'page:takeaway',
    expectedUpdatedAt: formData.get(TAKEAWAY_TEXT_FORM.version),
  })
  if (!target.success) redirect(takeawayHref({ status: 'ugyldig' }))

  const page = await readAdminTakeawayPage()
  if (page === null) redirect(takeawayHref({ status: 'not_found' }))

  const form = readTakeawayTextForm(formData)
  const submission = toTakeawayText(form)

  if (!submission.ok) {
    redirect(
      takeawayHref(
        { status: 'ugyldig', focus: CARD_ANCHOR.text },
        encodeTakeawayTextEcho(form, submission.issues),
      ),
    )
  }

  // The delta is measured against the **published** values, not against what the
  // form was rendered with, so a field edited back to what the hjemmeside already
  // says stops being a pending change (§4).
  const write = takeawayTextWrite(submission.values, page.live)

  const result = await saveEntityDraft(profile, {
    entity: 'page:takeaway',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    takeawayHref({
      focus: CARD_ANCHOR.text,
      status:
        result.status === 'saved'
          ? Object.keys(write.values).length === 0
            ? 'uaendret'
            : 'gemt'
          : result.status,
    }),
  )
}

export async function saveTakeawayCta(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const target = draftTargetSchema.safeParse({
    entity: 'page:takeaway',
    expectedUpdatedAt: formData.get(TAKEAWAY_CTA_FORM.version),
  })
  if (!target.success) redirect(takeawayHref({ status: 'ugyldig' }))

  const page = await readAdminTakeawayPage()
  if (page === null) redirect(takeawayHref({ status: 'not_found' }))

  const typed = readTakeawayCtaForm(formData)
  const submission = toTakeawayCta(typed)

  if (!submission.ok) {
    redirect(takeawayHref({ status: 'ugyldig', focus: CARD_ANCHOR.cta }, encodeTakeawayCtaEcho(typed)))
  }

  const write = takeawayCtaWrite(submission.value, page.live.cta_label)

  const result = await saveEntityDraft(profile, {
    entity: 'page:takeaway',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    takeawayHref({
      focus: CARD_ANCHOR.cta,
      status:
        result.status === 'saved' ? (write.clear.length > 0 ? 'uaendret' : 'gemt') : result.status,
    }),
  )
}
