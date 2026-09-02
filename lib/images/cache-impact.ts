import { z } from 'zod'

import type { CacheTag } from '@/lib/cache/tags'
import { publishableEntity, type EntityKey } from '@/lib/publishing/entities'

/**
 * Which public cache tags an image-library mutation touches — technical plan §6,
 * §20; phase 10C-2 (brief §17–§22).
 *
 * Until 10C-2 nothing public rendered image data, so an alt edit, a global replace
 * or a confirmed delete could leave every cached page alone. Now every LIVE
 * reference to an image is rendered into tagged HTML, and the mutation that changes
 * it must expire exactly the tags whose output changed — no more (a draft-only
 * usage is invisible to guests and must expire nothing), no less (a stale
 * derivative URL in cached HTML would 404 once the files are gone).
 *
 * ONE DEFINITION OF "REFERENCE". A reference kind here is a row kind of
 * `public.image_references` — the view 10C-1 made the single truth for delete
 * refusals and usage captions. The kinds map onto the publishing registry's
 * entities, and the tags come from that registry rather than from a second list:
 * a dish's image appears wherever a dish appears (the menu and the Forside's
 * featured cards read the same `menu`-tagged read), so `dish → menu` is the
 * registry's own answer, not this module's guess. If a loader ever reads an
 * entity under a new tag, the registry changes and this mapping follows. The
 * Forside document's own three photographs (phase 11A) are a fifth kind,
 * `page:home`, rendered under the `page:home` tag alone.
 *
 * THE AFFECTED SET IS THE DATABASE'S. `delete_image()` and `replace_image()`
 * return `affected` — per-kind counts of the rows their own live statements
 * actually moved, read from the statements themselves inside the one transaction
 * (migration 20260901220000). That is the race-free answer: a reference a
 * concurrent publish made live between a pre-read and the transition is counted
 * by the statement that detached it. The alt edit has no trusted transition (the
 * column grant is the door, §0t), so it reads the view *after* its own successful
 * write — a reference published later than that read is rendered by the publish
 * that makes it live, which expires its own tags.
 */

export const REFERENCE_KINDS = ['dish', 'weekly', 'monthly', 'news', 'page:home'] as const

export type ReferenceKind = (typeof REFERENCE_KINDS)[number]

/** The registry entity each reference kind is rendered as. */
const ENTITY_OF_KIND: Record<ReferenceKind, EntityKey> = {
  dish: 'dish',
  weekly: 'weekly_special',
  monthly: 'monthly_burger',
  news: 'news',
  // The Forside document (phase 11A): its three image paths are rendered into the
  // `page:home`-tagged read, and nowhere else.
  'page:home': 'page:home',
}

const countsSchema = z.object({
  dish: z.number().int().min(0),
  weekly: z.number().int().min(0),
  monthly: z.number().int().min(0),
  news: z.number().int().min(0),
  'page:home': z.number().int().min(0),
})

/**
 * The `affected` document a trusted transition returns: how many LIVE rows of each
 * kind it moved (guests could see them), and how many draft-only rows (guests
 * could not). Live means "rendered to a guest before the transition": a published
 * dish, the singletons' live columns, a published article.
 */
export const affectedReferencesSchema = z.object({
  live: countsSchema,
  draft: countsSchema,
})

export type AffectedReferences = z.infer<typeof affectedReferencesSchema>

export function isReferenceKind(value: unknown): value is ReferenceKind {
  return typeof value === 'string' && (REFERENCE_KINDS as readonly string[]).includes(value)
}

/** The public tags one live reference of this kind is rendered under. */
export function cacheTagsForReferenceKind(kind: ReferenceKind): readonly CacheTag[] {
  return publishableEntity(ENTITY_OF_KIND[kind]).cacheTags
}

function uniqueTags(kinds: Iterable<ReferenceKind>): CacheTag[] {
  const tags = new Set<CacheTag>()
  for (const kind of kinds) {
    for (const tag of cacheTagsForReferenceKind(kind)) tags.add(tag)
  }
  return [...tags]
}

/**
 * The tags to expire after a transition — from its live counts only. Draft-only
 * movement changes no byte a guest is served and therefore expires nothing.
 */
export function cacheTagsForAffectedReferences(affected: AffectedReferences): CacheTag[] {
  return uniqueTags(REFERENCE_KINDS.filter((kind) => affected.live[kind] > 0))
}

/**
 * The tags to expire after an alt-text edit — from the image's current references
 * as `image_references` reports them, live rows only. A pending row (a draft
 * selection, or a reference on an unpublished article) is skipped: no guest sees
 * it, and the publish that makes it live expires its tags itself.
 */
export function cacheTagsForLiveReferences(
  references: readonly { readonly kind: ReferenceKind; readonly pending: boolean }[],
): CacheTag[] {
  return uniqueTags(
    references.filter((reference) => !reference.pending).map((reference) => reference.kind),
  )
}
