import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NAMES } from '../../scripts/backup/lib/env.mjs'

/**
 * What the launch drill shares — phase 14A.
 *
 * The local stack's coordinates (loopback, or nothing), a superuser psql through
 * the CLI's own database container (the backup drill's door, for the states the
 * commands must never produce themselves), and the three commands exactly as an
 * operator runs them, handed their target through the environment under the
 * names `scripts/backup/lib/env.mjs` gives — never as arguments, never as
 * literals in this file.
 */

export const ROOT = process.cwd()
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** @param {string} url @param {string} what */
export function requireLoopback(url, what) {
  const host = new URL(url).hostname
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`The launch drill only ever runs against a loopback stack; ${what} is "${host}".`)
  }
}

/**
 * @typedef {{ code: number | null, output: string }} Run
 */

/**
 * Run a process to completion. `shell: true` is used only for the npm/npx
 * invocations, whose whole command line is a fixed literal.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{ input?: string, env?: NodeJS.ProcessEnv, shell?: boolean }} [options]
 * @returns {Promise<Run>}
 */
export function runProcess(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.shell ? [file, ...args].join(' ') : file, options.shell ? [] : args, {
      cwd: ROOT,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    /** @type {Buffer[]} */
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output: Buffer.concat(chunks).toString('utf8') }))
    child.stdin.end(options.input ?? '')
  })
}

/**
 * The local stack, from the environment and the CLI — loopback by construction.
 *
 * @returns {Promise<{ dbUrl: string, apiUrl: string, anonKey: string, serviceRoleKey: string, dbContainer: string, apiHost: string, dbHost: string }>}
 */
export async function localStack() {
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env[NAMES.serviceRoleKey]
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error('The launch drill needs the local Supabase URL, anon key and service-role key (.env.local).')
  }
  requireLoopback(apiUrl, 'the API URL')

  const config = await readFile(join(ROOT, 'supabase', 'config.toml'), 'utf8')
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1]
  if (!projectId) throw new Error('supabase/config.toml names no project_id.')

  let dbUrl = process.env[NAMES.dbUrl]
  if (!dbUrl) {
    const status = await runProcess('npx', ['supabase', 'status', '-o', 'env'], { shell: true })
    dbUrl = /^DB_URL="?([^"\r\n]+)"?/m.exec(status.output)?.[1]
  }
  if (!dbUrl) throw new Error('Could not determine the local database URL (supabase status).')
  requireLoopback(dbUrl, 'the database host')

  return {
    dbUrl,
    apiUrl,
    anonKey,
    serviceRoleKey,
    dbContainer: `supabase_db_${projectId}`,
    apiHost: new URL(apiUrl).hostname,
    dbHost: new URL(dbUrl).hostname,
  }
}

/**
 * SQL as the database superuser through the local container. Used only to
 * manufacture the states the commands refuse to produce (an Owner-less
 * application, empty content tables) and to inspect what they did.
 *
 * @param {string} container @param {string} text
 */
export async function sql(container, text) {
  const result = await runProcess(
    'docker',
    ['exec', '--interactive', container, 'psql', '--username', 'postgres', '--dbname', 'postgres', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--file', '-'],
    { input: text },
  )
  if (result.code !== 0) throw new Error(`psql failed: ${result.output}`)
  return result.output.trim()
}

/**
 * One launch command, exactly as an operator runs it: the script by path, the
 * target and the confirmation in the environment.
 *
 * @param {'migrate.mjs' | 'load-content.mjs' | 'bootstrap-owner.mjs'} script
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<Run>}
 */
export function launch(script, args, env) {
  const clean = { ...process.env }
  // A stray confirmation or target in the developer's shell must not leak into a story.
  for (const name of [NAMES.dbUrl, NAMES.bootstrapConfirmHost, NAMES.contentLoadConfirmHost, NAMES.migrateConfirmHost]) delete clean[name]
  return runProcess(process.execPath, [join(ROOT, 'scripts', 'launch', script), ...args], { env: { ...clean, ...env } })
}

/** `npm run db:reset:full` — the seeded state, and the two local identities. */
export async function resetStack() {
  const result = await runProcess('npm', ['run', 'db:reset:full'], { shell: true })
  if (result.code !== 0) throw new Error(`npm run db:reset:full failed:\n${result.output.slice(-2000)}`)
}

export { NAMES }
