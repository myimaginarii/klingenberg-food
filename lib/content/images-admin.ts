import 'server-only'

import { cache } from 'react'

import {
  planThumbnail,
  readDerivativeRecord,
  type ImageUsage,
  type ThumbnailPlan,
} from '@/lib/images/library'
import { derivativePathsFor, derivativePublicUrl } from '@/lib/images/derivatives'
import { getSupabaseUrl } from '@/lib/supabase/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { assertNoQueryError } from './source'

/**
 * The image library as staff manage it — design 1w; technical plan §4, §15
 * (phase 10B).
 *
 * A separate read from any public one, for the reasons every `*-admin.ts` module
 * records: never cached (a stale `updated_at` would turn optimistic concurrency
 * into a lottery), through the staff member's own JWT (RLS decides what exists),
 * and carrying the columns the administration needs which `anon`'s grant does not
 * even name (`original_filename`).
 *
 * WHAT THE UI GETS, AND WHAT IT DOES NOT (phase-10B brief §2). The view model
 * carries the public thumbnail derivative, its dimensions, the alt text, the
 * display filename, the timestamp, the usage list and the version token — and
 * deliberately **no private-original URL** (the original's path never leaves the
 * server as an address), no uploader identity (1w's design has no place for it),
 * and no raw storage internals beyond what one `<img>` needs.
 *
 * USAGE (brief §3) is derived, on every request, from `public.image_references`
 * — the SECURITY INVOKER view phase 10C-1 introduced as the one definition of
 * "referenced": the four live image_id columns plus the three pending draft
 * keys. §4's rule ("no image_usages join table — usage is derived from the known
 * reference columns") still holds — the view stores nothing — and RLS still
 * decides every row through the caller's own JWT. Reading the same object
 * `delete_image()` counts from is what keeps a caption and a delete refusal one
 * truth. Soft-deleted dishes are included deliberately: their rows still
 * reference the image, `delete_image()` counts them, and a label that disagreed
 * with the refusal would be a lie.
 */

type ImageRow = {
  id: string
  storage_path: string
  alt_text: string | null
  width: number | null
  height: number | null
  derivatives: unknown
  original_filename: string | null
  created_at: string
  updated_at: string
}

const IMAGE_COLUMNS =
  'id, storage_path, alt_text, width, height, derivatives, original_filename, created_at, updated_at'

/** A thumbnail as the `<picture>` renders it: absolute public URLs, one rung. */
export type AdminImageThumbnail = {
  readonly webpUrl: string
  readonly avifUrl: string
  readonly width: number
  readonly height: number
}

/** One image, as the 1w library shows it. */
export type AdminImage = {
  readonly id: string
  readonly altText: string | null
  readonly originalFilename: string | null
  /** The stored original's visible dimensions — layout facts, never display copy. */
  readonly width: number | null
  readonly height: number | null
  readonly createdAt: string
  /** The version token every write about this image submits (§6). */
  readonly updatedAt: string
  readonly thumbnail: AdminImageThumbnail | null
  readonly usages: readonly ImageUsage[]
}

function publicUrl(path: string): string {
  return derivativePublicUrl(getSupabaseUrl(), path)
}

function thumbnailOf(
  row: Pick<ImageRow, 'storage_path' | 'derivatives'>,
): AdminImageThumbnail | null {
  const record = readDerivativeRecord(row.derivatives)
  if (record === null) return null

  const plan: ThumbnailPlan | null = planThumbnail(row.storage_path, record)
  if (plan === null) return null

  return {
    webpUrl: publicUrl(plan.webpPath),
    avifUrl: publicUrl(plan.avifPath),
    width: plan.width,
    height: plan.height,
  }
}

type ImageReferenceRow = {
  image_id: string
  kind: 'dish' | 'weekly' | 'monthly' | 'news' | 'page:home' | 'page:takeaway' | 'page:about'
  name: string
  pending: boolean
}

/**
 * Every usage, keyed by image id — one read of `public.image_references`, through
 * the caller's own JWT. The view is the single definition of "referenced" (phase
 * 10C-1): the same rows `delete_image()` counts before refusing with `in_use`,
 * live columns and pending draft keys alike, so a caption and a delete refusal
 * cannot disagree. The names are read fresh so a renamed dish relabels its
 * usages on the next request.
 */
const readImageUsages = cache(async (): Promise<ReadonlyMap<string, ImageUsage[]>> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('image_references')
    .select('image_id, kind, name, pending')
    .returns<ImageReferenceRow[]>()

  assertNoQueryError('the image references', error)

  const usages = new Map<string, ImageUsage[]>()

  for (const row of data ?? []) {
    const usage: ImageUsage = {
      kind: row.kind,
      name: row.kind === 'news' ? `Nyheden “${row.name}”` : row.name,
      pending: row.pending,
    }

    const list = usages.get(row.image_id)
    if (list === undefined) usages.set(row.image_id, [usage])
    else list.push(usage)
  }

  return usages
})

function toAdminImage(row: ImageRow, usages: ReadonlyMap<string, ImageUsage[]>): AdminImage {
  return {
    id: row.id,
    altText: row.alt_text,
    originalFilename: row.original_filename,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumbnail: thumbnailOf(row),
    usages: usages.get(row.id) ?? [],
  }
}

/** The whole library, newest first — the order a person who just uploaded expects. */
export const readAdminImageLibrary = cache(async (): Promise<AdminImage[]> => {
  const supabase = await createSupabaseServerClient()

  const [{ data, error }, usages] = await Promise.all([
    supabase
      .from('images')
      .select(IMAGE_COLUMNS)
      .order('created_at', { ascending: false })
      .returns<ImageRow[]>(),
    readImageUsages(),
  ])

  assertNoQueryError('the image library', error)

  return (data ?? []).map((row) => toAdminImage(row, usages))
})

/**
 * Does this image exist, for this caller? The picker actions ask before writing a
 * selection into a draft or a news row (phase 10C-1, brief §6): draft JSON has no
 * foreign key, so an id that names nothing must be refused here rather than
 * stored — and for news the FK would refuse anyway, but a sentence beats a
 * constraint violation.
 */
export async function imageExists(id: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('images')
    .select('id')
    .eq('id', id)
    .maybeSingle<{ id: string }>()

  assertNoQueryError('the selected image', error)

  return data !== null
}

/** One image by id, or `null` when it does not exist or RLS hides it. */
export async function readAdminImage(id: string): Promise<AdminImage | null> {
  const supabase = await createSupabaseServerClient()

  const [{ data, error }, usages] = await Promise.all([
    supabase.from('images').select(IMAGE_COLUMNS).eq('id', id).maybeSingle<ImageRow>(),
    readImageUsages(),
  ])

  assertNoQueryError('the image', error)
  if (data === null) return null

  return toAdminImage(data, usages)
}

/**
 * The thumbnails of a set of images, keyed by id — one read for a list that draws
 * a photo beside each of its rows (1r / 1y's FOTO frame on the dish rows; phase 12A).
 *
 * The same derivative plan the library's own cards use (`thumbnailOf`): the smallest
 * public rung, never the 2160 rung and never the private original. Three columns
 * and nothing else — no alt text, because a row's photo is decorative beside the
 * name the row already says; no usage, because the row is not a caption. Read
 * through the caller's own JWT, so RLS decides which ids name an image the caller
 * may see: an id that names nothing — deleted since the draft was written, or
 * hidden — is simply absent from the map, and the row draws its empty frame.
 */
export async function readAdminImageThumbnails(
  ids: readonly string[],
): Promise<ReadonlyMap<string, AdminImageThumbnail>> {
  const distinct = [...new Set(ids)]
  if (distinct.length === 0) return new Map()

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('images')
    .select('id, storage_path, derivatives')
    .in('id', distinct)
    .returns<Pick<ImageRow, 'id' | 'storage_path' | 'derivatives'>[]>()

  assertNoQueryError('the row thumbnails', error)

  const thumbnails = new Map<string, AdminImageThumbnail>()

  for (const row of data ?? []) {
    const thumbnail = thumbnailOf(row)
    if (thumbnail !== null) thumbnails.set(row.id, thumbnail)
  }

  return thumbnails
}

/**
 * The trusted facts a deletion or replacement needs about a row before the RPC
 * runs: its storage path and derivative record, read server-side — never from the
 * browser (brief §15, §16). The derivative record never changes after
 * `create_image()` wrote it (no trusted function updates it, and the column is out
 * of the direct grant), so a record read here names exactly the files the row has
 * always named.
 */
export type ImageStorageFacts = {
  readonly storagePath: string
  readonly derivativePaths: readonly string[]
}

export async function readImageStorageFacts(id: string): Promise<ImageStorageFacts | null> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('images')
    .select('storage_path, derivatives')
    .eq('id', id)
    .maybeSingle<{ storage_path: string; derivatives: unknown }>()

  assertNoQueryError('the image storage facts', error)
  if (data === null) return null

  const record = readDerivativeRecord(data.derivatives)

  return {
    storagePath: data.storage_path,
    derivativePaths: record === null ? [] : derivativePathsFor(data.storage_path, record),
  }
}
