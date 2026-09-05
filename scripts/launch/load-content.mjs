#!/usr/bin/env node
/**
 * The one-time production content load — technical plan §10a, §10b; phase 14A.
 *
 *   CONTENT_LOAD_CONFIRM_HOST=<ref>.supabase.co node scripts/launch/load-content.mjs [--dry-run]
 *
 * with the project's session-pooler connection string (port 5432) in the
 * environment under the database name `scripts/backup/lib/env.mjs` gives it —
 * the same variable the backup tooling reads; `.env.example` and
 * `docs/runbooks/launch-notes.md` spell it out.
 *
 * Loads `supabase/seed/confirmed.sql` — the restaurant's confirmed contact
 * information, opening hours, nine menu sections, every confirmed dish and price,
 * and the tapas lists — into a FRESH production database, once, so nobody
 * retypes dozens of real menu rows. It is not a content-management path: after
 * this load the administration is authoritative, and this command refuses a
 * database that already carries content (lib/content.mjs states the four states).
 *
 * It reads ONE file, by a constant path. The development layer
 * (`supabase/seed/development.sql`: placeholder pages, placeholder News, the
 * weekly placeholder) is named nowhere in this tooling, and the source policy
 * refuses a launch tool that mentions it. No identity is created here.
 *
 * ATOMIC. The fresh-state guard, the file and the marker row run in one psql
 * transaction with ON_ERROR_STOP; a rejected dish takes the whole load with it,
 * and the database is exactly as it was.
 *
 * TARGET SAFETY (lib/target.mjs): a hosted project only, confirmed by naming its
 * project host in CONTENT_LOAD_CONFIRM_HOST; the local stack refused; the
 * connection string in the environment, never on a command line (§8). The tests
 * drive the same code with `--local-harness`, which accepts loopback only and,
 * only then, `--source <file>` for a forced-failure rehearsal.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { NAMES, readDatabase, readOptions, secretValues } from '../backup/lib/env.mjs'
import { createPgDoor } from '../backup/lib/pg.mjs'
import { createLogger, sha256 } from '../backup/lib/run.mjs'
import { withSqlBundle } from './lib/bundle.mjs'
import { CONFIRMED_CONTENT_FILE, CONTENT_STATE_SQL, classifyContentState, contentBundle, parseContentState } from './lib/content.mjs'
import { assessLaunchTarget } from './lib/target.mjs'

/** @param {string} message @returns {never} */
function refuse(message) {
  console.error(`load-content: refused — ${message}`)
  process.exit(1)
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'local-harness': { type: 'boolean', default: false },
      source: { type: 'string' },
    },
    strict: true,
  })
  const harness = values['local-harness']
  if (values.source !== undefined && !harness) {
    refuse(`--source is a harness option: the production load reads ${CONFIRMED_CONTENT_FILE} and nothing else.`)
  }

  const logger = createLogger({ secrets: secretValues(process.env) })
  const { dbUrl } = readDatabase(process.env)
  const options = readOptions(process.env)

  // --- 1. The target ---------------------------------------------------------------
  const target = assessLaunchTarget({
    kind: 'db',
    url: dbUrl,
    confirmHost: options.contentLoadConfirmHost,
    confirmName: NAMES.contentLoadConfirmHost,
    harness,
    operation: 'content load',
  })
  logger.info(`target: ${target.description}${target.projectRef ? ` (project ${target.projectRef})` : ''}${harness ? ' — local harness' : ''}`)
  if (!target.ok) refuse(target.reasons.join(' '))

  // --- 2. The file -------------------------------------------------------------------
  const source = values.source ?? CONFIRMED_CONTENT_FILE
  const sql = await readFile(resolve(source), 'utf8')
  const digest = sha256(Buffer.from(sql, 'utf8'))
  logger.info(`content: ${source} (${Buffer.byteLength(sql)} bytes, sha256 ${digest.slice(0, 12)}…)`)

  // --- 3. The database's state ---------------------------------------------------------
  const door = await createPgDoor({ dbUrl, mode: options.pgMode, image: options.pgImage, logger })
  logger.info(`database: ${door.describe()}`)
  const state = parseContentState(await door.query(CONTENT_STATE_SQL))
  const verdict = classifyContentState(state)
  logger.info(`state: ${verdict} — ${state.categories} section(s), ${state.dishes} dish(es), ${state.markers} load marker(s)`)

  if (verdict === 'loaded') {
    logger.info(`nothing to do: the confirmed content was loaded on ${state.markedAt ?? 'an earlier run'}; the administration owns the content now`)
    return
  }
  if (verdict === 'operational') {
    refuse(
      'the database already carries content and no load marker — a live restaurant, a restored backup or a ' +
        'hand-edited project. The administration owns the content now; this loader never overwrites it.',
    )
  }
  if (verdict === 'inconsistent') {
    refuse('a load marker exists but the content tables are empty. Refusing an ambiguous state; inspect audit_log by hand.')
  }

  if (values['dry-run']) {
    logger.info('dry run — the database is fresh and the confirmed content would be loaded; nothing was changed')
    return
  }

  // --- 4. One transaction: guard, content, marker --------------------------------------
  const bundle = contentBundle(sql, { sha256: digest, source: CONFIRMED_CONTENT_FILE })
  try {
    await withSqlBundle('confirmed-content.sql', bundle, ({ dir, file }) => door.psql({ files: [file], dir }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    refuse(`the load failed and was rolled back; the database is unchanged. ${message}`)
  }

  // --- 5. Verify ------------------------------------------------------------------------
  const after = parseContentState(await door.query(CONTENT_STATE_SQL))
  if (classifyContentState(after) !== 'loaded' || after.categories === 0 || after.dishes === 0) {
    logger.error(`verify: expected a loaded database, found ${after.categories} section(s), ${after.dishes} dish(es), ${after.markers} marker(s)`)
    process.exit(1)
  }
  logger.info(`loaded: ${after.categories} section(s), ${after.dishes} dish(es), the contact facts and the opening hours`)
  logger.info('next: the administration owns the content from here; this command is now inert for this project')
}

main().catch((error) => {
  console.error(`load-content: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
