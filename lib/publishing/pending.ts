import 'server-only'

import { cache } from 'react'

import { createSupabaseServerClient } from '@/lib/supabase/server'

import { isEntityKey, publishableEntity, type EntityKey } from './entities'

/**
 * What is waiting to be published — technical plan §4, §6.
 *
 * Reads `public.pending_changes`, the `security_invoker` view that derives the list
 * from `draft is not null`, `news.status` and `overrides.status`. There is no queue
 * table to fall out of step with the rows it describes.
 *
 * The view is read through the caller's own JWT, so RLS decides which rows come back
 * and the application never has to remember to filter. It returns metadata only —
 * entity, id, the row's own name, state, when and by whom — and no draft content, so
 * listing a pending change cannot leak the change itself.
 *
 * `requiresOwner` comes from the registry rather than from the view, because the
 * permission matrix is application knowledge and belongs in one place (§5). The
 * dashboard uses it to mark an item a staff member cannot publish; the server uses
 * `mayPublish()` to actually refuse it.
 */

export type PendingState = 'draft' | 'unpublished'

export type PendingChange = {
  readonly entity: EntityKey
  readonly entityId: string
  /** The entity's name in the administration, e.g. "Ret". */
  readonly label: string
  /** The row's own name — a dish name, an article title — or null for a singleton. */
  readonly subject: string | null
  readonly state: PendingState
  /** The version this listing was built from. Sent back with a publish (§6). */
  readonly updatedAt: string
  readonly editorName: string | null
  readonly requiresOwner: boolean
}

type PendingRow = {
  entity: string
  entity_id: string
  subject: string | null
  state: string
  updated_at: string
  editor_name: string | null
}

function toPendingChange(row: PendingRow): PendingChange | null {
  // An entity the application does not know is dropped rather than rendered. The view
  // and the registry are written together, so this only fires if one is ahead of the
  // other during a deployment — in which case showing an unpublishable row would be
  // worse than showing none.
  if (!isEntityKey(row.entity)) return null

  const state: PendingState = row.state === 'unpublished' ? 'unpublished' : 'draft'
  const entity = publishableEntity(row.entity)

  return {
    entity: row.entity,
    entityId: row.entity_id,
    label: entity.label,
    subject: row.subject,
    state,
    updatedAt: row.updated_at,
    editorName: row.editor_name,
    requiresOwner: entity.requiredRole === 'owner',
  }
}

/**
 * Everything pending, most recently edited first.
 *
 * Deduplicated for the length of one request with React's `cache`: publishing a list of
 * five items looks each one up (see `findPendingChange`), and those five lookups should
 * cost one query between them rather than five. Publishing an item does not change
 * whether any *other* item is pending, so one read is also the correct answer.
 */
export const readPendingChanges = cache(async (): Promise<PendingChange[]> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('pending_changes')
    .select('entity, entity_id, subject, state, updated_at, editor_name')
    .order('updated_at', { ascending: false })
    .returns<PendingRow[]>()

  if (error) {
    throw new Error(`Could not read the pending changes: ${error.message}`)
  }

  return (data ?? [])
    .map(toPendingChange)
    .filter((change): change is PendingChange => change !== null)
})

/**
 * One pending change by entity and id, or null.
 *
 * This is how a publish request stops being something the browser said. The action
 * receives an entity name and an id; it looks them up here, and everything it does
 * afterwards — the role check, the schema, the database function, the cache tags —
 * comes from the row the *server* found, not from the form. A forged pair simply is
 * not found.
 */
export async function findPendingChange(
  entity: EntityKey,
  entityId: string,
): Promise<PendingChange | null> {
  const pending = await readPendingChanges()

  return pending.find((item) => item.entity === entity && item.entityId === entityId) ?? null
}
