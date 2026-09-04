/**
 * Shipping a recovery point off-platform — technical plan §10f; phase 13A
 * (brief §3, §5, §9, §10).
 *
 * The destination is any S3-compatible private bucket, reached with the AWS CLI
 * that the CI runner already carries — the one tool §10f names. Credentials arrive
 * through the CLI's own environment variables; the only things on the command line
 * are the endpoint, the bucket and the key prefix, none of them secret.
 *
 * Layout in the bucket:
 *
 *   <prefix>/weekly/<id>/…     one directory per weekly recovery point
 *   <prefix>/monthly/<id>/…    one directory per monthly recovery point
 *   <prefix>/latest.json       the newest COMPLETE, VERIFIED recovery point
 *
 * Retention is the bucket's lifecycle rule per tier prefix (manifest.mjs
 * RETENTION), so nothing here ever deletes. `latest.json` is written last and only
 * after the uploaded objects have been listed back and compared with the local
 * files, so a failed or partial run can never move the pointer.
 */

import { readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

import { LATEST_FILE, isComplete, latestPointer, objectKeyPrefix } from './manifest.mjs'
import { run } from './run.mjs'

/** Environment variables a subprocess needs to run at all — never a secret. */
const PASSTHROUGH = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'AWS_CA_BUNDLE',
]

/**
 * The AWS CLI's environment: the destination's key pair and nothing else secret.
 * The two checksum settings keep newer CLI releases compatible with stores that
 * do not implement the 2025 default checksum headers (Cloudflare R2 among them).
 *
 * @param {{ accessKeyId: string, secretAccessKey: string, region: string }} destination
 * @param {Record<string, string | undefined>} [baseEnv]
 * @returns {Record<string, string>}
 */
export function awsEnvFor(destination, baseEnv = process.env) {
  /** @type {Record<string, string>} */
  const env = {}
  for (const name of PASSTHROUGH) {
    const value = baseEnv[name]
    if (value !== undefined) env[name] = value
  }
  return {
    ...env,
    AWS_ACCESS_KEY_ID: destination.accessKeyId,
    AWS_SECRET_ACCESS_KEY: destination.secretAccessKey,
    AWS_DEFAULT_REGION: destination.region,
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_PAGER: '',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
    AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required',
  }
}

/**
 * Every file under a directory as `{ key, bytes }`, keys relative and slash-separated.
 *
 * @param {string} dir
 * @returns {Promise<{ key: string, bytes: number }[]>}
 */
export async function localInventory(dir) {
  /** @type {{ key: string, bytes: number }[]} */
  const files = []
  /** @param {string} current */
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        const info = await stat(full)
        files.push({ key: relative(dir, full).split(sep).join('/'), bytes: info.size })
      }
    }
  }
  await walk(dir)
  files.sort((a, b) => (a.key < b.key ? -1 : 1))
  return files
}

/**
 * The objects under a prefix from `aws s3api list-objects-v2 --output json`, with
 * the prefix stripped so they compare with a local inventory.
 *
 * @param {string} json
 * @param {string} prefix
 * @returns {{ key: string, bytes: number }[]}
 */
export function parseListing(json, prefix) {
  const parsed = json.trim() ? JSON.parse(json) : {}
  const contents = Array.isArray(parsed.Contents) ? parsed.Contents : []
  return contents
    .filter((/** @type {any} */ entry) => typeof entry.Key === 'string' && entry.Key.startsWith(prefix))
    .map((/** @type {any} */ entry) => ({ key: entry.Key.slice(prefix.length), bytes: Number(entry.Size) }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.key < b.key ? -1 : 1))
}

/**
 * @param {readonly { key: string, bytes: number }[]} local
 * @param {readonly { key: string, bytes: number }[]} remote
 */
export function compareInventories(local, remote) {
  const remoteByKey = new Map(remote.map((object) => [object.key, object.bytes]))
  const localKeys = new Set(local.map((object) => object.key))
  return {
    missing: local.filter((object) => !remoteByKey.has(object.key)).map((object) => object.key),
    mismatched: local
      .filter((object) => remoteByKey.has(object.key) && remoteByKey.get(object.key) !== object.bytes)
      .map((object) => object.key),
    extra: remote.filter((object) => !localKeys.has(object.key)).map((object) => object.key),
  }
}

/**
 * Upload a recovery-point directory, list it back, compare, and — only for a
 * complete point — move `latest.json`.
 *
 * @param {{
 *   dir: string,
 *   manifest: import('./manifest.mjs').buildManifest extends (...a: any) => infer R ? R : never,
 *   destination: { endpoint: string, bucket: string, region: string, prefix: string, accessKeyId: string, secretAccessKey: string },
 *   aws?: string,
 *   env?: Record<string, string | undefined>,
 *   logger?: import('./run.mjs').Logger,
 * }} options
 */
export async function shipRecoveryPoint({ dir, manifest, destination, aws = 'aws', env = process.env, logger }) {
  const prefix = objectKeyPrefix(destination.prefix, manifest.tier, manifest.id)
  const uri = `s3://${destination.bucket}/${prefix}/`
  const awsEnv = awsEnvFor(destination, env)
  const endpoint = ['--endpoint-url', destination.endpoint]

  logger?.info(`ship: uploading to ${uri}`)
  await run(aws, ['s3', 'cp', '--recursive', '--only-show-errors', dir, uri, ...endpoint], { env: awsEnv, logger })

  const { stdout } = await run(
    aws,
    ['s3api', 'list-objects-v2', '--bucket', destination.bucket, '--prefix', `${prefix}/`, '--output', 'json', ...endpoint],
    { env: awsEnv, logger },
  )
  const local = await localInventory(dir)
  const remote = parseListing(stdout, `${prefix}/`)
  const diff = compareInventories(local, remote)
  if (diff.missing.length > 0 || diff.mismatched.length > 0) {
    throw new Error(
      `ship: the destination does not hold what was uploaded — ${diff.missing.length} missing, ` +
        `${diff.mismatched.length} with a different size (first: ${[...diff.missing, ...diff.mismatched][0]}).`,
    )
  }
  logger?.info(`ship: ${remote.length} object(s) verified at ${uri}`)

  let latestUpdated = false
  if (isComplete(manifest)) {
    const pointer = latestPointer(manifest, uri)
    const pointerFile = join(tmpdir(), `klingenberg-${manifest.id}-${LATEST_FILE}`)
    await writeFile(pointerFile, JSON.stringify(pointer, null, 2) + '\n')
    const pointerUri = `s3://${destination.bucket}/${destination.prefix.replace(/^\/+|\/+$/g, '')}/${LATEST_FILE}`
    await run(aws, ['s3', 'cp', '--only-show-errors', pointerFile, pointerUri, ...endpoint], { env: awsEnv, logger })
    latestUpdated = true
    logger?.info(`ship: ${LATEST_FILE} now points at ${manifest.id}`)
  } else {
    logger?.warn(`ship: the recovery point is incomplete; ${LATEST_FILE} was left untouched`)
  }

  return { location: uri, objects: remote.length, latestUpdated }
}
