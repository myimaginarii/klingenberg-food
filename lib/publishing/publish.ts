import 'server-only'

import { z } from 'zod'

import type { CacheTag } from '@/lib/cache/tags'
import type { Profile } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { mayChangeEntity } from './authorize'
import { publishableEntity, type EntityKey } from './entities'
import { findPendingChange, type PendingChange } from './pending'
import type { PublishRequest } from './requests'

/**
 * Publishing — technical plan §6.
 *
 * One entity at a time, and each one the same eight steps the phase brief lists:
 *
 *   1. require the correct role                     — mayChangeEntity(), per item
 *   2. validate the existing draft                  — the entity's Zod schema
 *   3. check optimistic concurrency                 — inside the database function
 *   4. capture the previous live values             — inside the database function
 *   5. merge the draft into the approved fields     — inside the database function
 *   6. clear the draft                              — inside the database function
 *   7. write audit_log with actor and before/after  — inside the database function
 *   8. complete steps 3–7 atomically                — one function call, one transaction
 *
 * Step 9 in the brief — invalidating the public cache only after the transaction
 * succeeded — is deliberately **not** here. This module returns a result; the Server
 * Action decides what to do with it, and expires cache tags only for the entities
 * whose result says `published`. Keeping the two apart is what makes "the cache is
 * never told about a publish that did not happen" checkable by reading one short
 * function instead of trusting this one.
 *
 * Nothing in this module formats a message, redirects, or touches a form. It is given
 * a profile and a parsed request, and it answers.
 */

/** The outcome vocabulary. `published` is the only one that changed anything. */
export type PublishStatus =
  /** Live, draft cleared, audit row written. */
  | 'published'
  /** Somebody else saved a newer version first (§6). Nothing was changed. */
  | 'conflict'
  /** There was no draft left to publish — usually already published in another tab. */
  | 'nothing_to_publish'
  /** No such pending change, or the caller may not see it. */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller this entity (§5). */
  | 'forbidden'
  /** The stored draft no longer satisfies its schema and was not applied. */
  | 'invalid_draft'
  /** The database refused the merge — a constraint, or an unavailable database. */
  | 'failed'

export type PublishResult = {
  readonly entity: EntityKey
  readonly entityId: string
  /** "Ret", "Forsiden" — the entity's name in the administration. */
  readonly label: string
  /** The row's own name, when it has one. */
  readonly subject: string | null
  readonly status: PublishStatus
  /** The tags to expire — empty unless the status is `published`. */
  readonly cacheTags: readonly CacheTag[]
}

/**
 * The database function's reply. Anything else is treated as a failure.
 *
 * `invalid_draft` is in the set because one publish function can decide it: an
 * announcement's expiry has to be *in the future*, and "in the future" is not something
 * a CHECK constraint can express, so `publish_announcement()` checks it at the moment of
 * the merge and refuses (§7c, 1ac's "Udløb er påkrævet"). It is the same status this
 * module already produces when a **stored draft** no longer parses, and it means the
 * same thing to a caller — nothing was written, and the draft is still there — so it
 * reuses the word rather than inventing a second one for the same outcome. Every other
 * publish function simply never returns it.
 */
const rpcResultSchema = z.object({
  status: z.enum([
    'published',
    'conflict',
    'nothing_to_publish',
    'not_found',
    'forbidden',
    'invalid_draft',
  ]),
})

function outcome(
  change: Pick<PendingChange, 'entity' | 'entityId' | 'label' | 'subject'>,
  status: PublishStatus,
  cacheTags: readonly CacheTag[] = [],
): PublishResult {
  return { ...change, status, cacheTags }
}

/**
 * Re-read the stored draft and check it still satisfies its schema.
 *
 * A draft can outlive the schema that produced it — a field is removed, a limit is
 * tightened, an older tab posts an older shape. Publishing it unchecked would put
 * content live that no current editor could have produced, so a draft that no longer
 * parses is refused here rather than merged by the database.
 *
 * The table name comes from the registry, never from the request.
 */
async function storedDraftIsValid(entity: EntityKey, entityId: string): Promise<boolean> {
  const draft = publishableEntity(entity).draft
  // News and one-off overrides are pending through `status`, not a draft column (§4).
  if (draft === null) return true

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from(draft.table)
    .select('draft')
    .eq('id', entityId)
    .maybeSingle<{ draft: unknown }>()

  if (error || data === null) return false

  return draft.spec.stored.safeParse(data.draft).success
}

/**
 * Publish one pending change.
 *
 * The `entity` in the request is used only to *find* the pending change. Everything
 * after that — the role required, the schema, the database function, the cache tags —
 * is read from the registry against the entity the server resolved, so a browser that
 * mislabels an id gains nothing.
 */
export async function publishPendingChange(
  profile: Profile,
  request: PublishRequest,
): Promise<PublishResult> {
  const change = await findPendingChange(request.entity, request.entityId)

  if (change === null) {
    return outcome(
      {
        entity: request.entity,
        entityId: request.entityId,
        label: publishableEntity(request.entity).label,
        subject: null,
      },
      'not_found',
    )
  }

  // Re-authorized individually, per item, against the server's own view of what this
  // item is. A checkbox in a submitted list is a request, not a permission.
  if (!mayChangeEntity(change.entity, profile)) {
    return outcome(change, 'forbidden')
  }

  if (!(await storedDraftIsValid(change.entity, change.entityId))) {
    return outcome(change, 'invalid_draft')
  }

  const entity = publishableEntity(change.entity)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc(entity.publishFunction, {
    p_id: change.entityId,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    // A constraint the merge would have violated, or an unreachable database. Either
    // way the transaction rolled back: live content, the draft and the audit log are
    // all as they were. The message is for the server log, never for the browser.
    console.error(`Publish failed for ${change.entity} ${change.entityId}: ${error.message}`)
    return outcome(change, 'failed')
  }

  const parsed = rpcResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error(`Unexpected publish result for ${change.entity} ${change.entityId}.`)
    return outcome(change, 'failed')
  }

  return outcome(
    change,
    parsed.data.status,
    parsed.data.status === 'published' ? entity.cacheTags : [],
  )
}

/**
 * Publish several pending changes.
 *
 * Sequentially, and each in its own transaction. One item failing must not undo the
 * others: the design's confirmation sheet already lets a person leave somebody else's
 * work out of a publish, so "all or nothing across unrelated entities" would be the
 * wrong promise. Each entity is individually atomic, which is the promise §6 makes.
 */
export async function publishPendingChanges(
  profile: Profile,
  requests: readonly PublishRequest[],
): Promise<PublishResult[]> {
  const results: PublishResult[] = []

  for (const request of requests) {
    results.push(await publishPendingChange(profile, request))
  }

  return results
}

/** The tags to expire for a completed batch: the published items and nothing else. */
export function tagsToExpire(results: readonly PublishResult[]): CacheTag[] {
  return results.flatMap((result) => [...result.cacheTags])
}
