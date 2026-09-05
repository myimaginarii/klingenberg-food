import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MIGRATIONS_DIR } from '../../scripts/launch/lib/migrations.mjs'
import { NAMES, launch, localStack, sql } from './support.mjs'

/**
 * The migration door against the real local database — technical plan §10b;
 * phase 14A.
 *
 * The production guard is exercised as production (the local stack refused),
 * then the same code in its harness mode: a current database is a no-op; a
 * staged pending migration applies in its own transaction with a CLI-compatible
 * history row and touches no content and no account; a target the checkout does
 * not know, and a divergent history, are refused before anything is applied; a
 * failing migration rolls back and leaves the history untouched. The seed files
 * are never named by the door — pinned by the boundary suite — and the counts
 * here prove nothing was seeded.
 */

const PROBE_VERSION = '20991231235959'
const PROBE = `${PROBE_VERSION}_launch_harness_probe.sql`
const PROBE_SQL = 'create table public.launch_harness_probe (id integer primary key);\n'

let stack
let repoFiles
const staged = []

async function stage(files) {
  const dir = await mkdtemp(join(tmpdir(), 'kf-migrate-drill-'))
  staged.push(dir)
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content)
  return dir
}

async function repositoryFiles() {
  const entries = {}
  for (const name of await readdir(MIGRATIONS_DIR)) entries[name] = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
  return entries
}

async function counts() {
  return sql(
    stack.dbContainer,
    `select json_build_object(
       'history', (select count(*) from supabase_migrations.schema_migrations),
       'dishes', (select count(*) from public.dishes),
       'news', (select count(*) from public.news),
       'profiles', (select count(*) from public.profiles),
       'probe', (select to_regclass('public.launch_harness_probe') is not null)
     )::text;`,
  ).then(JSON.parse)
}

function harness(args = [], env = {}) {
  return launch('migrate.mjs', ['--local-harness', ...args], { [NAMES.dbUrl]: stack.dbUrl, [NAMES.migrateConfirmHost]: stack.dbHost, ...env })
}

beforeAll(async () => {
  stack = await localStack()
  repoFiles = await repositoryFiles()
  await sql(stack.dbContainer, `drop table if exists public.launch_harness_probe; delete from supabase_migrations.schema_migrations where version = '${PROBE_VERSION}';`)
})

afterAll(async () => {
  await sql(stack.dbContainer, `drop table if exists public.launch_harness_probe; delete from supabase_migrations.schema_migrations where version = '${PROBE_VERSION}';`)
  for (const dir of staged) await rm(dir, { recursive: true, force: true })
})

describe('the production guard', () => {
  it('refuses the local stack in production mode, even with the loopback host confirmed', async () => {
    const run = await launch('migrate.mjs', [], { [NAMES.dbUrl]: stack.dbUrl, [NAMES.migrateConfirmHost]: stack.dbHost })
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/refused — The target .* is the local stack/)
  })

  it('refuses a harness run without its confirmation, or with a wrong one', async () => {
    const missing = await harness([], { [NAMES.migrateConfirmHost]: undefined })
    expect(missing.code).toBe(1)
    expect(missing.output).toMatch(/refused/)
    const wrong = await harness([], { [NAMES.migrateConfirmHost]: 'localhost' })
    expect(wrong.code).toBe(1)
    expect(wrong.output).toMatch(/must match exactly/)
  })

  it('refuses the staging option outside the harness', async () => {
    const run = await launch('migrate.mjs', ['--migrations-dir', 'x'], { [NAMES.dbUrl]: stack.dbUrl })
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/harness option/)
  })
})

describe('the door', () => {
  it('a current database is a no-op', async () => {
    const before = await counts()
    const run = await harness()
    expect(run.output).toContain('nothing to apply')
    expect(run.code).toBe(0)
    expect(await counts()).toEqual(before)
  })

  it('a pending migration applies with a CLI-compatible history row, and seeds nothing', async () => {
    const dir = await stage({ ...repoFiles, [PROBE]: PROBE_SQL })
    const before = await counts()

    const dry = await harness(['--migrations-dir', dir, '--dry-run'])
    expect(dry.code).toBe(0)
    expect(dry.output).toContain(`plan: apply 1 migration(s) — ${PROBE}`)
    expect(dry.output).toContain('dry run')
    expect(await counts()).toEqual(before)

    const run = await harness(['--migrations-dir', dir])
    expect(run.output).toContain(`applied: ${PROBE}`)
    expect(run.output).toContain('migrated: 1 applied')
    expect(run.code).toBe(0)

    const after = await counts()
    expect(after.probe).toBe(true)
    expect(after.history).toBe(before.history + 1)
    // The content tables and the accounts are exactly as they were: no seed, no bootstrap.
    expect(after.dishes).toBe(before.dishes)
    expect(after.news).toBe(before.news)
    expect(after.profiles).toBe(before.profiles)

    const row = JSON.parse(
      await sql(stack.dbContainer, `select json_build_object('name', name, 'statements', statements)::text from supabase_migrations.schema_migrations where version = '${PROBE_VERSION}';`),
    )
    expect(row).toEqual({ name: 'launch_harness_probe', statements: [PROBE_SQL] })

    // And running again is the no-op — the history is the truth.
    const again = await harness(['--migrations-dir', dir])
    expect(again.code).toBe(0)
    expect(again.output).toContain('nothing to apply')

    await sql(stack.dbContainer, `drop table public.launch_harness_probe; delete from supabase_migrations.schema_migrations where version = '${PROBE_VERSION}';`)
  })

  it('a target newer than the checkout is refused before anything happens', async () => {
    const names = Object.keys(repoFiles).sort()
    const withoutLatest = { ...repoFiles }
    delete withoutLatest[names.at(-1)]
    const dir = await stage(withoutLatest)
    const before = await counts()

    const run = await harness(['--migrations-dir', dir])
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/refused — the target carries 1 migration\(s\) this checkout does not know/)
    expect(await counts()).toEqual(before)
  })

  it('a divergent history is refused before anything happens', async () => {
    const names = Object.keys(repoFiles).sort()
    const latest = names.at(-1)
    const divergent = { ...repoFiles }
    delete divergent[latest]
    divergent[`20990101000000_${latest.slice(15)}`] = repoFiles[latest]
    const dir = await stage(divergent)
    const before = await counts()

    const run = await harness(['--migrations-dir', dir])
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/refused — the target’s migration history diverges/)
    expect(await counts()).toEqual(before)
  })

  it('a failing migration rolls back whole and records nothing', async () => {
    const dir = await stage({ ...repoFiles, [PROBE]: `${PROBE_SQL}select 1/0;\n` })
    const before = await counts()

    const run = await harness(['--migrations-dir', dir])
    expect(run.code).toBe(1)
    expect(run.output).toMatch(new RegExp(`${PROBE} failed and was rolled back; 0 earlier migration`))
    expect(run.output).toContain('division by zero')
    expect(await counts()).toEqual(before)
  })
})
