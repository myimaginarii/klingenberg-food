import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The public site's JavaScript budget, asserted rather than assumed — technical plan
 * §1 (adjustment 2), §2, §8, §12.
 *
 * Four promises are made about what the public half of this site is allowed to contain,
 * and every one of them is the sort of thing that decays quietly under a deadline. They
 * are checked here, over the real source tree, so a future change that breaks one fails
 * a test instead of shipping.
 *
 *   1. **No browser Supabase client.** "Reads: server-side only" — the browser never
 *      holds a Supabase client, a token or a key.
 *   2. **The read layer stays on the server.** Nothing marked `'use client'` may reach
 *      the content loaders, which is also enforced at build time by `server-only`.
 *   3. **Client components are the exception, not the rule.** The plan names the small
 *      set that may exist; a new one is a decision, not an accident.
 *   4. **No analytics, tag manager, state-management or client data-fetching library**
 *      is a dependency of this project.
 */
const ROOT = process.cwd()
const SOURCE_DIRECTORIES = ['app', 'components', 'lib']
const SOURCE_FILES_AT_ROOT = ['proxy.ts', 'next.config.ts']

/** The three modules allowed to construct a Supabase client, and no others (§1, §8). */
const SUPABASE_OWNERS = ['lib/supabase/server.ts', 'lib/supabase/service.ts', 'proxy.ts']

/**
 * The client components the plan allows on the public site, with the reason each one
 * cannot be a Server Component. Adding a file here should require the same argument.
 */
const ALLOWED_PUBLIC_CLIENT_COMPONENTS = new Map([
  ['components/site/OpenStatus.tsx', 'recomputes the open/closed badge every minute (§7a)'],
  ['components/site/layout/NavLink.tsx', 'a layout cannot read the pathname'],
])

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

const sourceFiles: SourceFile[] = [
  ...SOURCE_DIRECTORIES.flatMap((directory) => [...walk(join(ROOT, directory))].map(read)),
  ...SOURCE_FILES_AT_ROOT.map((file) => read(join(ROOT, file))),
]

/**
 * Does this file import a Supabase package as a *value*?
 *
 * A type-only import compiles to nothing and cannot put a client in a bundle, so
 * `import type { PostgrestError }` in the read layer is not a violation, while an
 * import of `createClient` anywhere outside the owning modules would be. The source
 * here is written without semicolons, so an import statement is matched whole rather
 * than by scanning forward to the next `;`.
 */
function importsSupabaseAsValue(source: string): boolean {
  // An import statement runs from `import` to its module specifier, which is the first
  // quoted string in it — there are no other quotes inside one.
  for (const [statement] of source.matchAll(/^import\b[\s\S]*?'[^']+'/gm)) {
    if (!statement.includes("'@supabase/")) continue
    if (/^import\s+type\b/.test(statement)) continue
    return true
  }

  return false
}

const clientFiles = sourceFiles.filter((file) => /^\s*['"]use client['"]/m.test(file.source))

describe('the public site ships no Supabase client to the browser', () => {
  it('finds source files to check at all', () => {
    expect(sourceFiles.length).toBeGreaterThan(20)
  })

  it('imports @supabase/* as a value only from the modules that own it', () => {
    const importers = sourceFiles
      .filter((file) => importsSupabaseAsValue(file.source))
      .map((file) => file.path)

    expect(importers.sort()).toEqual([...SUPABASE_OWNERS].sort())
  })

  it('never imports Supabase from a client component', () => {
    const offenders = clientFiles
      .filter((file) => file.source.includes('@supabase/'))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('never reaches the content read layer from a client component', () => {
    const offenders = clientFiles
      .filter((file) => /from '@\/lib\/(content|supabase|env)\//.test(file.source))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('has no browser Supabase client module at all', () => {
    expect(sourceFiles.map((file) => file.path)).not.toContain('lib/supabase/client.ts')
    expect(sourceFiles.some((file) => file.source.includes('createBrowserClient'))).toBe(false)
  })
})

describe('client components stay the documented exception', () => {
  it('is exactly the set the plan allows outside the administration', () => {
    // The budget is the *public* site's. §7e (item 11) is explicit that "the admin may
    // require JavaScript", so both halves of the administration are outside this rule:
    // its routes, and the components only its routes render. `components/site/` — the
    // public half — stays fully covered, which is what makes the assertion meaningful.
    const publicClientFiles = clientFiles
      .map((file) => file.path)
      .filter((path) => !path.startsWith('app/(admin)/') && !path.startsWith('components/admin/'))
      .sort()

    expect(publicClientFiles).toEqual([...ALLOWED_PUBLIC_CLIENT_COMPONENTS.keys()].sort())
  })

  /**
   * The dependency direction the codebase states in prose, asserted.
   *
   * `components/admin/Notice.tsx` puts it plainly: "a component in `components/`
   * importing from `app/` would be the dependency the wrong way round". It is why
   * `DishEditorPanel` takes `fieldNames` as a prop instead of importing `DISH_FORM`,
   * and why the availability control takes its action and its field names together.
   * A rule that only lives in a comment is a rule that gets broken by the next person
   * who needs one constant.
   */
  it('never imports from app/ into components/', () => {
    const offenders = sourceFiles
      .filter((file) => file.path.startsWith('components/'))
      .filter((file) => /from '@\/app\//.test(file.source))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('does not fetch or poll from the browser', () => {
    for (const file of clientFiles) {
      expect(file.source, `${file.path} performs a network request`).not.toMatch(
        /\bfetch\(|XMLHttpRequest|EventSource|new WebSocket/,
      )
    }
  })
})

describe('the dependency surface stays as small as the plan requires', () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }

  const everyDependency = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  })

  /** Everything §1 (adjustment 4) and §12 rule out, by the name it would arrive under. */
  const FORBIDDEN = [
    // analytics, tag managers and session recording (§12)
    '@vercel/analytics',
    '@vercel/speed-insights',
    'plausible-tracker',
    'react-ga',
    'react-ga4',
    'posthog-js',
    'mixpanel-browser',
    '@sentry/browser',
    '@sentry/react',
    // state management (§1)
    'redux',
    '@reduxjs/toolkit',
    'zustand',
    'jotai',
    'mobx',
    'recoil',
    // client data fetching (§1)
    'swr',
    '@tanstack/react-query',
    'react-query',
    'axios',
    'apollo-client',
    '@apollo/client',
    // map libraries and runtime tile providers (§7g)
    'leaflet',
    'react-leaflet',
    'mapbox-gl',
    'maplibre-gl',
    '@googlemaps/js-api-loader',
    // date libraries — the tested Intl helper stands (§1)
    'moment',
    'dayjs',
    'date-fns',
    'luxon',
    // drag-and-drop and sortable-list frameworks (§1, adjustment 4; phase 5E)
    //
    // Phase 5E's reorder is a handle, two submit buttons and about a hundred lines of
    // Pointer Events, because that is what the approved design actually needs: one list,
    // one axis, no cross-container drags, and a server that owns the order either way.
    // Every library below solves a much larger problem and brings its own accessibility
    // model, which would then have to be reconciled with the keyboard and no-JavaScript
    // paths the brief requires rather than replacing them.
    '@dnd-kit/core',
    '@dnd-kit/sortable',
    'react-beautiful-dnd',
    '@hello-pangea/dnd',
    'react-dnd',
    'react-sortable-hoc',
    'sortablejs',
    'react-sortablejs',
    'dragula',
    'react-draggable',
    // component libraries and headless CMSes (§1)
    'bootstrap',
    '@mui/material',
    'antd',
    'chakra-ui',
    'contentful',
    '@sanity/client',
  ]

  it.each(FORBIDDEN)('does not depend on %s', (name) => {
    expect(everyDependency).not.toContain(name)
  })
})
