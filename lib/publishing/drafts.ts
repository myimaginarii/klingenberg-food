import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import { isPlainObject, nextDraftValues } from '@/lib/drafts/overlay'
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
 *
 * TWO KINDS OF EDITOR, AND WHY `mode` EXISTS
 *
 * Merging is right for a **partial** editor — a form that owns some of an entity's
 * fields and says nothing about the rest. Every phase-4 content form is one of those.
 *
 * It is wrong for a **whole-entity** editor: one that renders every editable field an
 * entity has and submits all of them, already reduced to the ones that differ from the
 * live values. Merging such a submission would keep a field the person had just changed
 * back — they would revert a price, save, and the old draft price would still be there,
 * invisible in the form and live on the next publish. `mode: 'replace'` says "these
 * values *are* the draft".
 *
 * The distinction is a claim about an editor, and a claim that can stop being true. The
 * menu's dish panel (1r) was a whole-entity editor until phase 5E gave `sort_order` an
 * editor of its own; `replace` then meant the panel silently discarded a pending
 * reorder. It now uses `merge` with an explicit `clear` naming the six fields it
 * actually owns, which is the honest way to say the same thing for a *partial* editor.
 * Before reaching for `replace`, check that the entity has no other editor — and
 * remember that it may acquire one later.
 *
 * A draft that ends up with no fields at all is written as `null` rather than as `{}`.
 * An empty object is not "no pending change" to anything that reads `draft is not null`
 * — the `pending_changes` view, the Kladde badge, the dashboard count — so an entity
 * whose edits have all been reverted stops being pending, as it should.
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
  /**
   * `merge` (the default) adds these values to any existing draft; `replace` makes them
   * the whole draft. Use `replace` only from an editor that submits the entity's every
   * editable field — see the note above.
   */
  readonly mode?: 'merge' | 'replace'
  /**
   * Fields to **remove** from the existing draft, applied after the merge.
   *
   * `replace` mode gets "a value changed back to what is live must leave the draft" for
   * free, because it discards the old draft wholesale. A partial editor cannot: merging
   * can add a field and change one, but it has no way to say *take this one out again*.
   *
   * Phase 5E is the first editor that needs to. Moving a dish down and then back up
   * leaves its position identical to the published one, so `sort_order` is no longer a
   * pending change — and a draft that kept it would put a Kladde badge on a row with
   * nothing waiting, and make Offentliggør claim a change it will not make. §4 says a
   * draft holds "only the changed fields"; this is how a partial editor keeps that
   * literally true.
   *
   * A name outside the entity's `spec.fields` is ignored, exactly as it is on the way
   * in — this widens what a draft may *contain* by nothing at all.
   */
  readonly clear?: readonly string[]
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

  const existing: Record<string, unknown> =
    request.mode === 'replace' || !isPlainObject(current.data.draft) ? {} : current.data.draft

  // Merge, then remove what `clear` names, then reduce an empty draft to `null`. All
  // three rules live in `lib/drafts/overlay.ts` beside the merge the preview uses, so
  // they are pure, tested directly, and identical wherever a draft is composed.
  const nextDraft = nextDraftValues(
    existing,
    parsed.data as Record<string, unknown>,
    draft.spec,
    request.clear,
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
