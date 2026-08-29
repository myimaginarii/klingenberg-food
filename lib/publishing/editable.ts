import 'server-only'

import { isPlainObject, overlayDraft } from '@/lib/drafts/overlay'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { publishableEntity, type EntityKey } from './entities'
import { applyEntityFilter, locateEntityRow } from './locate'

/**
 * What an editor loads — technical plan §6.
 *
 * An admin form has to show the values the staff member is about to change, which is
 * the live row with any existing draft already merged over it. That is the same
 * question the preview asks, answered with the same `overlayDraft`, so an editor and a
 * preview can never disagree about what the draft currently says.
 *
 * It also returns `updatedAt`, which the form carries as a hidden field and hands back
 * on save. That is the whole of optimistic concurrency (§6): the version a person
 * started from travels with their edit, and the save refuses if the row moved on.
 *
 * The values are reduced to `spec.fields`, so a form can only ever be populated with —
 * and therefore only ever submit — fields the entity's schema allows. Timestamps,
 * `updated_by`, `sold_out_on`, `is_new_draft` and the rest of the row never reach it.
 *
 * The public read layer is deliberately not reused here. It maps rows down to the
 * domain types the *site* renders, in camelCase, with display decisions already made;
 * an editor needs the raw editable fields in database casing, because that is what it
 * writes back. Two different questions, two different reads, one shared merge.
 */

export type EditableEntity = {
  readonly entity: EntityKey
  readonly entityId: string
  /** The version token the form submits back with the save (§6). */
  readonly updatedAt: string
  /** Live values with the draft merged over them, limited to the editable fields. */
  readonly values: Record<string, unknown>
  readonly hasDraft: boolean
  /** True when a stored draft failed its schema and was therefore not applied. */
  readonly draftMalformed: boolean
}

type EntityRow = Record<string, unknown> & { id: string; updated_at: string; draft: unknown }

/**
 * Load one entity for editing.
 *
 * `entityId` is required only for entities whose instance kind is `many`; the registry
 * finds the rest on its own. Nothing about the query is built from a request: the
 * table, the key column and the key value are all registry literals.
 */
export async function readEditableEntity(
  entity: EntityKey,
  entityId?: string,
): Promise<EditableEntity | null> {
  const draft = publishableEntity(entity).draft
  const location = locateEntityRow(entity, entityId)

  // News and one-off overrides have no draft column; their editors (phases 8 and 9)
  // work on the row itself and publish by status.
  if (draft === null || location === null) return null

  const supabase = await createSupabaseServerClient()
  const { data, error } = await applyEntityFilter(
    supabase.from(location.table).select('*'),
    location,
  ).maybeSingle<EntityRow>()

  if (error || data === null) return null

  // For a document entity the editable values live inside one jsonb column; for a
  // column entity they are the row's own columns. The registry says which, so the
  // decision is data rather than a special case buried in an editor.
  const document =
    draft.documentColumn === undefined ? undefined : data[draft.documentColumn]

  const base: Record<string, unknown> =
    draft.shape === 'document'
      ? isPlainObject(document)
        ? document
        : {}
      : data

  const overlay = overlayDraft(base, data.draft, draft.spec)
  const merged = overlay.row as Record<string, unknown>

  const values: Record<string, unknown> = {}
  for (const field of draft.spec.fields) {
    values[field] = merged[field] ?? null
  }

  return {
    entity,
    entityId: data.id,
    updatedAt: data.updated_at,
    values,
    hasDraft: data.draft !== null && data.draft !== undefined,
    draftMalformed: overlay.malformed,
  }
}
