/**
 * Storage keys and their place on disk — technical plan §8, §10f; phase 13A
 * (brief §8, §28 "injection through filenames/paths").
 *
 * An object key is produced by the storage service and, in this system, by the
 * upload pipeline: `<upload-uuid>/original.<ext>` in the private bucket and
 * `<upload-uuid>/<width>.<avif|webp>` in the public one (§0t). A backup should not
 * *depend* on that grammar — a future key shape must still be backed up — but it
 * must never let a key it did not expect walk out of the recovery-point directory.
 * So every key passes `isSafeObjectKey()` before it becomes a path, and the path is
 * checked to resolve inside the root it was given.
 */

import { resolve, sep } from 'node:path'

/** The two buckets the application owns (§0t), with the privacy each must keep. */
export const BUCKETS = Object.freeze([
  Object.freeze({ name: 'media-originals', public: false }),
  Object.freeze({ name: 'media', public: true }),
])

export const STORAGE_DIRECTORY = 'storage'

const MAX_KEY_LENGTH = 1024
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * A key is safe when it is a non-empty, slash-separated path of non-empty segments,
 * none of which is `.` or `..`, with no backslash, no control character and no
 * leading slash.
 *
 * @param {unknown} key
 * @returns {key is string}
 */
export function isSafeObjectKey(key) {
  if (typeof key !== 'string') return false
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false
  if (CONTROL_CHARACTERS.test(key) || key.includes('\\')) return false
  if (key.startsWith('/')) return false
  const segments = key.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** @param {string} name */
export function isKnownBucket(name) {
  return BUCKETS.some((bucket) => bucket.name === name)
}

/**
 * The on-disk location of one object inside a recovery point:
 * `<root>/storage/<bucket>/<key>`. Throws rather than returning a path outside the
 * root, whatever the key looked like.
 *
 * @param {string} root
 * @param {string} bucket
 * @param {string} key
 */
export function localPathForObject(root, bucket, key) {
  if (!isKnownBucket(bucket)) throw new Error(`Unknown bucket "${bucket}".`)
  if (!isSafeObjectKey(key)) throw new Error(`Refusing unsafe object key ${JSON.stringify(key)}.`)
  const base = resolve(root, STORAGE_DIRECTORY, bucket)
  const target = resolve(base, ...key.split('/'))
  if (!target.startsWith(base + sep)) {
    throw new Error(`Object key ${JSON.stringify(key)} resolves outside the recovery point.`)
  }
  return target
}

/**
 * The seconds in a stored `Cache-Control: max-age=<n>` header — the form the storage
 * service records and the form its upload API wants back.
 *
 * @param {string | null | undefined} header
 * @returns {string | undefined}
 */
export function parseCacheControlSeconds(header) {
  if (!header) return undefined
  const match = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(header)
  return match ? match[1] : undefined
}
