#!/usr/bin/env node
/**
 * Create a recovery point — technical plan §10f; phase 13A.
 *
 *   node scripts/backup/backup.mjs --out <directory> [--tier weekly|monthly] [--ship]
 *
 * One recovery point is one directory, `<out>/<id>/`, holding:
 *
 *   db/schema.sql, db/data-public.sql, db/data-auth.sql   (lib/pg.mjs)
 *   storage/media-originals/…, storage/media/…             (lib/storage.mjs)
 *   manifest.json                                          (lib/manifest.mjs), written last
 *
 * `--ship` uploads the directory to the off-platform destination and, if — and only
 * if — every required component succeeded, moves `latest.json` (lib/ship.mjs).
 *
 * The scheduled workflow and the manual command are this one script; there is no
 * second implementation (brief §14). The exit code is non-zero unless every
 * required component succeeded: a database dump beside a failed Storage export is
 * written, shipped as `complete: false`, and reported as a failure (brief §12).
 *
 * SOURCE SAFETY (lib/targets.mjs, added 2026-09-06): the database and the Storage
 * API must belong to the same Supabase project, and a hosted source must be able to
 * prove it. That is checked before the output directory is created, and a source
 * that fails it produces nothing at all — the one failure mode this script does not
 * express as an incomplete manifest, because a recovery point stitched from two
 * projects would look complete and be wrong.
 *
 * Configuration is environment only (lib/env.mjs). Nothing here prints a secret.
 */

import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { readDestination, readOptions, readProject, secretValues } from './lib/env.mjs'
import { BUCKETS } from './lib/keys.mjs'
import { MANIFEST_FILE, assertTier, buildManifest, recoveryPointId } from './lib/manifest.mjs'
import { DATABASE_FILES, countCopyRows, createPgDoor } from './lib/pg.mjs'
import { createLogger, run, sha256File } from './lib/run.mjs'
import { shipRecoveryPoint } from './lib/ship.mjs'
import { createStorageClient, exportBucket } from './lib/storage.mjs'
import { assessBackupSource, describeDbUrl } from './lib/targets.mjs'

const MIGRATIONS_DIR = 'supabase/migrations'

function usage() {
  console.error('usage: node scripts/backup/backup.mjs --out <directory> [--tier weekly|monthly] [--ship]')
  process.exit(2)
}

/** @param {string} message @returns {never} */
function refuse(message) {
  console.error(`backup: refused — ${message}`)
  process.exit(1)
}

/** The repository's own migration versions — what the schema *should* be. */
function repositoryMigrations() {
  const dir = resolve(MIGRATIONS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => /^(\d{14})_/.exec(name)?.[1])
    .filter((version) => typeof version === 'string')
    .sort()
}

/** @param {import('./lib/run.mjs').Logger} logger */
async function repositoryCommit(logger) {
  try {
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { env: process.env, logger })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** @param {unknown} error @param {import('./lib/run.mjs').Logger} logger */
function describeError(error, logger) {
  return logger.redact(error instanceof Error ? error.message : String(error))
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      tier: { type: 'string', default: 'weekly' },
      ship: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (!values.out) usage()
  const tier = assertTier(/** @type {string} */ (values.tier))

  const logger = createLogger({ secrets: secretValues(process.env) })
  const project = readProject(process.env)
  const options = readOptions(process.env)

  // --- The source, before anything is created -------------------------------------
  // A recovery point combines a database dump with a Storage export, and the two
  // must belong to the same Supabase project. This is the restore guard's identity
  // rule applied to the reading side (lib/targets.mjs): fail closed, whole, and
  // before a directory exists — half a recovery point from two projects is worse
  // than none, because only a restore would discover it.
  const assessed = assessBackupSource({ dbUrl: project.dbUrl, apiUrl: project.apiUrl })
  if (!assessed.ok) refuse(assessed.reasons.join(' '))

  // The destination is read up front so a misconfigured secret fails before an
  // hour of dumping, not after it.
  const destination = values.ship ? readDestination(process.env) : null

  const startedAt = new Date()
  const id = recoveryPointId(startedAt)
  const dir = resolve(/** @type {string} */ (values.out), id)
  await mkdir(join(dir, 'db'), { recursive: true })

  const source = {
    apiHost: assessed.apiHost,
    dbHost: assessed.dbHost,
    projectRef: assessed.projectRef,
  }

  logger.info(`recovery point ${id} (${tier})`)
  logger.info(`source: database ${describeDbUrl(project.dbUrl)}, storage at ${source.apiHost}`)
  logger.info(`writing to ${dir}`)

  /** @type {Record<string, any>} */
  const components = {}
  /** @type {Record<string, { bytes: number, sha256: string }>} */
  const files = {}
  /** @type {string[] | null} */
  let appliedMigrations = null

  // --- Database ------------------------------------------------------------------
  try {
    const door = await createPgDoor({ dbUrl: project.dbUrl, mode: options.pgMode, image: options.pgImage, logger })
    logger.info(`database: ${door.describe()}`)
    appliedMigrations = await door.appliedMigrations()
    logger.info(`database: ${appliedMigrations.length} migration(s) applied, latest ${appliedMigrations.at(-1) ?? 'none'}`)

    /** @type {Record<string, number>} */
    const rows = {}
    for (const [kind, relativeFile] of Object.entries(DATABASE_FILES)) {
      const outFile = join(dir, relativeFile)
      const { bytes } = await door.dump(/** @type {any} */ (kind), outFile)
      files[relativeFile] = await sha256File(outFile)
      if (kind !== 'schema') Object.assign(rows, countCopyRows(await readFile(outFile, 'utf8')))
      logger.info(`database: ${relativeFile} — ${bytes} bytes`)
    }
    components.database = { status: 'ok', files: Object.values(DATABASE_FILES), rows }
    logger.info(`database: ${Object.keys(rows).length} table(s), ${Object.values(rows).reduce((a, b) => a + b, 0)} row(s)`)
  } catch (error) {
    components.database = { status: 'failed', error: describeError(error, logger) }
    logger.error(`database: ${components.database.error}`)
  }

  // --- Storage -------------------------------------------------------------------
  try {
    const client = createStorageClient(project.apiUrl, project.serviceRoleKey)
    /** @type {Record<string, any>} */
    const buckets = {}
    for (const bucket of BUCKETS) {
      const objects = await exportBucket(client, bucket.name, dir, { logger })
      buckets[bucket.name] = { public: bucket.public, objects }
      for (const object of objects) {
        files[`storage/${bucket.name}/${object.key}`] = { bytes: object.bytes, sha256: object.sha256 }
      }
    }
    components.storage = { status: 'ok', buckets }
  } catch (error) {
    components.storage = { status: 'failed', error: describeError(error, logger) }
    logger.error(`storage: ${components.storage.error}`)
  }

  // --- Manifest, written last ----------------------------------------------------
  const manifest = buildManifest({
    id,
    createdAt: startedAt.toISOString(),
    tier,
    source,
    repository: { commit: await repositoryCommit(logger), migrations: repositoryMigrations() },
    schema: { appliedMigrations },
    components,
    files,
  })
  await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n')
  logger.info(`manifest: ${manifest.complete ? 'complete' : 'INCOMPLETE'} — ${Object.keys(files).length} file(s)`)

  // --- Ship ----------------------------------------------------------------------
  let shipped = false
  if (destination) {
    try {
      const result = await shipRecoveryPoint({ dir, manifest, destination, aws: options.awsCli, logger })
      shipped = true
      logger.info(`shipped ${result.objects} object(s) to ${result.location}`)
    } catch (error) {
      logger.error(`ship: ${describeError(error, logger)}`)
    }
  }

  const ok = manifest.complete && (!destination || shipped)
  logger.info(ok ? `recovery point ${id} complete` : `recovery point ${id} FAILED`)
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  // The logger is not available if configuration failed; the messages that reach
  // here name variables and hosts, never values.
  console.error(`backup: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
