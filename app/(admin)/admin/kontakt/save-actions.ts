'use server'

import { redirect } from 'next/navigation'

import { requireOwner } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { contactDraftWrite, toContactSubmission } from '@/lib/contact/editor'
import { readAdminContact } from '@/lib/content/contact-admin'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import { CONTACT_FORM, encodeContactEcho, readContactForm } from './forms'
import { contactHref } from './routes'

/**
 * Gem on Kontaktoplysninger — design 1v; technical plan §4, §5, §6.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking        — requireOwner()
 *   2. parse the target               — draftTargetSchema (entity + version token)
 *   3. read the server's own row      — lib/content/contact-admin.ts
 *   4. check each field               — lib/contact/editor.ts, the schema's own rules
 *   5. reduce it to what changed      — lib/contact/editor.ts (§4, per field)
 *   6. write the draft                — lib/publishing/drafts.ts
 *   7. report                         — a redirect back to the card
 *
 * **`requireOwner()`, not `requireStaff()`.** §5's matrix puts *"Site contact
 * information"* in the Owner column and only there, and this is the action a forged
 * POST would aim at, so the guard is the first statement in it. It is the first of
 * three independent refusals: `saveEntityDraft` re-checks the same matrix row through
 * `mayChangeEntity`, and RLS re-checks it a third time in the database, where
 * `site_contact_update_owner` admits the row to `public.is_owner()` alone. A Staff
 * session is refused by all three, and no SECURITY DEFINER function is involved.
 *
 * **Nothing here writes to the public site**, and nothing here expires a cache tag. A
 * draft is a draft: the live columns are untouched, so every phone link, the address,
 * the footer and Find os are byte-identical until somebody presses Offentliggør.
 *
 * `merge` plus an explicit `clear`, never `replace`: the save names the seven fields
 * it owns and clears those of them that no longer differ from the live row; anything
 * else a stored draft holds is not mentioned in either direction.
 */
export async function saveContactDraft(formData: FormData): Promise<void> {
  const profile = await requireOwner()
  await enforceRateLimit('content:save', contactHref({ status: RATE_LIMIT_STATUS }))

  const target = draftTargetSchema.safeParse({
    entity: 'site_contact',
    expectedUpdatedAt: formData.get(CONTACT_FORM.version),
  })
  if (!target.success) redirect(contactHref({ status: 'ugyldig', focus: true }))

  const contact = await readAdminContact()
  if (contact === null) redirect(contactHref({ status: 'not_found' }))

  const form = readContactForm(formData)
  const submission = toContactSubmission(form)

  if (!submission.ok) {
    redirect(contactHref({ status: 'ugyldig', focus: true }, encodeContactEcho(form, submission.issues)))
  }

  // The delta is measured against the **live** row, not against what the form was
  // rendered with, so a field edited back to what the hjemmeside already says stops
  // being a pending change (§4).
  const write = contactDraftWrite(submission.values, contact.live)

  const result = await saveEntityDraft(profile, {
    entity: 'site_contact',
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  redirect(
    contactHref({
      focus: true,
      status:
        result.status === 'saved'
          ? Object.keys(write.values).length === 0
            ? 'uaendret'
            : 'gemt'
          : result.status,
    }),
  )
}
