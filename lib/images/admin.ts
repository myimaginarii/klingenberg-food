import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'

import {
  affectedReferencesSchema,
  cacheTagsForAffectedReferences,
  cacheTagsForLiveReferences,
  cacheTagsForReferenceKind,
  isReferenceKind,
  REFERENCE_KINDS,
} from './cache-impact'
import { parseAltText } from './library'
import { mayManageImages } from './rules'
import type { ImageStorage } from './storage'

/**
 * The library's writes — design 1w; technical plan §4, §5, §6, §15, §20 (phase 10B;
 * cache coupling since 10C-2).
 *
 * A wrapper, not a mechanism, in the family of `lib/news/admin.ts`: the alt-text
 * edit is the one direct column write the 10A migration deliberately left open
 * (the grant names `alt_text` and nothing else), and the two structural
 * transitions delegate whole to the trusted database functions — `delete_image()`
 * (10A) and `replace_image()` (10B). Nothing here can reach any other column, and
 * there is no code path from this module to `create_image()` — creation belongs to
 * the finalize flow (`./finalize.ts`) and nowhere else.
 *
 * Every write:
 *   1. asks the §5 matrix first (`mayManageImages` — Staff and Owner, the same
 *      predicate the 10A flows state), so a refusal is a sentence rather than a
 *      silent zero-row update from RLS;
 *   2. goes to the database through the caller's own JWT, so RLS re-decides;
 *   3. re-checks the version token inside the write itself (§6) — a stale token is
 *      `conflict`, told apart from `not_found` honestly.
 *
 * PUBLIC CACHE COUPLING (phase 10C-2, brief §17–§22). Since the public pages render
 * every LIVE image reference, each write here changes tagged HTML, and each expires
 * exactly the tags whose output changed — computed by `./cache-impact.ts` from the
 * registry, never listed here:
 *   * a delete or a replace expires the tags of the live rows the trusted transition
 *     itself reports in `affected` (per-kind counts of the rows its own statements
 *     moved, inside the one transaction — so a reference a concurrent publish made
 *     live is counted by the statement that moved it, and a draft-only usage is not);
 *   * the alt edit has no transition (the column grant is the door), so it reads
 *     `image_references` *after* its successful write — a reference that goes live
 *     later is rendered by the publish that makes it live, which expires its own tag.
 * The expiry runs after the commit and **before** the storage cleanup, so the first
 * guest request after a replacement never meets cached HTML whose derivative URLs
 * are about to 404. Draft-only references expire nothing, and nothing is ever
 * cleared globally.
 *
 * STORAGE CLEANUP (brief §15). A deletion and a replacement both end with files to
 * remove, and the paths are never the browser's to name: the original path comes
 * back from the trusted function's own return value, and the derivative paths are
 * derived from the record the server read — both facts of the database, not of the
 * request. The database commit is authoritative; a failed file removal is logged
 * as an orphan (`storage.ts` already logs per path) and never un-deletes anything.
 * Recovery is operational: the audit row names the storage path, and every
 * derivative path derives from it, so an operator can remove leftovers by hand.
 */

/** What a write may do to the public cache — injected by the Server Action (§20). */
export type PublicCacheEffects = {
  readonly expireTags: (tags: readonly CacheTag[]) => void
}

export type AltTextStatus =
  | 'saved'
  | 'invalid'
  | 'forbidden'
  | 'conflict'
  | 'not_found'
  | 'failed'

export type SaveAltTextResult = {
  readonly status: AltTextStatus
  /** Present only for `invalid`: which alt-text rule refused. */
  readonly error?: 'for_lang' | 'ugyldig'
  /** The public tags the saved description is rendered under — empty unless `saved`. */
  readonly cacheTags: readonly CacheTag[]
}

type ReferenceRow = { kind: string; pending: boolean }

/**
 * The public tags an image's current LIVE references are rendered under, read
 * after a successful write through the caller's own JWT (see the module note).
 *
 * If that read fails the description is already saved and the cached pages are
 * already stale, so the fail-safe is bounded rather than silent: the tags of every
 * reference kind — the four entity tags, never contact, hours or a page document.
 */
async function liveReferenceTags(supabase: SupabaseClient, imageId: string): Promise<CacheTag[]> {
  const { data, error } = await supabase
    .from('image_references')
    .select('kind, pending')
    .eq('image_id', imageId)
    .returns<ReferenceRow[]>()

  if (error !== null) {
    console.error(`Reading the references of image ${imageId} failed: ${error.message}`)
    return [...new Set(REFERENCE_KINDS.flatMap((kind) => [...cacheTagsForReferenceKind(kind)]))]
  }

  return cacheTagsForLiveReferences(
    (data ?? []).flatMap((row) =>
      isReferenceKind(row.kind) ? [{ kind: row.kind, pending: row.pending === true }] : [],
    ),
  )
}

/**
 * Save one image's description. The narrow direct write §5's column grant allows:
 * an UPDATE naming `alt_text` alone, version-checked in its own WHERE. It cannot
 * move `storage_path`, dimensions, MIME, derivatives, the uploader or the id —
 * not by discipline but because the grant refuses every other column (10A §5).
 *
 * A saved description changes the rendered HTML of every live usage, so the result
 * carries the tags to expire; the Server Action expires them (§20, brief §19).
 */
export async function saveImageAltText(
  supabase: SupabaseClient,
  profile: Profile,
  request: {
    readonly imageId: string
    readonly expectedUpdatedAt: string
    readonly altText: string
  },
): Promise<SaveAltTextResult> {
  if (!mayManageImages(profile)) return { status: 'forbidden', cacheTags: [] }

  const parsed = parseAltText(request.altText)
  if (!parsed.ok) return { status: 'invalid', error: parsed.error, cacheTags: [] }

  const { data, error } = await supabase
    .from('images')
    .update({ alt_text: parsed.value })
    .eq('id', request.imageId)
    .eq('updated_at', request.expectedUpdatedAt)
    .select('id')
    .maybeSingle<{ id: string }>()

  if (error !== null) {
    console.error(`Saving alt text for image ${request.imageId} failed: ${error.message}`)
    return { status: error.code === '42501' ? 'forbidden' : 'failed', cacheTags: [] }
  }

  if (data === null) {
    // Zero rows: the version was stale, or the image is gone. Told apart honestly.
    const existing = await supabase
      .from('images')
      .select('id')
      .eq('id', request.imageId)
      .maybeSingle<{ id: string }>()

    return { status: existing.data === null ? 'not_found' : 'conflict', cacheTags: [] }
  }

  return { status: 'saved', cacheTags: await liveReferenceTags(supabase, request.imageId) }
}

export type DeleteImageStatus =
  | 'deleted'
  | 'in_use'
  | 'conflict'
  | 'not_found'
  | 'forbidden'
  | 'failed'

const deleteResultSchema = z.union([
  z.object({ status: z.enum(['not_found', 'conflict']) }),
  z.object({ status: z.literal('in_use'), references: z.number().int() }),
  z.object({
    status: z.literal('deleted'),
    references: z.number().int(),
    storage_path: z.string(),
    affected: affectedReferencesSchema,
  }),
])

export type DeleteImageResult = {
  readonly status: DeleteImageStatus
  /** How many places still use the image — present with `in_use`. */
  readonly references?: number
  /** The public tags expired — empty unless `deleted`. */
  readonly cacheTags: readonly CacheTag[]
}

/**
 * Delete one image through the one door out, expire the public tags its live
 * references were rendered under, and remove its files afterwards.
 *
 * `derivativePaths` is the trusted derivation the caller read from the row before
 * asking (`readImageStorageFacts`) — the record never changes after creation, so
 * it names exactly the files the row has always named. The original's path is
 * taken from the function's own return value; nothing about storage comes from the
 * browser (brief §15, §16). The affected reference set is the function's own too.
 */
export async function deleteLibraryImage(
  supabase: SupabaseClient,
  storage: ImageStorage,
  profile: Profile,
  request: {
    readonly imageId: string
    readonly expectedUpdatedAt: string
    readonly confirmed: boolean
    readonly derivativePaths: readonly string[]
  },
  effects: PublicCacheEffects,
): Promise<DeleteImageResult> {
  if (!mayManageImages(profile)) return { status: 'forbidden', cacheTags: [] }

  const { data, error } = await supabase.rpc('delete_image', {
    p_id: request.imageId,
    p_expected_updated_at: request.expectedUpdatedAt,
    p_confirmed: request.confirmed,
  })

  if (error) {
    console.error(`Deleting image ${request.imageId} failed: ${error.message}`)
    return { status: 'failed', cacheTags: [] }
  }

  const parsed = deleteResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error(`Unexpected delete result for image ${request.imageId}.`)
    return { status: 'failed', cacheTags: [] }
  }

  if (parsed.data.status === 'in_use') {
    return { status: 'in_use', references: parsed.data.references, cacheTags: [] }
  }
  if (parsed.data.status !== 'deleted') {
    return { status: parsed.data.status, cacheTags: [] }
  }

  // The database has committed. The public tags go first — the affected set is the
  // transition's own — and the files second; integrity depends on neither.
  const cacheTags = cacheTagsForAffectedReferences(parsed.data.affected)
  effects.expireTags(cacheTags)

  await storage.removeDerivatives(request.derivativePaths)
  await storage.removeOriginal(parsed.data.storage_path)

  return { status: 'deleted', cacheTags }
}

export type ReplaceImageStatus =
  | 'replaced'
  | 'conflict'
  | 'not_found'
  | 'invalid_replacement'
  | 'missing_replacement'
  | 'forbidden'
  | 'failed'

const replaceResultSchema = z.union([
  z.object({ status: z.enum(['not_found', 'conflict', 'invalid_replacement', 'missing_replacement']) }),
  z.object({
    status: z.literal('replaced'),
    references: z.number().int(),
    new_id: z.string(),
    storage_path: z.string(),
    affected: affectedReferencesSchema,
  }),
])

export type ReplaceImageResult = {
  readonly status: ReplaceImageStatus
  /** The public tags expired — empty unless `replaced`. */
  readonly cacheTags: readonly CacheTag[]
}

/**
 * Replace one image with an already-finalized one, through `replace_image()` —
 * the trusted transition that repoints every reference and removes the old row in
 * one transaction (brief §17). The public tags of the live references it moved are
 * expired next, so the first guest request renders the successor; the old files
 * are removed only after that. The new image's files are never touched.
 */
export async function replaceLibraryImage(
  supabase: SupabaseClient,
  storage: ImageStorage,
  profile: Profile,
  request: {
    readonly oldImageId: string
    readonly expectedUpdatedAt: string
    readonly newImageId: string
    /** The OLD image's derivative paths, read server-side before the call. */
    readonly derivativePaths: readonly string[]
  },
  effects: PublicCacheEffects,
): Promise<ReplaceImageResult> {
  if (!mayManageImages(profile)) return { status: 'forbidden', cacheTags: [] }

  const { data, error } = await supabase.rpc('replace_image', {
    p_old_id: request.oldImageId,
    p_expected_updated_at: request.expectedUpdatedAt,
    p_new_id: request.newImageId,
  })

  if (error) {
    console.error(`Replacing image ${request.oldImageId} failed: ${error.message}`)
    return { status: 'failed', cacheTags: [] }
  }

  const parsed = replaceResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error(`Unexpected replace result for image ${request.oldImageId}.`)
    return { status: 'failed', cacheTags: [] }
  }

  if (parsed.data.status !== 'replaced') {
    return { status: parsed.data.status, cacheTags: [] }
  }

  const cacheTags = cacheTagsForAffectedReferences(parsed.data.affected)
  effects.expireTags(cacheTags)

  await storage.removeDerivatives(request.derivativePaths)
  await storage.removeOriginal(parsed.data.storage_path)

  return { status: 'replaced', cacheTags }
}
