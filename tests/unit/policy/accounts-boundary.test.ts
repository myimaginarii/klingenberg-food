import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The user-administration boundary — technical plan §1 (adjustment 2), §5, §8;
 * phase 11C (brief §35).
 *
 * Held over the real source tree, in the family of `images-boundary.test.ts`:
 *
 *   1. **The Auth Admin API has one caller.** `auth.admin.` appears in exactly one
 *      runtime module, `lib/accounts/auth-admin.ts`, which imports `server-only`
 *      and exposes three capabilities — never the client.
 *   2. **The account server modules never reach a client bundle.** No file marked
 *      `'use client'` imports them, and nothing under the user administration is a
 *      client component at all.
 *   3. **`profiles` is never written directly by the application.** The one
 *      `.from('profiles')` in `app/`, `components/` and `lib/` is the phase-1
 *      session read; every write goes through the three transitions by name.
 *   4. **The form vocabulary is exactly five names**, none of them a password, a
 *      token, an actor, a ban or a metadata blob, and no form control anywhere
 *      submits one either.
 *   5. **The browser never names the actor.** No account action reads a user id
 *      from the form to decide who is acting; the target is read, the actor is
 *      `requireOwner()`'s.
 *   6. **Deletion is not a capability.** No runtime module calls `deleteUser`.
 */

const ROOT = process.cwd()
const SOURCE_DIRECTORIES = ['app', 'components', 'lib']

const AUTH_ADMIN_MODULE = 'lib/accounts/auth-admin.ts'
const ACCOUNT_SERVER_MODULES = ['@/lib/accounts/auth-admin', '@/lib/accounts/admin']
const PROFILE_READERS = ['lib/auth/session.ts']
const ACCOUNT_TRANSITIONS = ['create_account_profile', 'set_account_role', 'set_account_active']

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (/\.tsx?$/.test(full)) {
      yield full
    }
  }
}

type SourceFile = { path: string; source: string }

function read(absolute: string): SourceFile {
  return {
    path: relative(ROOT, absolute).split(sep).join('/'),
    source: readFileSync(absolute, 'utf8'),
  }
}

/** Strip comments, so a boundary documented in prose does not trip its own test. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const sourceFiles: SourceFile[] = SOURCE_DIRECTORIES.flatMap((directory) =>
  [...walk(join(ROOT, directory))].map(read),
)

const clientFiles = sourceFiles.filter((file) => /^\s*['"]use client['"]/m.test(file.source))

const accountFiles = sourceFiles.filter(
  (file) =>
    file.path.startsWith('app/(admin)/admin/brugere/') ||
    file.path.startsWith('components/admin/users/') ||
    file.path.startsWith('lib/accounts/'),
)

describe('the Auth Admin boundary', () => {
  it('found the tree it polices', () => {
    expect(sourceFiles.length).toBeGreaterThan(20)
    expect(accountFiles.length).toBeGreaterThan(5)
  })

  it('exactly one runtime module calls the Auth Admin API', () => {
    const callers = sourceFiles
      .filter((file) => /\.auth\.admin\./.test(codeOf(file.source)))
      .map((file) => file.path)

    expect(callers).toEqual([AUTH_ADMIN_MODULE])
  })

  it('that module is server-only and exposes capabilities, never the client', () => {
    const found = sourceFiles.find((file) => file.path === AUTH_ADMIN_MODULE)
    expect(found).toBeDefined()
    const code = codeOf(found!.source)

    expect(code).toMatch(/^\s*import 'server-only'/m)
    // The three capabilities, and no return of the client itself.
    expect(code).toContain('inviteByEmail')
    expect(code).toContain('findByEmail')
    expect(code).toContain('setBanned')
    expect(code).not.toMatch(/return service\b/)
    expect(code).not.toMatch(/client:\s*service/)
  })

  it('the account orchestration module is server-only too', () => {
    const found = sourceFiles.find((file) => file.path === 'lib/accounts/admin.ts')
    expect(found).toBeDefined()
    expect(codeOf(found!.source)).toMatch(/^\s*import 'server-only'/m)
  })

  it('no client component reaches an account server module', () => {
    for (const file of clientFiles) {
      for (const specifier of ACCOUNT_SERVER_MODULES) {
        expect(file.source, `${file.path} imports ${specifier}`).not.toContain(specifier)
      }
    }
  })

  it('nothing in the user administration is a client component', () => {
    const clients = accountFiles.filter((file) => clientFiles.includes(file)).map((file) => file.path)
    expect(clients).toEqual([])
  })

  it('deletion is not a capability of the application', () => {
    const deleters = sourceFiles
      .filter((file) => /deleteUser|\.from\('profiles'\)\s*\.delete/.test(codeOf(file.source)))
      .map((file) => file.path)

    expect(deleters).toEqual([])
  })

  it('no generic privileged helper is exported for the browser or the pages', () => {
    // The service client's own module stays the only place that constructs one, and
    // the Auth Admin module is its only account-side importer.
    const importers = sourceFiles
      .filter((file) => /from '@\/lib\/supabase\/service'/.test(codeOf(file.source)))
      .filter((file) => file.path.startsWith('lib/accounts/') || file.path.startsWith('app/') || file.path.startsWith('components/'))
      .map((file) => file.path)

    expect(importers).toEqual([AUTH_ADMIN_MODULE])
  })
})

describe('profiles are written only through the transitions', () => {
  it('the one direct read of profiles is the session read', () => {
    const readers = sourceFiles
      .filter((file) => /\.from\('profiles'\)/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()

    expect(readers).toEqual(PROFILE_READERS)
  })

  it('no runtime module updates or inserts a profile row directly', () => {
    const writers = sourceFiles
      .filter((file) => /\.from\('profiles'\)[\s\S]{0,80}\.(update|insert|upsert|delete)\(/.test(codeOf(file.source)))
      .map((file) => file.path)

    expect(writers).toEqual([])
  })

  it('the three transitions are called from exactly one module', () => {
    for (const transition of ACCOUNT_TRANSITIONS) {
      const callers = sourceFiles
        .filter((file) => new RegExp(`rpc\\('${transition}'`).test(codeOf(file.source)))
        .map((file) => file.path)

      expect(callers, transition).toEqual(['lib/accounts/admin.ts'])
    }
  })
})

describe('the form vocabulary and the actor', () => {
  it('is exactly the five names (§35)', async () => {
    const { USERS_FORM } = await import('@/app/(admin)/admin/brugere/forms')

    expect(Object.values(USERS_FORM).sort()).toEqual(['bruger', 'email', 'navn', 'rolle', 'version'])
  })

  it('no form control anywhere submits a password, a token, an actor, a ban or metadata', () => {
    const offenders = sourceFiles
      .filter((file) =>
        /name=["'](password|adgangskode|token|token_hash|actor|actor_id|aktoer|ban|ban_duration|banned_until|user_metadata|app_metadata|service_role)["']/.test(
          codeOf(file.source),
        ),
      )
      // The two phase-1 password forms are the person's *own* password, on the
      // login and the new-password screens — never an account being administered.
      .filter((file) => !['app/(admin)/admin/login/page.tsx', 'app/(admin)/admin/ny-adgangskode/page.tsx'].includes(file.path))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('the user administration renders no password field and no Auth secret', () => {
    for (const file of accountFiles) {
      const code = codeOf(file.source)
      expect(code, file.path).not.toMatch(/type=["']password["']/)
      // The service key is read by name nowhere (lib/env/server.ts is its one door,
      // and the policy script pins the name); the capability is asked for only in
      // the Auth Admin module, and so is the ban.
      if (file.path === AUTH_ADMIN_MODULE) continue
      expect(code, file.path).not.toMatch(/getServiceRoleKey|createSupabaseServiceClient|service_role|ban_duration/)
    }
    const authAdmin = sourceFiles.find((file) => file.path === AUTH_ADMIN_MODULE)!
    expect(codeOf(authAdmin.source)).toContain('ban_duration')
    expect(codeOf(authAdmin.source)).not.toMatch(/getServiceRoleKey/)
  })

  it('the actions take the actor from the session, never from the form', () => {
    const actions = accountFiles.filter((file) => /^\s*['"]use server['"]/m.test(file.source))
    expect(actions.map((file) => file.path).sort()).toEqual([
      'app/(admin)/admin/brugere/account-actions.ts',
      'app/(admin)/admin/brugere/invite-actions.ts',
    ])

    for (const action of actions) {
      const code = codeOf(action.source)
      expect(code, action.path).toContain('requireOwner()')
      expect(code, action.path).not.toMatch(/formData\.get\(['"](actor|actor_id|aktoer)['"]\)/)
      // The target id is read through the strict target parser, never raw.
      expect(code, action.path).not.toMatch(/formData\.get\(USERS_FORM\.user\)/)
    }
  })
})
