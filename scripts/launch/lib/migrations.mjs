/**
 * The migration plan — technical plan §10b; phase 14A (the migration door).
 *
 * Pure: which repository migrations exist, how the target's history relates to
 * them, and the SQL that applies one of them. The door (`../migrate.mjs`) reads
 * the files and drives psql; nothing here opens a connection.
 *
 * COMPATIBILITY WITH THE CLI. A migration is recorded exactly where and how the
 * Supabase CLI records it — `supabase_migrations.schema_migrations (version,
 * name, statements)` — so a database migrated by this door and one migrated by
 * `supabase db push` carry the same history and the restore tooling's comparison
 * (`compareMigrationHistories`) reads both. The CLI stores the file split into
 * statements; this door stores the file whole as one element, which is the
 * statement it ran.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { compareMigrationHistories } from '../../backup/lib/manifest.mjs'

/** The repository's own migration directory, and its filename shape. */
export const MIGRATIONS_DIR = join('supabase', 'migrations')
export const MIGRATION_FILE_RE = /^(\d{14})_([A-Za-z0-9_-]+)\.sql$/

/**
 * The CLI's own bootstrap of the history table, verbatim in effect: safe on a
 * database that has it, and it creates it on a fresh project.
 */
export const HISTORY_TABLE_SQL = [
  'create schema if not exists supabase_migrations;',
  'create table if not exists supabase_migrations.schema_migrations (version text not null primary key);',
  'alter table supabase_migrations.schema_migrations add column if not exists statements text[];',
  'alter table supabase_migrations.schema_migrations add column if not exists name text;',
].join('\n')

/** True when the history table exists at all — the query the door asks first. */
export const HISTORY_TABLE_EXISTS_SQL = "select to_regclass('supabase_migrations.schema_migrations') is not null;"

/**
 * @typedef {{ version: string, name: string, file: string }} Migration
 */

/**
 * The repository's migrations, oldest first. Anything in the directory that is not
 * a migration file is refused rather than skipped — a stray file there is a
 * mistake worth hearing about before it is silently left unapplied.
 *
 * @param {string} dir
 * @returns {Migration[]}
 */
export function readRepositoryMigrations(dir) {
  /** @type {Migration[]} */
  const migrations = []
  for (const file of readdirSync(dir)) {
    const match = MIGRATION_FILE_RE.exec(file)
    if (!match) throw new Error(`${file} in ${dir} is not a migration file (<14 digits>_<name>.sql).`)
    migrations.push({ version: match[1], name: match[2], file })
  }
  migrations.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
  for (let i = 1; i < migrations.length; i += 1) {
    if (migrations[i].version === migrations[i - 1].version) {
      throw new Error(`Two migration files share the version ${migrations[i].version}.`)
    }
  }
  return migrations
}

/**
 * How the target's applied versions relate to the repository, and what is left
 * to apply. The relation vocabulary is the restore tooling's, with the repository
 * in the place of the backup: `equal` (nothing to do), `target-older` (pending
 * migrations follow), `target-newer` (the target carries versions this checkout
 * does not know), `divergent` (the histories disagree somewhere in the middle).
 *
 * @param {readonly string[]} applied
 * @param {readonly Migration[]} repository
 */
export function planMigrations(applied, repository) {
  const versions = repository.map((m) => m.version)
  const relation = compareMigrationHistories([...applied], versions)
  const known = new Set(versions)
  const unknown = applied.filter((version) => !known.has(version))
  const pending = relation === 'target-older' ? repository.slice(applied.length) : []
  return { relation, pending, unknown }
}

/**
 * The SQL that applies one migration: the file, then its history row, in the
 * one transaction the door runs the bundle in. The content is dollar-quoted under
 * a tag the content cannot contain; version and name come from the filename
 * regex and are literal-safe by construction.
 *
 * @param {Migration} migration
 * @param {string} content
 */
export function migrationBundle(migration, content) {
  if (!/^\d{14}$/.test(migration.version) || !/^[A-Za-z0-9_-]+$/.test(migration.name)) {
    throw new Error(`Refusing to record a migration with an unsafe version or name (${migration.file}).`)
  }
  let tag = '$kf_migration$'
  for (let n = 1; content.includes(tag); n += 1) tag = `$kf_migration_${n}$`
  return (
    `${content.replace(/\s+$/, '')}\n\n` +
    `insert into supabase_migrations.schema_migrations (version, name, statements)\n` +
    `values ('${migration.version}', '${migration.name}', array[${tag}${content}${tag}]);\n`
  )
}
