import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  HISTORY_TABLE_SQL,
  MIGRATIONS_DIR,
  migrationBundle,
  planMigrations,
  readRepositoryMigrations,
} from '../../../scripts/launch/lib/migrations.mjs'

/**
 * The migration plan — technical plan §10b; phase 14A.
 *
 * Pure rules: the repository's files, the four relations to a target's history,
 * and the SQL that records one migration the way the CLI does.
 */

const dirs = []
function stage(files) {
  const dir = mkdtempSync(join(tmpdir(), 'kf-migrations-'))
  dirs.push(dir)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the repository migrations', () => {
  it('reads the real directory, oldest first, every file a migration', () => {
    const migrations = readRepositoryMigrations(MIGRATIONS_DIR)
    expect(migrations.length).toBeGreaterThanOrEqual(24)
    expect(migrations[0]).toEqual({ version: '20260829120000', name: 'initial_schema', file: '20260829120000_initial_schema.sql' })
    const versions = migrations.map((m) => m.version)
    expect([...versions].sort()).toEqual(versions)
  })

  it('refuses a stray file rather than skipping it, and a duplicated version', () => {
    expect(() => readRepositoryMigrations(stage({ '20260101000000_a.sql': '', 'notes.txt': '' }))).toThrow(/not a migration file/)
    expect(() => readRepositoryMigrations(stage({ '20260101000000_a.sql': '', '20260101000000_b.sql': '' }))).toThrow(/share the version/)
  })
})

describe('the plan', () => {
  const repo = [
    { version: '1', name: 'a', file: '1_a.sql' },
    { version: '2', name: 'b', file: '2_b.sql' },
    { version: '3', name: 'c', file: '3_c.sql' },
  ]

  it('equal — nothing pending', () => {
    expect(planMigrations(['1', '2', '3'], repo)).toEqual({ relation: 'equal', pending: [], unknown: [] })
  })

  it('a fresh target — everything pending, in order', () => {
    expect(planMigrations([], repo)).toMatchObject({ relation: 'target-older', pending: repo })
  })

  it('target older — exactly the tail is pending', () => {
    expect(planMigrations(['1'], repo)).toMatchObject({ relation: 'target-older', pending: [repo[1], repo[2]] })
  })

  it('target newer — the unknown versions are named and nothing is pending', () => {
    expect(planMigrations(['1', '2', '3', '4'], repo)).toEqual({ relation: 'target-newer', pending: [], unknown: ['4'] })
  })

  it('divergent — nothing is pending', () => {
    expect(planMigrations(['1', 'x', '3'], repo)).toMatchObject({ relation: 'divergent', pending: [] })
  })
})

describe('the bundle', () => {
  const migration = { version: '20260101000000', name: 'probe', file: '20260101000000_probe.sql' }

  it('is the file, then its CLI-compatible history row, whole', () => {
    const bundle = migrationBundle(migration, 'create table public.probe (id int);\n')
    expect(bundle.startsWith('create table public.probe (id int);')).toBe(true)
    expect(bundle).toContain("insert into supabase_migrations.schema_migrations (version, name, statements)")
    expect(bundle).toContain("values ('20260101000000', 'probe', array[$kf_migration$create table public.probe (id int);\n$kf_migration$]);")
  })

  it('picks a dollar-quote tag the content cannot close', () => {
    const bundle = migrationBundle(migration, 'select $kf_migration$x$kf_migration$;')
    expect(bundle).toContain('array[$kf_migration_1$select $kf_migration$x$kf_migration$;$kf_migration_1$]')
  })

  it('refuses an unsafe version or name — the filename regex is the only source', () => {
    expect(() => migrationBundle({ ...migration, name: "x'); drop table y; --" }, '')).toThrow(/unsafe/)
    expect(() => migrationBundle({ ...migration, version: '1' }, '')).toThrow(/unsafe/)
  })

  it('creates the history table the way the CLI does, idempotently', () => {
    expect(HISTORY_TABLE_SQL).toMatch(/create schema if not exists supabase_migrations/)
    expect(HISTORY_TABLE_SQL).toMatch(/create table if not exists supabase_migrations\.schema_migrations \(version text not null primary key\)/)
    expect(HISTORY_TABLE_SQL).toMatch(/add column if not exists statements text\[\]/)
    expect(HISTORY_TABLE_SQL).toMatch(/add column if not exists name text/)
  })
})
