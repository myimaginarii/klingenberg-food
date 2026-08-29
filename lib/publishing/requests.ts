import { z } from 'zod'

import { entityKeySchema, type EntityKey } from './entities'

/**
 * Everything a browser may submit to the publishing machinery — technical plan §8.
 *
 * One module, so the whole "never trust the browser" surface can be reviewed in one
 * sitting. Nothing here reads a database, checks a permission or performs an action:
 * it is the parsing layer and only that. If a value is not described here, no Server
 * Action accepts it.
 *
 * Three shapes, and what each one is allowed to decide:
 *
 *   * an **entity name** selects a row of the registry, and nothing else. It can never
 *     become a table name, a column name or a function name (`entityKeySchema`).
 *   * an **id** is a uuid used as a filter value. It identifies which pending change
 *     is meant, and the server then re-reads that change from `pending_changes` and
 *     works from what it found there.
 *   * a **version token** is the `updated_at` the editor loaded. A wrong one causes a
 *     refusal, never a wrong write (§6).
 *
 * The checkbox encoding lives here too, so the form that writes a value and the action
 * that reads one cannot drift apart.
 */

export type PublishRequest = {
  readonly entity: EntityKey
  readonly entityId: string
  /** The `updated_at` the editor was looking at. The concurrency token (§6). */
  readonly expectedUpdatedAt: string
}

export const publishRequestSchema = z.strictObject({
  entity: entityKeySchema,
  entityId: z.uuid({ error: 'Ugyldig reference.' }),
  expectedUpdatedAt: z.iso.datetime({ offset: true, error: 'Ugyldigt tidsstempel.' }),
})

/**
 * The identifying half of a draft save.
 *
 * `entityId` is optional because most of the entities a form edits are singletons or
 * fixed keyed rows: the server finds them from the registry, so the browser never names
 * them at all.
 */
export const draftTargetSchema = z.strictObject({
  entity: entityKeySchema,
  entityId: z.uuid({ error: 'Ugyldig reference.' }).optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true, error: 'Ugyldigt tidsstempel.' }),
})

/** The name of the dashboard's checkbox field. */
export const PUBLISH_SELECTION_FIELD = 'aendring'

const SELECTION_SEPARATOR = '|'

/** One checkbox value: entity, id and the version the dashboard was rendered from. */
export function encodePublishSelection(selection: PublishRequest): string {
  return [selection.entity, selection.entityId, selection.expectedUpdatedAt].join(
    SELECTION_SEPARATOR,
  )
}

/**
 * The same value, parsed. Anything that does not parse is dropped, never guessed at.
 *
 * The segment count is checked before the parse, so a value carrying a fourth segment
 * is refused rather than silently truncated to the first three.
 */
export function decodePublishSelection(value: unknown): PublishRequest | null {
  if (typeof value !== 'string') return null

  const segments = value.split(SELECTION_SEPARATOR)
  if (segments.length !== 3) return null

  const [entity, entityId, expectedUpdatedAt] = segments
  const parsed = publishRequestSchema.safeParse({ entity, entityId, expectedUpdatedAt })

  return parsed.success ? parsed.data : null
}
