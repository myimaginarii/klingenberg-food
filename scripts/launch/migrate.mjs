#!/usr/bin/env node
/**
 * The production migration door — technical plan §10b; phase 14A.
 *
 *   MIGRATE_CONFIRM_HOST=<ref>.supabase.co node scripts/launch/migrate.mjs [--dry-run]
 *
 * with the project's session-pooler connection string (port 5432) in the
 * environment under the database name `scripts/backup/lib/env.mjs` gives it —
 * the same variable the backup tooling reads; `.env.example` and
 * `docs/runbooks/launch-notes.md` spell it out.
 *
 * Applies the repository's pending migrations — `supabase/migrations`, the one
 * set of files every environment shares — to one hosted project, and nothing
 * else: no seed file, no development content, no confirmed content, no Owner.
 * Those are three other explicit commands, and the source policy refuses this
 * one if it ever names them.
 *
 * ONE IMPLEMENTATION for an operator's terminal and, in phase 14C, for the
 * protected production workflow (`.github/workflows/production-migrate.yml`):
 * the workflow runs this file with the same two variables from its protected
 * environment. No migration logic lives in YAML.
 *
 * HISTORY DISCIPLINE, the restore tooling's (§0ah): the target's applied versions
 * are read first and compared with the repository. Equal — nothing to do, exit 0.
 * Target older — the pending files are applied in order, each in its own
 * transaction with its CLI-compatible history row (lib/migrations.mjs). Target
 * newer (versions this checkout does not know) or divergent — refused; there is
 * no rollback and no downgrade, by decision.
 *
 * TARGET SAFETY (lib/target.mjs): a hosted project only, confirmed by naming its
 * project host in MIGRATE_CONFIRM_HOST; the local stack refused; the connection
 * string in the environment, never on a command line (§8). The tests drive the
 * same code with `--local-harness` (loopback only) and, only then,
 * `--migrations-dir` to stage a pending, a divergent and a target-newer history.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { NAMES, readDatabase, readOptions, secretValues } from '../backup/lib/env.mjs'
import { createPgDoor } from '../backup/lib/pg.mjs'
import { createLogger } from '../backup/lib/run.mjs'
import { withSqlBundle } from './lib/bundle.mjs'
import {
  HISTORY_TABLE_EXISTS_SQL,
  HISTORY_TABLE_SQL,
  MIGRATIONS_DIR,
  migrationBundle,
  planMigrations,
  readRepositoryMigrations,
} from './lib/migrations.mjs'
import { assessLaunchTarget } from './lib/target.mjs'

/** @param {string} message @returns {never} */
function refuse(message) {
  console.error(`migrate: refused — ${message}`)
  process.exit(1)
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'local-harness': { type: 'boolean', default: false },
      'migrations-dir': { type: 'string' },
    },
    strict: true,
  })
  const harness = values['local-harness']
  if (values['migrations-dir'] !== undefined && !harness) {
    refuse(`--migrations-dir is a harness option: the production door applies ${MIGRATIONS_DIR} and nothing else.`)
  }

  const logger = createLogger({ secrets: secretValues(process.env) })
  const { dbUrl } = readDatabase(process.env)
  const options = readOptions(process.env)

  // --- 1. The target ---------------------------------------------------------------
  const target = assessLaunchTarget({
    kind: 'db',
    url: dbUrl,
    confirmHost: options.migrateConfirmHost,
    confirmName: NAMES.migrateConfirmHost,
    harness,
    operation: 'migration',
  })
  logger.info(`target: ${target.description}${target.projectRef ? ` (project ${target.projectRef})` : ''}${harness ? ' — local harness' : ''}`)
  if (!target.ok) refuse(target.reasons.join(' '))

  // --- 2. The repository -------------------------------------------------------------
  const dir = resolve(values['migrations-dir'] ?? MIGRATIONS_DIR)
  const repository = readRepositoryMigrations(dir)
  if (repository.length === 0) refuse(`${dir} holds no migration files.`)
  logger.info(`repository: ${repository.length} migration(s), latest ${repository.at(-1)?.version}`)

  // --- 3. The target's history ---------------------------------------------------------
  const door = await createPgDoor({ dbUrl, mode: options.pgMode, image: options.pgImage, logger })
  logger.info(`database: ${door.describe()}`)
  const historyExists = (await door.query(HISTORY_TABLE_EXISTS_SQL)) === 't'
  const applied = historyExists ? await door.appliedMigrations() : []
  const plan = planMigrations(applied, repository)
  logger.info(`history: target has ${applied.length} migration(s)${historyExists ? '' : ' (no history table yet)'} — ${plan.relation}`)

  if (plan.relation === 'divergent') {
    refuse(
      'the target’s migration history diverges from the repository’s. This is not the same schema lineage; ' +
        'nothing is applied and nothing is rolled back.',
    )
  }
  if (plan.relation === 'target-newer') {
    refuse(
      `the target carries ${plan.unknown.length} migration(s) this checkout does not know (${plan.unknown.join(', ')}). ` +
        'Check out the commit that produced them; there is no downgrade.',
    )
  }
  if (plan.relation === 'equal') {
    logger.info('nothing to apply: the target is at the repository’s latest migration')
    return
  }

  logger.info(`plan: apply ${plan.pending.length} migration(s) — ${plan.pending.map((m) => m.file).join(', ')}`)
  if (values['dry-run']) {
    logger.info('dry run — nothing was changed')
    return
  }

  // --- 4. Apply, one transaction per migration -----------------------------------------
  if (!historyExists) {
    await door.psql({ commands: [HISTORY_TABLE_SQL] })
    logger.info('history: table created')
  }
  const appliedNow = []
  for (const migration of plan.pending) {
    const content = await readFile(join(dir, migration.file), 'utf8')
    const bundle = migrationBundle(migration, content)
    try {
      await withSqlBundle(migration.file, bundle, ({ dir: bundleDir, file }) => door.psql({ files: [file], dir: bundleDir }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`${migration.file} failed and was rolled back; ${appliedNow.length} earlier migration(s) of this run stay applied. ${message}`)
      process.exit(1)
    }
    appliedNow.push(migration.version)
    logger.info(`applied: ${migration.file}`)
  }

  // --- 5. Verify -------------------------------------------------------------------------
  const after = await door.appliedMigrations()
  const expected = repository.map((m) => m.version)
  if (after.length !== expected.length || after.some((version, i) => version !== expected[i])) {
    logger.error(`verify: the target's history (${after.length}) does not match the repository (${expected.length}) after the run`)
    process.exit(1)
  }
  logger.info(`migrated: ${appliedNow.length} applied, target at ${expected.at(-1)}`)
}

main().catch((error) => {
  console.error(`migrate: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
