'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import {
  publishPendingChanges,
  tagsToExpire,
  type PublishResult,
} from '@/lib/publishing/publish'
import {
  decodePublishSelection,
  PUBLISH_SELECTION_FIELD,
  type PublishRequest,
} from '@/lib/publishing/requests'

/**
 * Offentliggør — technical plan §6.
 *
 * The Server Action is deliberately thin, and its whole job is ordering:
 *
 *   1. establish who is asking          — requireStaff()
 *   2. parse what they asked for        — decodePublishSelection(), per checkbox
 *   3. do the work                      — lib/publishing/publish.ts
 *   4. **then** expire the cache        — only for the items that actually published
 *   5. report                           — a redirect back to the dashboard
 *
 * Step 4 after step 3, never beside it. A cache expired for a publish that failed
 * would show visitors a freshly-rendered page identical to the old one while the
 * dashboard reported an error — the cache telling a story the database does not agree
 * with. `tagsToExpire()` reads the results and returns tags only for the entities whose
 * status is `published`, so the ordering is enforced by the data rather than by
 * remembering to write the lines in the right order.
 *
 * `requireStaff()` establishes a session; it does not authorize any of the items. Each
 * selected item is re-authorized individually inside `publishPendingChange`, against
 * the entity the server resolved from `pending_changes` rather than the entity name the
 * form carried. A checkbox is a request, not a permission.
 *
 * No validation, authorization, SQL or merge logic lives in this file. It is a form
 * handler.
 */

/** `?published=2&conflict=1&…` — one count per outcome, for the dashboard to word. */
function resultQuery(results: readonly PublishResult[]): string {
  const counts = new Map<string, number>()
  for (const result of results) {
    counts.set(result.status, (counts.get(result.status) ?? 0) + 1)
  }

  const parameters = new URLSearchParams()
  for (const [status, count] of counts) {
    parameters.set(status, String(count))
  }

  return parameters.toString()
}

export async function publishSelectedChanges(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const requests = formData
    .getAll(PUBLISH_SELECTION_FIELD)
    .map(decodePublishSelection)
    .filter((request): request is PublishRequest => request !== null)

  if (requests.length === 0) {
    redirect('/admin?intet_valgt=1')
  }

  const results = await publishPendingChanges(profile, requests)

  // Only now, and only for what actually went live.
  expirePublicCacheTags(tagsToExpire(results))

  redirect(`/admin?${resultQuery(results)}`)
}
