import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import { isPlainObject, mergeDraftValues } from '@/lib/drafts/overlay'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { mayChangeEntity } from './authorize'
import { publishableEntity, type EntityKey } from './entities'
import { applyEntityFilter, locateEntityRow } from './locate'

/**
 * Writing a draft — technical plan §6.
 *
 * Editing writes to `draft`. Live columns are untouched, so the public site is
 * byte-identical to before, until somebody presses Offentliggør. This module is the
 * only path a draft is written by, which is where three guarantees come from:
 *
 *   * **A strict allow-list, not a merge of whatever arrived.** The submitted values
 *     are parsed by the entity's *strict* schema first, so an unknown key is a refusal
 *     rather than something to ignore. Then only the fields `spec.fields` names are
 *     carried across. Nothing is spread into a database update — not the form, not the
 *     parsed object, not the existing draft.
 *   * **The role matrix, before the database sees anything.** RLS refuses the same
 *     write again through the caller's JWT, but a staff member editing Forsiden should
 *     be told so, not left to interpret a silent no-op.
 *   * **Optimistic concurrency on every save (§6).** The version the editor loaded is
 *     part of the UPDATE's WHERE clause, so two people who both started from version A
 *     cannot both save: the second is told "Nogen andre har rettet dette." rather than
 *     quietly overwriting the first.
 *
 * The new draft is merged into the existing one rather than replacing it, using the
 * same `mergeDraftValues` the preview overlay uses. Editing a heading on Monday and a
 * price on Tuesday leaves one draft carrying both.
 */

export type SaveDraftStatus =
  /** Written. `updatedAt` carries the new version token. */
  | 'saved'
  /** Somebody else saved first. Nothing was written (§6). */
  | 'conflict'
  /** The role matrix, or RLS, refused this caller this entity (§5). */
  | 'forbidden'
  /** The submitted values did not satisfy the entity's schema. */
  | 'invalid'
  /** No such row, or the caller may not see it. */
  | 'not_found'
  /** The database refused the write. */
  | 'failed'

export type SaveDraftResult = {
  readonly status: SaveDraftStatus
  /** The new version token, present only when the status is `saved`. */
  readonly updatedAt: string | null
  /** Danish messages from the schema, ready to show. Empty unless `invalid`. */
  readonly messages: readonly string[]
}

export type SaveDraftRequest = {
  readonly entity: EntityKey
  /** Required only for entities the registry marks `many`; the rest locate themselves. */
  readonly entityId?: string
  /** The `updated_at` the editor loaded. The concurrency token (§6). */
  readonly expectedUpdatedAt: string
  /** Raw, unvalidated values. Parsed here and never used before that. */
  readonly values: unknown
}

function refusal(status: SaveDraftStatus, messages: readonly string[] = []): SaveDraftResult {
  return { status, updatedAt: null, messages }
}

/**
 * The schema's own Danish messages, deduplicated.
 *
 * Every primitive in `lib/schemas/primitives.ts` names its field in the message
 * ("Overskriften må højst være 120 tegn."), so an issue is already a sentence a person
 * can act on and no path needs to be shown alongside it.
 */
function messagesFor(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.message))]
}

export async function saveEntityDraft(
  profile: Profile,
  request: SaveDraftRequest,
): Promise<SaveDraftResult> {
  const draft = publishableEntity(request.entity).draft
  const location = locateEntityRow(request.entity, request.entityId)

  if (draft === null || location === null) {
    // News and one-off overrides carry no draft column: they are edited in place and
    // published by status (§4). Their editors are phases 8 and 9.
    return refusal('failed')
  }

  if (!mayChangeEntity(request.entity, profile)) {
    return refusal('forbidden')
  }

  const parsed = draft.spec.input.safeParse(request.values)
  if (!parsed.success) {
    return refusal('invalid', messagesFor(parsed.error))
  }

  const supabase = await createSupabaseServerClient()

  const current = await applyEntityFilter(
    supabase.from(location.table).select('draft'),
    location,
  ).maybeSingle<{ draft: unknown }>()

  if (current.error) return refusal('failed')
  if (current.data === null) return refusal('not_found')

  const existing = isPlainObject(current.data.draft) ? current.data.draft : {}

  const { row: nextDraft } = mergeDraftValues(
    existing,
    parsed.data as Record<string, unknown>,
    draft.spec,
  )

  // The version check is part of the write, not a separate read before it, so two
  // saves that both started from the same version cannot both succeed.
  const written = await applyEntityFilter(
    supabase.from(location.table).update({ draft: nextDraft }),
    location,
  )
    .eq('updated_at', request.expectedUpdatedAt)
    .select('updated_at')
    .maybeSingle<{ updated_at: string }>()

  if (written.error) return refusal('failed')

  if (written.data === null) {
    // Nothing was written. Either the row moved on (somebody else saved first) or RLS
    // refused this caller. The probe tells them apart so the person gets the right
    // sentence rather than a generic failure.
    const probe = await applyEntityFilter(
      supabase.from(location.table).select('updated_at'),
      location,
    )
      .eq('updated_at', request.expectedUpdatedAt)
      .maybeSingle<{ updated_at: string }>()

    return refusal(probe.data === null ? 'conflict' : 'forbidden')
  }

  return { status: 'saved', updatedAt: written.data.updated_at, messages: [] }
}
