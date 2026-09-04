/**
 * Storage export and import — technical plan §8, §10f; phase 13A (brief §8, §9).
 *
 * Objects are read and written through the Storage API with the service role — the
 * trusted administrative door §8 already names, and the route Supabase's own
 * project-migration guide takes for Storage ("a script using the client library").
 * The private bucket is never read through a public URL, and no signed URL is
 * treated as an identifier: the manifest records the bucket, the key, the bytes, a
 * sha256, the content type and the cache header, which is everything a restore
 * needs to put the object back exactly.
 *
 * The export is a FULL copy of both buckets on every run (§10f's "incremental sync"
 * would need a persistent local mirror, and a CI runner has none). For a
 * restaurant's photo library that is tens to hundreds of megabytes a week, which
 * is cheaper than a mechanism that could quietly miss something.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { createClient } from '@supabase/supabase-js'

import { isSafeObjectKey, localPathForObject, parseCacheControlSeconds } from './keys.mjs'
import { sha256 } from './run.mjs'

const PAGE_SIZE = 1000
const DEFAULT_CONCURRENCY = 4

/**
 * @typedef {{
 *   key: string,
 *   bytes: number | null,
 *   contentType: string | null,
 *   cacheControl: string | null,
 *   etag: string | null,
 *   lastModified: string | null,
 * }} StorageObject
 * @typedef {StorageObject & { sha256: string, bytes: number }} ExportedObject
 */

/**
 * A service-role client for the tooling: no session, no refresh, nothing persisted.
 *
 * @param {string} apiUrl
 * @param {string} serviceRoleKey
 */
export function createStorageClient(apiUrl, serviceRoleKey) {
  return createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

/**
 * Every object in a bucket, recursively, with the metadata the listing returns.
 * The listing API is one folder level at a time; folders come back with a null id.
 *
 * @param {ReturnType<typeof createStorageClient>} client
 * @param {string} bucket
 * @returns {Promise<StorageObject[]>}
 */
export async function listObjects(client, bucket) {
  /** @type {StorageObject[]} */
  const objects = []
  const api = client.storage.from(bucket)

  /** @param {string} prefix */
  async function walk(prefix) {
    let offset = 0
    for (;;) {
      const { data, error } = await api.list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw new Error(`Listing ${bucket}/${prefix} failed: ${error.message}`)
      for (const entry of data) {
        const key = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.id === null) {
          await walk(key)
          continue
        }
        if (!isSafeObjectKey(key)) throw new Error(`Refusing unsafe object key ${JSON.stringify(key)} in ${bucket}.`)
        const metadata = /** @type {Record<string, unknown> | null} */ (entry.metadata)
        objects.push({
          key,
          bytes: typeof metadata?.size === 'number' ? metadata.size : null,
          contentType: typeof metadata?.mimetype === 'string' ? metadata.mimetype : null,
          cacheControl: typeof metadata?.cacheControl === 'string' ? metadata.cacheControl : null,
          etag: typeof metadata?.eTag === 'string' ? metadata.eTag : null,
          lastModified:
            typeof metadata?.lastModified === 'string' ? metadata.lastModified : (entry.updated_at ?? null),
        })
      }
      if (data.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
  }

  await walk('')
  objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return objects
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<void>} work
 */
async function forEachConcurrently(items, concurrency, work) {
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await work(/** @type {T} */ (item))
    }
  })
  await Promise.all(workers)
}

/**
 * Download every object of a bucket into `<root>/storage/<bucket>/<key>`, hashing
 * each as it lands. A size that disagrees with the listing is an error, never a
 * warning.
 *
 * @param {ReturnType<typeof createStorageClient>} client
 * @param {string} bucket
 * @param {string} root
 * @param {{ logger?: import('./run.mjs').Logger, concurrency?: number }} [options]
 * @returns {Promise<ExportedObject[]>}
 */
export async function exportBucket(client, bucket, root, { logger, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const listed = await listObjects(client, bucket)
  const api = client.storage.from(bucket)
  /** @type {ExportedObject[]} */
  const exported = []

  await forEachConcurrently(listed, concurrency, async (object) => {
    const { data, error } = await api.download(object.key)
    if (error || !data) throw new Error(`Downloading ${bucket}/${object.key} failed: ${error?.message ?? 'no body'}`)
    const bytes = Buffer.from(await data.arrayBuffer())
    if (object.bytes !== null && object.bytes !== bytes.length) {
      throw new Error(`${bucket}/${object.key}: the listing says ${object.bytes} bytes, the download had ${bytes.length}.`)
    }
    const path = localPathForObject(root, bucket, object.key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    exported.push({ ...object, bytes: bytes.length, sha256: sha256(bytes) })
  })

  exported.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  logger?.info(`storage: ${bucket} — ${exported.length} object(s), ${exported.reduce((n, o) => n + o.bytes, 0)} bytes`)
  return exported
}

/**
 * Upload every recorded object back into its bucket, verifying each file against
 * the manifest's sha256 first. Upsert keeps a repeated restore idempotent.
 *
 * @param {ReturnType<typeof createStorageClient>} client
 * @param {string} bucket
 * @param {string} root
 * @param {readonly ExportedObject[]} objects
 * @param {{ logger?: import('./run.mjs').Logger, concurrency?: number }} [options]
 */
export async function importBucket(client, bucket, root, objects, { logger, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const api = client.storage.from(bucket)
  let uploaded = 0

  await forEachConcurrently(objects, concurrency, async (object) => {
    const path = localPathForObject(root, bucket, object.key)
    const bytes = await readFile(path)
    const digest = sha256(bytes)
    if (digest !== object.sha256 || bytes.length !== object.bytes) {
      throw new Error(`${bucket}/${object.key}: the file on disk does not match the manifest (sha256 or size).`)
    }
    const { error } = await api.upload(object.key, bytes, {
      contentType: object.contentType ?? 'application/octet-stream',
      cacheControl: parseCacheControlSeconds(object.cacheControl),
      upsert: true,
    })
    if (error) throw new Error(`Uploading ${bucket}/${object.key} failed: ${error.message}`)
    uploaded += 1
  })

  logger?.info(`storage: ${bucket} — ${uploaded} object(s) restored`)
  return { uploaded }
}

/**
 * Compare what a bucket holds now with what a manifest says it should hold.
 *
 * @param {ReturnType<typeof createStorageClient>} client
 * @param {string} bucket
 * @param {readonly { key: string, bytes: number }[]} expected
 */
export async function verifyBucket(client, bucket, expected) {
  const present = new Map((await listObjects(client, bucket)).map((object) => [object.key, object.bytes]))
  const wanted = new Map(expected.map((object) => [object.key, object.bytes]))
  /** @type {string[]} */
  const missing = []
  /** @type {string[]} */
  const mismatched = []
  for (const [key, bytes] of wanted) {
    if (!present.has(key)) missing.push(key)
    else if (present.get(key) !== null && present.get(key) !== bytes) mismatched.push(key)
  }
  const extra = [...present.keys()].filter((key) => !wanted.has(key))
  return { missing, mismatched, extra, count: present.size }
}
