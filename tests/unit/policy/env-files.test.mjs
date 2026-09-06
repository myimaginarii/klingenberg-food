import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { NAMES } from '../../../scripts/backup/lib/env.mjs'

/**
 * Two environment files, never one — technical plan §8, §10e; 2026-09-06.
 *
 * The local stack and the production project are reached by different commands
 * reading different git-ignored files, and this suite holds that boundary over
 * the real `package.json`, `.gitignore` and `.env.example`:
 *
 *   1. **Every production command loads `.env.production.local`, and only it.**
 *      The three launch commands and the two production backup commands. An
 *      operator does not export a connection string in each terminal, and a
 *      production run never inherits the local stack.
 *   2. **Every local command loads `.env.local`, and only it.** Development, the
 *      seeder, and the local backup and restore keep working exactly as before.
 *   3. **No command loads both.** That mixture is the failure this separation
 *      exists to prevent.
 *   4. **Both files are git-ignored; `.env.example` is not.**
 *   5. **`.env.example` carries names, never values**, documents which file each
 *      belongs in, and states the session-pooler port.
 *   6. **The confirmations stay per-operation.** They are documented as belonging
 *      in neither file, and `package.json` bakes none of them — nor a `--force` —
 *      into a command.
 *   7. **Node loads the files**; no dotenv dependency was introduced.
 *
 * Variable names come from `scripts/backup/lib/env.mjs` rather than as literals,
 * the rule the whole tooling follows (§10e).
 */

const ROOT = process.cwd()
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
/** @type {Record<string, string>} */
const scripts = packageJson.scripts
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8')

const LOCAL_FILE = '.env.local'
const PRODUCTION_FILE = '.env.production.local'
/** @param {string} file */
const loads = (file) => `--env-file-if-exists=${file}`

const PRODUCTION_COMMANDS = [
  'launch:migrate',
  'launch:load-content',
  'launch:bootstrap-owner',
  'backup:production',
  'backup:restore:production',
]
const LOCAL_COMMANDS = ['db:users', 'backup', 'backup:restore']

describe('the production commands read the production file', () => {
  it('every one of them loads it, by name', () => {
    for (const name of PRODUCTION_COMMANDS) {
      expect(scripts[name], `${name} is missing`).toBeDefined()
      expect(scripts[name], name).toContain(loads(PRODUCTION_FILE))
    }
  })

  it('none of them also loads the local stack', () => {
    for (const name of PRODUCTION_COMMANDS) {
      expect(scripts[name], name).not.toContain(loads(LOCAL_FILE))
    }
  })

  it('they are the launch tools and the production backup pair, and nothing else', () => {
    const readers = Object.entries(scripts)
      .filter(([, command]) => command.includes(loads(PRODUCTION_FILE)))
      .map(([name]) => name)
      .sort()
    expect(readers).toEqual([...PRODUCTION_COMMANDS].sort())
  })
})

describe('the local commands are untouched', () => {
  it('still load the local file, and never the production one', () => {
    for (const name of LOCAL_COMMANDS) {
      expect(scripts[name], `${name} is missing`).toBeDefined()
      expect(scripts[name], name).toContain(loads(LOCAL_FILE))
      expect(scripts[name], name).not.toContain(loads(PRODUCTION_FILE))
    }
  })

  it('the two backup pairs are one script each, reached through two environments', () => {
    expect(scripts['backup']).toContain('scripts/backup/backup.mjs')
    expect(scripts['backup:production']).toContain('scripts/backup/backup.mjs')
    expect(scripts['backup:restore']).toContain('scripts/backup/restore.mjs')
    expect(scripts['backup:restore:production']).toContain('scripts/backup/restore.mjs')
  })

  it('no command loads both files', () => {
    for (const [name, command] of Object.entries(scripts)) {
      const both = command.includes(loads(LOCAL_FILE)) && command.includes(loads(PRODUCTION_FILE))
      expect(both, `${name} loads both environments`).toBe(false)
    }
  })
})

describe('neither file is committable', () => {
  const gitAvailable = existsSync(join(ROOT, '.git'))

  /** @param {string} path */
  function ignored(path) {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT, stdio: 'ignore' })
      return true
    } catch (error) {
      if (/** @type {any} */ (error).status === 1) return false
      throw error
    }
  }

  it.runIf(gitAvailable)('git ignores both environment files and keeps the template', () => {
    expect(ignored(PRODUCTION_FILE)).toBe(true)
    expect(ignored(LOCAL_FILE)).toBe(true)
    expect(ignored('.env.example')).toBe(false)
  })

  it.runIf(gitAvailable)('neither file is in the tree', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    expect(tracked).not.toContain(PRODUCTION_FILE)
    expect(tracked).not.toContain(LOCAL_FILE)
    expect(tracked).toContain('.env.example')
  })

  it('the ignore rules name both files in prose, so the pair is discoverable', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toContain(PRODUCTION_FILE)
    expect(gitignore).toContain(LOCAL_FILE)
    expect(gitignore).toMatch(/^\.env\.\*$/m)
  })
})

describe('the template', () => {
  it('carries names only — every variable line is an empty assignment', () => {
    const assignments = envExample
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
    expect(assignments.length).toBeGreaterThan(15)
    for (const line of assignments) {
      expect(line, line).toMatch(/^[A-Z0-9_]+=$/)
    }
  })

  it('says which file each environment belongs in', () => {
    expect(envExample).toContain(PRODUCTION_FILE)
    expect(envExample).toContain(LOCAL_FILE)
    for (const name of PRODUCTION_COMMANDS) expect(envExample, name).toContain(`npm run ${name}`)
  })

  it('shows the production database placeholder and the session-pooler port', () => {
    expect(envExample).toContain(`${NAMES.dbUrl}="<PRIVATE SESSION POOLER URI>"`)
    expect(envExample).toMatch(/PORT 5432/)
    expect(envExample).toMatch(/transaction pooler \(6543\)/)
  })
})

describe('the confirmations stay per-operation', () => {
  const confirmations = [NAMES.migrateConfirmHost, NAMES.contentLoadConfirmHost, NAMES.bootstrapConfirmHost]

  it('are documented as belonging in no environment file', () => {
    for (const name of confirmations) expect(envExample).toContain(name)
    expect(envExample).toContain(`THESE THREE DO NOT BELONG IN \`${PRODUCTION_FILE}\``)
  })

  it('are never baked into a command, and no command carries a force flag', () => {
    for (const [name, command] of Object.entries(scripts)) {
      for (const confirmation of [...confirmations, NAMES.restoreConfirmHost]) {
        expect(command, `${name} pre-confirms ${confirmation}`).not.toContain(confirmation)
      }
      expect(command, name).not.toMatch(/--force|--yes|--allow-remote/)
    }
  })
})

describe('the loading is Node’s own', () => {
  it('no dotenv dependency was introduced', () => {
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
    expect(Object.keys(dependencies).filter((name) => /dotenv/.test(name))).toEqual([])
  })
})
