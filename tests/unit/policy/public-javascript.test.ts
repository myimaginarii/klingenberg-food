import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The public site's JavaScript budget, asserted rather than assumed — technical plan
 * §1 (adjustment 2), §2, §8, §12.
 *
 * Four promises are made about what this site is allowed to contain, and every one of
 * them is the sort of thing that decays quietly under a deadline. They are checked here,
 * over the real source tree, so a future change that breaks one fails a test instead of
 * shipping.
 *
 *   1. **No backend, of any kind.** The site is a static export: no Supabase client, no
 *      monitoring SDK, no server secret, no `server-only` read layer to protect.
 *      `scripts/check-source-policy.mjs` scans the whole repository for the names; this
 *      suite holds the application tree to the same rule from the inside.
 *   2. **Client components are the exception, not the rule.** The plan names the small
 *      set that may exist; a new one is a decision, not an accident.
 *   3. **The browser makes no requests of its own.** No `fetch`, no polling, no socket —
 *      which is what keeps §12's "a visitor receives zero cookies and no tracking" true.
 *   4. **No analytics, tag manager, state-management or client data-fetching library**
 *      is a dependency of this project.
 */
const ROOT = process.cwd()
const SOURCE_DIRECTORIES = ['app', 'components', 'lib', 'content']
const SOURCE_FILES_AT_ROOT = ['next.config.ts']

/**
 * The client components the plan allows, with the reason each one cannot be a Server
 * Component. Adding a file here should require the same argument.
 *
 * Three of the five exist for one reason: **a static export has no useful clock.** Every
 * page is rendered once, when the site is built, so anything that depends on "now" has to
 * be decided in the browser or not claimed at all.
 */
const ALLOWED_CLIENT_COMPONENTS = new Map([
  [
    'components/site/OpenStatus.tsx',
    'decides the open/closed badge in the browser; the prerendered HTML claims nothing (§7a)',
  ],
  [
    'components/site/hours/DailyHoursList.tsx',
    'marks today’s row in the browser, for the same reason — a build-time weekday would ' +
      'mark the same row forever',
  ],
  [
    'components/site/announcement/AnnouncementExpiryGuard.tsx',
    'removes an announcement whose expiry passes while the page is open (§7a, §7c)',
  ],
  ['components/site/layout/NavLink.tsx', 'a layout cannot read the pathname'],
  [
    'app/(site)/error.tsx',
    'an error boundary must be a Client Component (the framework’s rule); it renders only ' +
      'after a page has already failed (§10g)',
  ],
])

/** Backend names that must not appear anywhere in the application tree. */
const BACKEND_NAMES = [
  '@supabase/',
  '@sentry/',
  'server-only',
  'createBrowserClient',
  'createServerClient',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SENTRY_DSN',
  'RATE_LIMIT_SECRET',
  'RESEND_API_KEY',
]

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

const clientFiles = sourceFiles.filter((file) => /^\s*['"]use client['"]/m.test(file.source))

describe('the site has no backend to ship to the browser', () => {
  it('finds source files to check at all', () => {
    expect(sourceFiles.length).toBeGreaterThan(20)
  })

  it.each(BACKEND_NAMES)('never names %s', (name) => {
    const offenders = sourceFiles.filter((file) => file.source.includes(name)).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('has no server-runtime module of any kind', () => {
    const paths = sourceFiles.map((file) => file.path)

    for (const forbidden of ['lib/supabase/client.ts', 'lib/supabase/server.ts', 'lib/env/server.ts']) {
      expect(paths).not.toContain(forbidden)
    }
    // A route handler or a Server Action would refuse to export at all; the framework
    // marks both with a directive this catches earlier and more clearly.
    expect(sourceFiles.some((file) => /^\s*['"]use server['"]/m.test(file.source))).toBe(false)
    expect(paths.some((path) => path.startsWith('app/api/'))).toBe(false)
  })
})

describe('client components stay the documented exception', () => {
  it('is exactly the set the plan allows', () => {
    expect(clientFiles.map((file) => file.path).sort()).toEqual(
      [...ALLOWED_CLIENT_COMPONENTS.keys()].sort(),
    )
  })

  /**
   * The dependency direction the codebase states in prose, asserted.
   *
   * A component in `components/` importing from `app/` would be the dependency the wrong
   * way round. A rule that only lives in a comment is a rule that gets broken by the next
   * person who needs one constant.
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

  it('runs on four runtime dependencies: the framework, React and the image encoder', () => {
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      'next',
      'react',
      'react-dom',
      'sharp',
    ])
  })

  /** Everything §1 (adjustment 4) and §12 rule out, by the name it would arrive under. */
  const FORBIDDEN = [
    // the retired backend (§0al — the static rebuild)
    '@supabase/supabase-js',
    '@supabase/ssr',
    '@sentry/nextjs',
    'zod',
    'server-only',
    'supabase',
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
