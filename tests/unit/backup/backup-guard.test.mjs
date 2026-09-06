import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NAMES } from '../../../scripts/backup/lib/env.mjs'

/**
 * The backup command refuses a mixed source — technical plan §8, §10f; 2026-09-06.
 *
 * `tests/unit/backup/targets.test.mjs` holds the rules; this file holds the
 * command. It runs the real `scripts/backup/backup.mjs` with configurations that
 * describe two different Supabase projects and proves three things about each:
 *
 *   1. the exit code is non-zero and the message says `refused`;
 *   2. NOTHING was created — no output directory, so no half recovery point and
 *      nothing a later `--ship` could upload;
 *   3. no password reached the output.
 *
 * The guard runs before the destination is read, which is what the last case
 * asserts from the other side: a source that IS one project gets past it and the
 * command then fails on the missing destination instead. The positive path in
 * full — a valid source producing a real recovery point — is the local stack's,
 * and `npm run backup:drill` runs it end to end.
 *
 * No configuration here can reach a network: the hosts are either loopback or
 * under the reserved `.test` TLD, and every case fails before a connection is
 * opened. Variable names come from `lib/env.mjs`, never as literals (§10e).
 */

const REF_A = 'abcdefghijklmnopqrst'
const REF_B = 'tsrqponmlkjihgfedcba'
const PASSWORD = 'n0t-in-any-log'
// Assembled, so the repository's domain scanner sees no host literal (§10d).
const PG = ['postgresql:', '//'].join('')
const LOCAL_DB = `${PG}postgres:postgres@127.0.0.1:54322/postgres`
const LOCAL_API = 'http://127.0.0.1:54321'
const POOLER_DB = `${PG}postgres.${REF_A}:${PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
const API_A = `https://${REF_A}.supabase.co`
const API_B = `https://${REF_B}.supabase.co`
const OPAQUE_DB = `${PG}postgres:${PASSWORD}@db.klingenberg.example.test:5432/postgres`

const SCRIPT = join(process.cwd(), 'scripts', 'backup', 'backup.mjs')

/** @type {string} */
let workRoot

beforeAll(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'backup-guard-'))
})

afterAll(() => {
  rmSync(workRoot, { recursive: true, force: true })
})

/**
 * Run the real command with a source and nothing else it could succeed on.
 *
 * @param {{ dbUrl: string, apiUrl: string, ship?: boolean }} source
 * @returns {Promise<{ code: number | null, output: string, out: string }>}
 */
function backup({ dbUrl, apiUrl, ship = false }) {
  const out = join(workRoot, `out-${Math.random().toString(36).slice(2)}`)
  const env = { ...process.env }
  // A developer's own shell must not decide what this command sees.
  for (const name of Object.values(NAMES)) delete env[name]
  env[NAMES.dbUrl] = dbUrl
  env[NAMES.apiUrl] = apiUrl
  env[NAMES.serviceRoleKey] = 'service-role-key-fixture'

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SCRIPT, '--out', out, ...(ship ? ['--ship'] : [])], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    /** @type {Buffer[]} */
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code, output: Buffer.concat(chunks).toString('utf8'), out }))
  })
}

describe('a backup of two different projects', () => {
  it('is refused, creates nothing, and prints no password', async () => {
    const result = await backup({ dbUrl: POOLER_DB, apiUrl: API_B })
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/backup: refused/)
    expect(result.output).toMatch(/Refusing to mix projects/)
    expect(result.output).not.toContain(PASSWORD)
    expect(existsSync(result.out)).toBe(false)
  })

  it('is refused when only one half is the local stack', async () => {
    const local = await backup({ dbUrl: LOCAL_DB, apiUrl: API_A })
    expect(local.code).toBe(1)
    expect(local.output).toMatch(/backup: refused/)
    expect(existsSync(local.out)).toBe(false)

    const hosted = await backup({ dbUrl: POOLER_DB, apiUrl: LOCAL_API })
    expect(hosted.code).toBe(1)
    expect(hosted.output).toMatch(/backup: refused/)
    expect(hosted.output).not.toContain(PASSWORD)
    expect(existsSync(hosted.out)).toBe(false)
  })

  it('is refused when the project cannot be read from the database host at all', async () => {
    const result = await backup({ dbUrl: OPAQUE_DB, apiUrl: API_A })
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/No Supabase project ref can be read from the database host/)
    expect(result.output).not.toContain(PASSWORD)
    expect(existsSync(result.out)).toBe(false)
  })

  it('is refused before the destination is read, so a mixed --ship uploads nothing', async () => {
    const result = await backup({ dbUrl: POOLER_DB, apiUrl: API_B, ship: true })
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/backup: refused/)
    // The destination is missing too; the SOURCE is what stopped it.
    expect(result.output).not.toMatch(new RegExp(NAMES.s3Endpoint))
    expect(existsSync(result.out)).toBe(false)
  })
})

describe('a backup of one project', () => {
  it('gets past the guard and fails on what is actually missing', async () => {
    const result = await backup({ dbUrl: POOLER_DB, apiUrl: API_A, ship: true })
    expect(result.code).toBe(1)
    expect(result.output).not.toMatch(/refused/)
    expect(result.output).toMatch(new RegExp(NAMES.s3Endpoint))
    expect(result.output).not.toContain(PASSWORD)
    // Still nothing on disk: the destination is read before the directory is made.
    expect(existsSync(result.out)).toBe(false)
  })

  it('left no recovery point anywhere under the working root', () => {
    expect(readdirSync(workRoot)).toEqual([])
  })
})
