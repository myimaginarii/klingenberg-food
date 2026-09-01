import 'server-only'

import { cache } from 'react'

import {
  planThumbnail,
  readDerivativeRecord,
  type ImageUsage,
  type ThumbnailPlan,
} from '@/lib/images/library'
import { derivativePathsFor, derivativePublicUrlPath } from '@/lib/images/derivatives'
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
 * USAGE (brief §3) is derived, on every request, from the four image_id
 * relationships — dishes, weekly_special, monthly_burger, news — by id and by
 * nothing else. §4's rule ("no image_usages join table — usage is derived from the
 * known reference columns") is implemented here in the read layer rather than as a
 * database view: the same four reads a view would run, without a migration to
 * carry them, and RLS still decides every row through the caller's own JWT.
 * Soft-deleted dishes are included deliberately: their rows still reference the
 * image, `delete_image()` counts them, and a label that disagreed with the
 * refusal would be a lie.
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
  return `${getSupabaseUrl()}${derivativePublicUrlPath(path)}`
}

function thumbnailOf(row: ImageRow): AdminImageThumbnail | null {
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

/**
 * Every usage, keyed by image id — four reads, one per relationship, each through
 * the caller's own JWT. The names are read fresh so a renamed dish relabels its
 * usages on the next request.
 */
const readImageUsages = cache(async (): Promise<ReadonlyMap<string, ImageUsage[]>> => {
  const supabase = await createSupabaseServerClient()

  const [dishes, weekly, monthly, news] = await Promise.all([
    supabase.from('dishes').select('image_id, name').not('image_id', 'is', null),
    supabase.from('weekly_special').select('image_id').not('image_id', 'is', null),
    supabase.from('monthly_burger').select('image_id').not('image_id', 'is', null),
    supabase.from('news').select('image_id, title').not('image_id', 'is', null),
  ])

  assertNoQueryError('the dish image references', dishes.error)
  assertNoQueryError('the weekly-special image reference', weekly.error)
  assertNoQueryError('the monthly-burger image reference', monthly.error)
  assertNoQueryError('the news image references', news.error)

  const usages = new Map<string, ImageUsage[]>()
  const add = (imageId: string | null, usage: ImageUsage) => {
    if (imageId === null) return
    const list = usages.get(imageId)
    if (list === undefined) usages.set(imageId, [usage])
    else list.push(usage)
  }

  for (const row of (dishes.data ?? []) as { image_id: string | null; name: string }[]) {
    add(row.image_id, { kind: 'dish', name: row.name })
  }
  for (const row of (weekly.data ?? []) as { image_id: string | null }[]) {
    add(row.image_id, { kind: 'weekly', name: 'Ugens ret' })
  }
  for (const row of (monthly.data ?? []) as { image_id: string | null }[]) {
    add(row.image_id, { kind: 'monthly', name: 'Månedens burger' })
  }
  for (const row of (news.data ?? []) as { image_id: string | null; title: string }[]) {
    add(row.image_id, { kind: 'news', name: `Nyheden “${row.title}”` })
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
