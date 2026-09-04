#!/usr/bin/env node
/**
 * Restore a recovery point — technical plan §10f; phase 13A (brief §15–§18).
 *
 *   node scripts/backup/restore.mjs --from <recovery-point directory>
 *        [--skip-auth] [--skip-storage] [--allow-partial] [--allow-newer-schema] [--dry-run]
 *
 * The target is the project named by the environment (lib/env.mjs). A restore
 * TRUNCATES and RELOADS it, so the target is assessed before anything is touched
 * (lib/targets.mjs): the local stack needs no confirmation; any other host must be
 * named, exactly, in BACKUP_RESTORE_CONFIRM_HOST; and the database and Storage must
 * belong to the same project.
 *
 * Order of work, each step refusing before the next starts:
 *
 *   1. Read and validate the manifest; verify every listed file's sha256.
 *   2. Assess the target. Print it — hosts only, never a credential.
 *   3. Compare the target's applied migrations with the manifest's. Equal: proceed.
 *      Target newer: refuse unless --allow-newer-schema (the supported sequence is
 *      "restore into the backup's schema version, then `supabase db push`", §17 of
 *      the brief; loading old rows into new columns is allowed only knowingly).
 *      Target older or divergent: refuse — apply the migrations first.
 *   4. One psql transaction: session_replication_role = replica, truncate every
 *      application table (and the durable auth tables unless --skip-auth), load
 *      the auth rows, load the application rows. Any error rolls the whole
 *      transaction back.
 *   5. Upload every Storage object with its recorded content type and cache header.
 *   6. Verify: row counts per table against the manifest, and both buckets'
 *      inventories against the manifest.
 *
 * `--skip-auth` keeps the target's own identities (a content-only restore into a
 * project whose Auth is intact). `--skip-storage` restores the database alone.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { readOptions, readProject, secretValues } from './lib/env.mjs'
import { BUCKETS, isSafeObjectKey } from './lib/keys.mjs'
import { MANIFEST_FILE, compareMigrationHistories, isComplete, validateManifest } from './lib/manifest.mjs'
import { DATABASE_FILES, TRUNCATE_AUTH_SQL, TRUNCATE_PUBLIC_SQL, createPgDoor } from './lib/pg.mjs'
import { createLogger, sha256File } from './lib/run.mjs'
import { createStorageClient, importBucket, verifyBucket } from './lib/storage.mjs'
import { assessRestoreTarget } from './lib/targets.mjs'

function usage() {
  console.error(
    'usage: node scripts/backup/restore.mjs --from <directory> [--skip-auth] [--skip-storage] ' +
      '[--allow-partial] [--allow-newer-schema] [--dry-run]',
  )
  process.exit(2)
}

/** @param {string} message @returns {never} */
function refuse(message) {
  console.error(`restore: refused — ${message}`)
  process.exit(1)
}

async function main() {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      'skip-auth': { type: 'boolean', default: false },
      'skip-storage': { type: 'boolean', default: false },
      'allow-partial': { type: 'boolean', default: false },
      'allow-newer-schema': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (!values.from) usage()
  const dir = resolve(/** @type {string} */ (values.from))

  const logger = createLogger({ secrets: secretValues(process.env) })
  const project = readProject(process.env)
  const options = readOptions(process.env)

  // --- 1. The recovery point ------------------------------------------------------
  /** @type {any} */
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8'))
  } catch (error) {
    refuse(`no readable ${MANIFEST_FILE} in ${dir} (${error instanceof Error ? error.message : String(error)})`)
  }
  const problems = validateManifest(manifest)
  if (problems.length > 0) refuse(`the manifest is not usable: ${problems.join('; ')}`)
  if (!isComplete(manifest) && !values['allow-partial']) {
    const failed = Object.entries(manifest.components)
      .filter(([, c]) => /** @type {any} */ (c).status !== 'ok')
      .map(([name, c]) => `${name} (${/** @type {any} */ (c).error ?? 'not run'})`)
    refuse(`recovery point ${manifest.id} is INCOMPLETE — ${failed.join(', ')}. Pass --allow-partial only knowingly.`)
  }

  logger.info(`recovery point ${manifest.id} (${manifest.tier}) created ${manifest.createdAt}`)
  logger.info(`taken from ${manifest.source.dbHost} / ${manifest.source.apiHost}, commit ${manifest.repository.commit ?? 'unknown'}`)

  // The manifest is data from the destination: its names are checked before they
  // become paths or identifiers, exactly like an object key from the listing.
  const fileNames = Object.keys(manifest.files)
  for (const name of fileNames) {
    if (!isSafeObjectKey(name)) refuse(`the manifest names an unsafe file path ${JSON.stringify(name)}.`)
    const expected = manifest.files[name]
    const actual = await sha256File(join(dir, ...name.split('/')))
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      refuse(`${name} does not match the manifest (sha256 or size). The recovery point is damaged or altered.`)
    }
  }
  logger.info(`verified ${fileNames.length} file(s) against the manifest`)

  const restoreAuth = !values['skip-auth'] && manifest.components.database.status === 'ok'
  const restoreStorage = !values['skip-storage'] && manifest.components.storage.status === 'ok'
  const restoreDatabase = manifest.components.database.status === 'ok'
  if (!restoreDatabase) refuse('the recovery point holds no usable database dump.')

  // --- 2. The target --------------------------------------------------------------
  const target = assessRestoreTarget({
    dbUrl: project.dbUrl,
    apiUrl: project.apiUrl,
    confirmHost: options.restoreConfirmHost,
  })
  logger.info(`target: ${target.description}${target.loopback ? ' (local stack)' : ''}`)
  if (!target.ok) refuse(target.reasons.join(' '))

  // --- 3. Schema version ------------------------------------------------------------
  const door = await createPgDoor({ dbUrl: project.dbUrl, mode: options.pgMode, image: options.pgImage, logger })
  logger.info(`database: ${door.describe()}`)
  const applied = await door.appliedMigrations()
  const backupMigrations = manifest.schema.appliedMigrations ?? []
  const relation = compareMigrationHistories(applied, backupMigrations)
  logger.info(`schema: target has ${applied.length} migration(s), the backup was taken at ${backupMigrations.length} — ${relation}`)
  if (relation === 'target-older') {
    refuse('the target is behind the backup’s schema. Apply the repository migrations first (supabase db push).')
  }
  if (relation === 'divergent') {
    refuse('the target’s migration history diverges from the backup’s. This is not the same schema lineage.')
  }
  if (relation === 'target-newer' && !values['allow-newer-schema']) {
    refuse(
      'the target is ahead of the backup’s schema. The supported sequence is to restore into a project at the ' +
        `backup’s version (${backupMigrations.at(-1)}) and then apply the newer migrations; pass --allow-newer-schema only knowingly.`,
    )
  }

  const rows = /** @type {Record<string, number>} */ (manifest.components.database.rows ?? {})
  for (const table of Object.keys(rows)) {
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(table)) refuse(`the manifest names an unsafe table ${JSON.stringify(table)}.`)
  }
  logger.info(
    `plan: truncate and reload ${Object.keys(rows).filter((t) => t.startsWith('public.')).length} application table(s)` +
      `${restoreAuth ? ', reload identities' : ', keep the target’s identities'}` +
      `${restoreStorage ? `, restore ${BUCKETS.map((b) => `${b.name} (${manifest.components.storage.buckets?.[b.name]?.objects?.length ?? 0})`).join(' and ')}` : ', leave Storage untouched'}`,
  )
  if (values['dry-run']) {
    logger.info('dry run — nothing was changed')
    return
  }

  // --- 4. Database, one transaction ----------------------------------------------
  const commands = ['set session_replication_role = replica;', TRUNCATE_PUBLIC_SQL]
  const files = []
  if (restoreAuth) {
    commands.push(TRUNCATE_AUTH_SQL)
    files.push(DATABASE_FILES.authData)
  }
  files.push(DATABASE_FILES.publicData)
  await door.psql({ commands, files, dir })
  logger.info('database: reloaded')

  // --- 5. Storage ------------------------------------------------------------------
  const client = createStorageClient(project.apiUrl, project.serviceRoleKey)
  if (restoreStorage) {
    for (const bucket of BUCKETS) {
      const objects = manifest.components.storage.buckets?.[bucket.name]?.objects ?? []
      await importBucket(client, bucket.name, dir, objects, { logger })
    }
  }

  // --- 6. Verification -------------------------------------------------------------
  /** @type {string[]} */
  const failures = []
  const tables = Object.keys(rows).filter((table) => restoreAuth || table.startsWith('public.'))
  if (tables.length > 0) {
    const sql = tables
      .map((table) => {
        const [schema, name] = table.split('.')
        return `select '${table}' as t, count(*) as n from "${schema}"."${name}"`
      })
      .join(' union all ')
    const out = await door.query(sql)
    const counted = new Map(out.split(/\r?\n/).filter(Boolean).map((line) => line.split('|')).map(([t, n]) => [t, Number(n)]))
    for (const table of tables) {
      if (counted.get(table) !== rows[table]) failures.push(`${table}: expected ${rows[table]} row(s), found ${counted.get(table) ?? 'none'}`)
    }
    logger.info(`verify: ${tables.length} table(s) counted`)
  }

  if (restoreStorage) {
    for (const bucket of BUCKETS) {
      const objects = manifest.components.storage.buckets?.[bucket.name]?.objects ?? []
      const result = await verifyBucket(client, bucket.name, objects)
      if (result.missing.length > 0 || result.mismatched.length > 0) {
        failures.push(`${bucket.name}: ${result.missing.length} object(s) missing, ${result.mismatched.length} with a different size`)
      }
      logger.info(`verify: ${bucket.name} holds ${result.count} object(s), ${objects.length} expected`)
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) logger.error(`verify: ${failure}`)
    process.exit(1)
  }

  logger.info(`restore of ${manifest.id} verified`)
  logger.info('next: revoke every session, re-establish project configuration, and test before reopening (docs/runbooks/restore.md)')
}

main().catch((error) => {
  console.error(`restore: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
