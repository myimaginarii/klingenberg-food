import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The launch-tooling boundary — technical plan §5, §8, §10a, §10b; phase 14A.
 *
 * Held over the real source tree, in the family of `accounts-boundary.test.ts`:
 *
 *   1. **The launch tools are outside the runtime import graph.** Nothing under
 *      `app/`, `components/` or `lib/` imports from `scripts/`, and the map
 *      launch guard is reached from `next.config.ts` alone.
 *   2. **Migration ≠ content load ≠ Owner bootstrap.** Three scripts, none
 *      importing another, none naming another's subject: the migration door
 *      knows no seed file, no profile and no invitation; the loader knows no
 *      migration directory and no identity; the bootstrap knows no seed and no
 *      migration.
 *   3. **The development seeder cannot become a production path.** Nothing
 *      imports `scripts/seed-local-users.mjs`; it keeps its loopback guard; no
 *      launch tool and no workflow names it or the development seed file.
 *   4. **The confirmed content source is confirmed content only.** With comments
 *      stripped, `supabase/seed/confirmed.sql` writes the contact row, the week
 *      and the menu, and carries no `@example.test`, no placeholder, no News, no
 *      page document, no weekly placeholder, no profile and no uuid literal.
 *      The development layer holds those, and `supabase/config.toml` runs the
 *      two in that order for the local reset. The old single file is gone.
 *   5. **The service role has one launch-side holder** — the bootstrap — and the
 *      two database tools never import the Supabase client at all.
 *   6. **The production workflow is dispatch-only in 14A** and runs the migration
 *      door and nothing else; no workflow runs the loader or the bootstrap.
 */

const ROOT = process.cwd()

function* walk(directory: string, extensions: RegExp): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full, extensions)
    } else if (extensions.test(full)) {
      yield full
    }
  }
}

type SourceFile = { path: string; source: string }

function read(absolute: string): SourceFile {
  return { path: relative(ROOT, absolute).split(sep).join('/'), source: readFileSync(absolute, 'utf8') }
}

/** Strip JS comments, so a boundary documented in prose does not trip its own test. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Strip SQL comments the same way. */
function sqlOf(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

/** Strip YAML comments the same way. */
function yamlOf(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n')
}

const runtimeFiles = ['app', 'components', 'lib'].flatMap((d) => [...walk(join(ROOT, d), /\.tsx?$/)].map(read))
const launchFiles = [...walk(join(ROOT, 'scripts', 'launch'), /\.mjs$/)].map(read)
const scriptFiles = [...walk(join(ROOT, 'scripts'), /\.mjs$/)].map(read)
const workflowFiles = [...walk(join(ROOT, '.github', 'workflows'), /\.ya?ml$/)].map(read)
const testFiles = [...walk(join(ROOT, 'tests'), /\.(m?ts|mjs)$/)].map(read)

const launchScript = (name: string) => launchFiles.find((f) => f.path === `scripts/launch/${name}`)!

describe('the launch tools sit outside the runtime', () => {
  it('found the trees it polices', () => {
    expect(runtimeFiles.length).toBeGreaterThan(50)
    expect(launchFiles.map((f) => f.path).sort()).toEqual([
      'scripts/launch/bootstrap-owner.mjs',
      'scripts/launch/lib/bundle.mjs',
      'scripts/launch/lib/content.mjs',
      'scripts/launch/lib/migrations.mjs',
      'scripts/launch/lib/owner-state.mjs',
      'scripts/launch/lib/target.mjs',
      'scripts/launch/load-content.mjs',
      'scripts/launch/migrate.mjs',
    ])
  })

  it('nothing under app/, components/ or lib/ imports from scripts/', () => {
    const importers = runtimeFiles.filter((f) => /from\s+['"][^'"]*scripts\//.test(codeOf(f.source))).map((f) => f.path)
    expect(importers).toEqual([])
  })

  it('the map launch guard is reached from next.config.ts alone, and reads the one descriptor', () => {
    const importers = runtimeFiles.filter((f) => /map-launch-guard/.test(codeOf(f.source))).map((f) => f.path)
    expect(importers).toEqual([])
    const config = codeOf(readFileSync(join(ROOT, 'next.config.ts'), 'utf8'))
    expect(config).toMatch(/assertLaunchMapProvenance\(\)/)
    expect(config).toMatch(/PHASE_PRODUCTION_BUILD/)
    const staticMap = codeOf(readFileSync(join(ROOT, 'components/site/StaticMap.tsx'), 'utf8'))
    expect(staticMap).toContain("from '@/lib/site/map-asset'")
    expect(staticMap).not.toMatch(/src:\s*'\/map\//)
  })
})

describe('migration ≠ content load ≠ Owner bootstrap', () => {
  const migrate = codeOf(launchScript('migrate.mjs').source) + codeOf(launchScript('lib/migrations.mjs').source)
  const load = codeOf(launchScript('load-content.mjs').source) + codeOf(launchScript('lib/content.mjs').source)
  const bootstrap = codeOf(launchScript('bootstrap-owner.mjs').source) + codeOf(launchScript('lib/owner-state.mjs').source)

  it('no launch script imports another', () => {
    for (const script of ['bootstrap-owner.mjs', 'load-content.mjs', 'migrate.mjs']) {
      const code = codeOf(launchScript(script).source)
      for (const other of ['bootstrap-owner', 'load-content', 'migrate.mjs', 'lib/owner-state', 'lib/content', 'lib/migrations']) {
        if (script.startsWith(other.replace('lib/', '').replace('.mjs', ''))) continue
        if (script === 'bootstrap-owner.mjs' && other === 'lib/owner-state') continue
        if (script === 'load-content.mjs' && other === 'lib/content') continue
        if (script === 'migrate.mjs' && other === 'lib/migrations') continue
        expect(code, `${script} reaches ${other}`).not.toMatch(new RegExp(`from '[^']*${other}`))
      }
    }
  })

  it('the migration door knows no seed, no profile, no identity', () => {
    expect(migrate).not.toMatch(/seed[./-]/i)
    expect(migrate).not.toMatch(/profiles|inviteUserByEmail|auth\.admin|supabase-js/)
    expect(migrate).toContain("'supabase', 'migrations'")
  })

  it('the loader knows no migration directory, no identity, and one constant file', () => {
    expect(load).not.toMatch(/migrations/)
    expect(load).not.toMatch(/profiles|inviteUserByEmail|auth\.admin|supabase-js/)
    expect(load).not.toMatch(/development\.sql|seed-local-users/)
    expect(load).toContain("'supabase/seed/confirmed.sql'")
    expect(load).not.toMatch(/readdir|glob/)
  })

  it('the bootstrap knows no seed file and no migration, and never updates a profile', () => {
    expect(bootstrap).not.toMatch(/seed[./-]/i)
    expect(bootstrap).not.toMatch(/migrations/)
    expect(bootstrap).not.toMatch(/\.upsert\(|\.update\(|\.delete\(|deleteUser|generateLink|createUser\(/)
    expect(bootstrap).toMatch(/\.from\('profiles'\)\.insert\(/)
    expect(bootstrap).toMatch(/role: 'owner'/)
    // No password is generated, set or passed: the word appears only in the operator's next-step sentence.
    expect(bootstrap).not.toMatch(/password\s*[:=]|randomBytes|randomUUID/i)
  })

  it('the database tools never hold the service-role key; the bootstrap is the one launch-side client', () => {
    const clients = launchFiles.filter((f) => /createClient\(/.test(codeOf(f.source))).map((f) => f.path)
    expect(clients).toEqual(['scripts/launch/bootstrap-owner.mjs'])
    expect(codeOf(launchScript('migrate.mjs').source)).toMatch(/readDatabase\(/)
    expect(codeOf(launchScript('load-content.mjs').source)).toMatch(/readDatabase\(/)
    expect(codeOf(launchScript('bootstrap-owner.mjs').source)).toMatch(/readApiProject\(/)
    expect(codeOf(launchScript('bootstrap-owner.mjs').source)).not.toMatch(/readDatabase|readProject\(/)
  })

  it('every launch tool confirms its target through the shared guard, with its own variable', () => {
    for (const [script, name] of [
      ['migrate.mjs', 'migrateConfirmHost'],
      ['load-content.mjs', 'contentLoadConfirmHost'],
      ['bootstrap-owner.mjs', 'bootstrapConfirmHost'],
    ]) {
      const code = codeOf(launchScript(script!).source)
      expect(code, script).toMatch(/assessLaunchTarget\(/)
      expect(code, script).toContain(`NAMES.${name}`)
      // The confirmation names the target host; a `--force` or `--yes` does not exist.
      expect(code, script).not.toMatch(/--force|--yes|allow-remote/)
    }
  })
})

describe('the development seeder stays a development seeder', () => {
  it('is imported by nothing and keeps its loopback guard', () => {
    const importers = [...scriptFiles, ...runtimeFiles, ...testFiles]
      .filter((f) => /(from|import)\s*\(?\s*['"][^'"]*seed-local-users/.test(codeOf(f.source)))
      .map((f) => f.path)
    expect(importers).toEqual([])
    const seeder = codeOf(readFileSync(join(ROOT, 'scripts/seed-local-users.mjs'), 'utf8'))
    expect(seeder).toMatch(/LOOPBACK_HOSTS/)
    expect(seeder).toContain("'owner@example.test'")
  })

  it('no launch tool and no workflow names the seeder or the development layer', () => {
    for (const file of launchFiles) {
      expect(codeOf(file.source), file.path).not.toMatch(/seed-local-users|seed\/development\.sql/)
    }
    for (const file of workflowFiles) {
      expect(yamlOf(file.source), file.path).not.toMatch(/seed-local-users|seed\/development\.sql/)
    }
  })
})

describe('the confirmed content source', () => {
  const confirmed = sqlOf(readFileSync(join(ROOT, 'supabase/seed/confirmed.sql'), 'utf8'))
  const development = sqlOf(readFileSync(join(ROOT, 'supabase/seed/development.sql'), 'utf8'))

  it('writes exactly the confirmed tables', () => {
    expect(confirmed).toMatch(/update public\.site_contact/)
    expect(confirmed).toMatch(/update public\.opening_hours/)
    expect(confirmed).toMatch(/insert into public\.menu_categories/)
    expect(confirmed).toMatch(/insert into public\.dishes/)
    const tables = [...confirmed.matchAll(/(?:insert into|update)\s+public\.([a-z_]+)/g)].map((m) => m[1])
    expect(new Set(tables)).toEqual(new Set(['site_contact', 'opening_hours', 'menu_categories', 'dishes']))
  })

  it('carries no development marker', () => {
    expect(confirmed).not.toMatch(/@example\.test/i)
    expect(confirmed).not.toMatch(/placeholder/i)
    expect(confirmed).not.toMatch(/Testret/)
    expect(confirmed).not.toMatch(/public\.(news|pages|weekly_special|monthly_burger|announcement|profiles|audit_log|images|opening_hours_overrides)/)
    expect(confirmed).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(confirmed).not.toMatch(/auth\./)
  })

  it('the development layer holds the placeholders and none of the confirmed tables', () => {
    expect(development).toMatch(/update public\.weekly_special/)
    expect(development).toMatch(/update public\.pages/)
    expect(development).toMatch(/insert into public\.news/)
    expect(development).toMatch(/placeholder/i)
    expect(development).not.toMatch(/insert into public\.(menu_categories|dishes)/)
    expect(development).not.toMatch(/update public\.(site_contact|opening_hours)\b/)
  })

  it('the local reset runs confirmed first, then development, and the old single file is gone', () => {
    const config = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8')
    expect(config).toMatch(/sql_paths = \["\.\/seed\/confirmed\.sql", "\.\/seed\/development\.sql"\]/)
    expect(existsSync(join(ROOT, 'supabase/seed.sql'))).toBe(false)
    expect(existsSync(join(ROOT, 'supabase/seed/confirmed.sql'))).toBe(true)
    expect(existsSync(join(ROOT, 'supabase/seed/development.sql'))).toBe(true)
  })
})

describe('the production workflow', () => {
  const workflow = workflowFiles.find((f) => f.path === '.github/workflows/production-migrate.yml')!

  it('exists, is dispatch-only in 14A, and runs the migration door alone', () => {
    expect(workflow).toBeDefined()
    const yaml = yamlOf(workflow.source)
    const triggers = /^on:\n((?:[ \t]+.*\n)+)/m.exec(yaml)?.[1] ?? ''
    expect(triggers).toMatch(/workflow_dispatch/)
    expect(triggers).not.toMatch(/push|pull_request|schedule/)
    expect(yaml).toMatch(/environment: production/)
    expect(yaml).toMatch(/run: node scripts\/launch\/migrate\.mjs/)
    expect(yaml).not.toMatch(/load-content|bootstrap-owner|db reset|seed/i)
  })

  it('no workflow runs the loader or the bootstrap', () => {
    for (const file of workflowFiles) {
      expect(yamlOf(file.source), file.path).not.toMatch(/load-content\.mjs|bootstrap-owner\.mjs|launch:load-content|launch:bootstrap-owner/)
    }
  })
})
