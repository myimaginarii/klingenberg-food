'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { draftTargetSchema } from '@/lib/publishing/requests'

import { contentEditorFor } from './editors'

/**
 * Gem kladde — technical plan §6.
 *
 * Thin on purpose. The action establishes the session, parses the target, hands the
 * form to the editor definition that knows how to read it, and reports. Validation,
 * authorization, the merge and the write all live in `lib/publishing/drafts.ts`.
 *
 * **Nothing here writes to the public site.** A draft is a draft: live columns are
 * untouched, so the public page is byte-identical to what it was before this ran.
 * There is therefore no cache tag to expire either — the only thing that expires a
 * public cache tag in this phase is a successful publish.
 *
 * The version the form loaded travels back in the hidden `version` field and becomes
 * the concurrency token (§6). Two people who both opened the same form cannot both
 * save: the second is told "Nogen andre har rettet dette."
 */
export async function saveContentDraft(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('content:save', `/admin/indhold?status=${RATE_LIMIT_STATUS}`)

  const target = draftTargetSchema.safeParse({
    entity: formData.get('entity'),
    expectedUpdatedAt: formData.get('version'),
  })

  if (!target.success) {
    redirect('/admin/indhold?status=ugyldig')
  }

  // The entity name decides which editor reads the form, and the registry decides what
  // that entity is. An entity outside the registry never gets this far.
  const editor = contentEditorFor(target.data.entity)
  if (editor === null) {
    redirect('/admin/indhold?status=ugyldig')
  }

  const result = await saveEntityDraft(profile, {
    entity: target.data.entity,
    expectedUpdatedAt: target.data.expectedUpdatedAt,
    values: editor.toDraftValues(formData),
  })

  const report = new URLSearchParams({ status: result.status, felt: target.data.entity })
  const firstMessage = result.messages[0]
  if (firstMessage !== undefined) report.set('besked', firstMessage)

  redirect(`/admin/indhold?${report.toString()}#${target.data.entity}`)
}
