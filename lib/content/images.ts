import 'server-only'

import { buildPublicImage, type PublicImage } from '@/lib/images/public'
import { getSupabaseUrl } from '@/lib/supabase/config'

import { assertNoQueryError, type ContentAccess } from './source'

/**
 * The public image projection — technical plan §4, §6, §8; phase 10C-2.
 *
 * The one read that turns an entity's `image_id` into something a public page can
 * render. It is called *inside* the tagged reads (`lib/content/menu.ts`,
 * `lib/content/news.ts`), never beside them, so the image data becomes part of the
 * cache entry that carries the entity's tag — which is what makes an alt edit, a
 * replacement or a deletion expirable through that same tag (§20, phase-10C-2
 * brief §17). A separate image cache with its own tag would be a second thing to
 * keep in step and a second way to serve a stale photo.
 *
 * WHAT IS READ. Exactly the three columns the model needs — `storage_path` (to
 * derive the derivative paths), `alt_text`, `derivatives` — through whichever
 * access the caller has: the anonymous client on the published path (the phase-1
 * `images_select_public` policy and column grant), the staff member's own JWT in
 * Draft Mode. `original_filename`, `uploaded_by`, `bytes` and `mime` are never
 * selected; the private bucket is never named; nothing here composes a URL — that
 * is `lib/images/public.ts` over the central path builder.
 *
 * WHAT A MISSING ROW MEANS. An id that names no readable row — deleted between
 * reads, hidden by RLS, or a stale draft value — is simply absent from the map, so
 * the entity renders its placeholder. A row whose derivative record does not parse
 * is treated the same (`buildPublicImage` returns null). Neither case throws on a
 * visitor, and neither falls back to the original.
 */

const IMAGE_COLUMNS = 'id, storage_path, alt_text, derivatives'

type PublicImageRow = {
  id: string
  storage_path: unknown
  alt_text: unknown
  derivatives: unknown
}

/**
 * The renderable model of every readable image among `ids`, keyed by id. Null,
 * undefined and duplicate ids are tolerated so callers can hand over whatever
 * their rows carry; an empty set performs no query at all.
 */
export async function readPublicImages(
  access: ContentAccess,
  ids: Iterable<string | null | undefined>,
): Promise<ReadonlyMap<string, PublicImage>> {
  const wanted = [...new Set([...ids].filter((id): id is string => typeof id === 'string'))]
  if (wanted.length === 0) return new Map()

  const { data, error } = await access.database
    .from('images')
    .select(IMAGE_COLUMNS)
    .in('id', wanted)
    .returns<PublicImageRow[]>()

  assertNoQueryError('the public images', error)

  const origin = getSupabaseUrl()
  const images = new Map<string, PublicImage>()

  for (const row of data ?? []) {
    const image = buildPublicImage(origin, row)
    if (image !== null) images.set(row.id, image)
  }

  return images
}

/** One entity's image: the model for its id, or `null` for no id and for an unrenderable row. */
export function imageFor(
  images: ReadonlyMap<string, PublicImage>,
  imageId: string | null | undefined,
): PublicImage | null {
  if (typeof imageId !== 'string') return null
  return images.get(imageId) ?? null
}
