import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The monitoring boundary — technical plan §1 (stack note), §10g, §12, §0aj;
 * phase 13C (brief §4, §28, §41).
 *
 * Held over the real source tree, in the family of `public-javascript.test.ts`:
 *
 *   1. **Server only.** No browser SDK file, no client config, no
 *      `withSentryConfig`, no `NEXT_PUBLIC_` monitoring variable, no Replay, no
 *      browser tracing, and no client component that reaches a monitoring module.
 *   2. **One door.** `@sentry/nextjs` is imported by exactly the monitoring modules;
 *      `captureException`/`captureMessage` appear nowhere else; and the operational
 *      reporter has exactly the five callers the phase approved.
 *   3. **Errors only.** No tracing, profiling or sampling option anywhere.
 *   4. **The hook is wired** and gated to the Node runtime.
 */

const ROOT = process.cwd()
const SOURCE_DIRECTORIES = ['app', 'components', 'lib']
const ROOT_FILES = ['instrumentation.ts', 'proxy.ts', 'next.config.ts']

/** The modules that may import the SDK. */
const SDK_IMPORTERS = ['lib/monitoring/report.ts', 'lib/monitoring/request-error.ts', 'lib/monitoring/sentry.ts']

/** Type-only imports of the SDK's event shapes. */
const SDK_TYPE_IMPORTERS = ['lib/monitoring/sanitize.ts']

/** The five modules that may report an operational event, at the places their notes describe. */
const REPORTER_CALLERS = [
  'lib/accounts/admin.ts',
  'lib/accounts/auth-admin.ts',
  'lib/images/finalize.ts',
  'lib/images/storage.ts',
  'lib/rate-limit/limiter.ts',
]

/** Browser-side conventions and files that must not exist. */
const FORBIDDEN_ROOT_FILES = [
  'instrumentation-client.ts',
  'instrumentation-client.js',
  'sentry.client.config.ts',
  'sentry.client.config.js',
  'sentry.server.config.ts',
  'sentry.server.config.js',
  'sentry.edge.config.ts',
  'sentry.edge.config.js',
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

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const sourceFiles: SourceFile[] = [
  ...SOURCE_DIRECTORIES.flatMap((directory) => [...walk(join(ROOT, directory))].map(read)),
  ...ROOT_FILES.map((file) => read(join(ROOT, file))),
]

const clientFiles = sourceFiles.filter((file) => /^\s*['"]use client['"]/m.test(file.source))

describe('monitoring is server-only', () => {
  it('found the tree it polices', () => {
    expect(sourceFiles.length).toBeGreaterThan(20)
    expect(clientFiles.length).toBeGreaterThan(3)
  })

  it('has no browser SDK file and no per-runtime Sentry config file', () => {
    for (const file of FORBIDDEN_ROOT_FILES) {
      expect(existsSync(join(ROOT, file)), `${file} must not exist`).toBe(false)
      expect(existsSync(join(ROOT, 'src', file)), `src/${file} must not exist`).toBe(false)
    }
  })

  it('does not wrap next.config.ts with withSentryConfig or any build-time Sentry integration', () => {
    const config = codeOf(readFileSync(join(ROOT, 'next.config.ts'), 'utf8'))
    expect(config).not.toContain('@sentry')
    expect(config).not.toContain('withSentryConfig')
    expect(config).not.toMatch(/sentry/i)
  })

  it('exposes no monitoring value to the browser through NEXT_PUBLIC_', () => {
    for (const file of sourceFiles) {
      expect(file.source, file.path).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SENTRY/)
    }
    const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8')
    expect(envExample).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SENTRY/)
  })

  it('never installs Replay, browser tracing or any sampling of traces or profiles', () => {
    for (const file of sourceFiles) {
      const code = codeOf(file.source)
      expect(code, file.path).not.toMatch(
        /replayIntegration|browserTracingIntegration|feedbackIntegration|tracesSampleRate|tracesSampler|profilesSampleRate|profileSessionSampleRate|enableTracing|replaysSessionSampleRate|replaysOnErrorSampleRate/,
      )
    }
  })

  it('no client component imports the SDK or a monitoring module', () => {
    for (const file of clientFiles) {
      expect(file.source, file.path).not.toContain('@sentry/')
      expect(file.source, file.path).not.toContain('@/lib/monitoring')
    }
  })

  it('nothing under app/ or components/ imports the SDK or the reporter', () => {
    const offenders = sourceFiles
      .filter((file) => file.path.startsWith('app/') || file.path.startsWith('components/'))
      .filter((file) => /@sentry\/|@\/lib\/monitoring/.test(codeOf(file.source)))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('the request hook has exactly two callers: instrumentation.ts and the proxy the framework does not cover', () => {
    const callers = sourceFiles
      .filter((file) => file.path !== 'lib/monitoring/request-error.ts')
      .filter((file) => /\breportRequestError\b/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()
    expect(callers).toEqual(['instrumentation.ts', 'proxy.ts'])
    const proxy = codeOf(readFileSync(join(ROOT, 'proxy.ts'), 'utf8'))
    expect(proxy).toContain('headers: {}')
    expect(proxy).toContain('request.nextUrl.pathname')
    expect(proxy).toMatch(/throw error/)
  })
})

describe('one door', () => {
  it('exactly the monitoring modules import the SDK as a value', () => {
    const importers = sourceFiles
      .filter((file) => /^\s*import\s+(?!type\b)[^'"]*from\s+'@sentry\/nextjs'/m.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()
    expect(importers).toEqual(SDK_IMPORTERS)

    const typeImporters = sourceFiles
      .filter((file) => /^\s*import\s+type\s+[^'"]*from\s+'@sentry\/nextjs'/m.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()
    expect(typeImporters).toEqual(SDK_TYPE_IMPORTERS)

    // No other Sentry package, ever — one SDK, not several.
    const others = sourceFiles
      .filter((file) => /from\s+'@sentry\/(?!nextjs')/.test(codeOf(file.source)))
      .map((file) => file.path)
    expect(others).toEqual([])
  })

  it('captureException and captureMessage are called only inside lib/monitoring', () => {
    const callers = sourceFiles
      .filter((file) => /\b(captureException|captureMessage|captureEvent)\s*\(/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()
    expect(callers).toEqual(['lib/monitoring/report.ts'])
  })

  it('the operational reporter has exactly the five approved callers', () => {
    const callers = sourceFiles
      .filter((file) => file.path !== 'lib/monitoring/report.ts')
      .filter((file) => /\breportOperationalEvent\s*\(/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()
    expect(callers).toEqual(REPORTER_CALLERS)
  })

  it('no Server Action is wrapped: the framework hook is the only action coverage', () => {
    const wrapped = sourceFiles
      .filter((file) => /withServerActionInstrumentation|wrapServerComponentWithSentry|wrapRouteHandlerWithSentry|wrapMiddlewareWithSentry/.test(codeOf(file.source)))
      .map((file) => file.path)
    expect(wrapped).toEqual([])
  })

  it('the DSN is read through the one env door and nowhere else', () => {
    const readers = sourceFiles
      .filter((file) => /getMonitoringDsn\(/.test(codeOf(file.source)))
      .filter((file) => file.path !== 'lib/env/server.ts')
      .map((file) => file.path)
    expect(readers).toEqual(['lib/monitoring/sentry.ts'])
  })
})

describe('the hook is wired', () => {
  const instrumentation = codeOf(readFileSync(join(ROOT, 'instrumentation.ts'), 'utf8'))

  it('exports register and onRequestError', () => {
    expect(instrumentation).toMatch(/export async function register\(/)
    expect(instrumentation).toMatch(/export const onRequestError/)
  })

  it('acts on the Node runtime only and defers to the monitoring modules', () => {
    expect(instrumentation.match(/NEXT_RUNTIME !== 'nodejs'/g)).toHaveLength(2)
    expect(instrumentation).toContain("import('@/lib/monitoring/sentry')")
    expect(instrumentation).toContain("import('@/lib/monitoring/request-error')")
  })

  it('the request hook drops the headers before the SDK sees the request', () => {
    const hook = codeOf(readFileSync(join(ROOT, 'lib/monitoring/request-error.ts'), 'utf8'))
    expect(hook).toContain('headers: {}')
    expect(hook).toContain('stripQuery(request.path)')
    expect(hook).toContain('isFrameworkControlFlow(error)')
  })

  it('the SDK options send no default PII and route every event through the sanitizer', () => {
    const sentry = codeOf(readFileSync(join(ROOT, 'lib/monitoring/sentry.ts'), 'utf8'))
    expect(sentry).toContain('sendDefaultPii: false')
    expect(sentry).toContain('beforeSend: (event) => sanitizeErrorEvent(event)')
    expect(sentry).toContain('beforeBreadcrumb: (crumb) => sanitizeBreadcrumb(crumb)')
    expect(sentry).toContain("'LocalVariablesAsync'")
    expect(sentry).toContain("'Http'")
    expect(sentry).toContain("'NodeFetch'")
  })

  it('never sets a user identity: no e-mail, no name, not even the UUID', () => {
    const setters = sourceFiles
      .filter((file) => /\bsetUser\s*\(/.test(codeOf(file.source)))
      .map((file) => file.path)
    expect(setters).toEqual([])
  })
})
