#!/usr/bin/env node
/**
 * Repository source-policy checks — technical plan §8, §10d.
 *
 * Three rules, all cheap, all run in CI before the build:
 *
 *   1. no-hard-coded-domain  A site domain literal may appear only in
 *                            lib/config/site.ts. Choosing the restaurant's domain
 *                            later must be a configuration change, not a code change.
 *                            Hosts under the reserved `.test` TLD are exempt: they
 *                            cannot resolve, so they are fixtures, not domains.
 *   2. no-set-x              `set -x` is forbidden in GitHub workflow scripts; it
 *                            echoes commands and can spill secrets into logs.
 *   3. no-backend            The site is a static export with no server, no database
 *                            and no third-party runtime service. Nothing in the tree
 *                            may name a backend secret, a database URL, a Supabase or
 *                            Sentry client, or a monitoring script, and no
 *                            server-runtime file or directory may exist. This is the
 *                            rule that keeps "building and serving this site needs no
 *                            secret of any kind" a fact rather than an intention.
 *
 * Exit code 1 on any violation, with file:line and the offending text.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.vercel',
  'coverage',
  'out',
  'test-results',
  'playwright-report',
])

/** Files exempt from the domain rule. Everything else must go through site.ts. */
const DOMAIN_ALLOWED_FILES = new Set(
  [
    'lib/config/site.ts',
    'scripts/check-source-policy.mjs',
    'scripts/serve-static.mjs',
    // The suite that runs this script over fixture trees has to name an outside address.
    'tests/unit/policy/source-policy.test.ts',
    'README.md',
    'package-lock.json',
  ].map(normalise),
)

/**
 * Directories exempt from the domain rule.
 *
 *   * `docs/` records decisions; it is not code.
 *   * `content/site/` is the restaurant's editable content, read by the loaders in
 *     `lib/content/load/` at build time. An address written there — the Facebook page,
 *     an announcement's link, a news article's link — is a *fact the restaurant states*,
 *     not the site's own origin baked into its source, so the §10d rule ("choosing our
 *     domain later must be configuration, not a code change") does not apply to it.
 *     Only the domain rule is relaxed: the no-backend rule below still scans every
 *     content file, because a backend name is wrong wherever it appears.
 */
const DOMAIN_ALLOWED_DIRS = ['docs/', 'content/site/']

/**
 * Hosts that are infrastructure rather than "our site". Each one is here because a
 * specific, reviewed part of the system needs it — not as a general escape hatch.
 */
const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'schema.org', // JSON-LD @context (§11)
  'www.schema.org',
  'www.w3.org', // SVG / XML namespaces
  'www.google.com', // Google Maps directions URL and the Find os embed (§7g)
  // The restaurant's Facebook page is a confirmed business fact, tracked as content in
  // `content/site/contact.json` (exempt above) and asserted by name in the unit suites
  // under `tests/`, which are not. It is a third-party profile URL, not this site's
  // origin, so the §10d rule does not apply to it there either.
  'www.facebook.com',
])

/**
 * Hosts under the reserved `.test` top-level domain (RFC 2606) are allowed anywhere.
 *
 * `.test` is reserved by the IETF precisely so that it can never resolve on the public
 * internet, which makes it the correct home for a fixture host — and the opposite of
 * what this rule guards against.
 */
function isReservedTestHost(host) {
  return host.endsWith('.test')
}

/**
 * Everything the retired backend used to need, by the name it would arrive under.
 *
 * The static site has no server to read any of these and no host to set them on. A
 * match is not a leaked value — this repository never held one — it is a sign that
 * something server-shaped has come back.
 */
const BACKEND_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_STORAGE_S3_',
  'SENTRY_DSN',
  'RESEND_API_KEY',
  'RATE_LIMIT_SECRET',
  'BACKUP_S3_',
  'sb_secret_',
  'service_role',
  '@supabase/',
  '@sentry/',
  'withSentryConfig',
  'createBrowserClient',
  'createServerClient',
  'postgres://',
  'postgresql://',
]

/**
 * Where a backend name may still be written down: the documentation that records why
 * the backend was retired, this file, which has to name what it forbids, and the
 * suites that assert the same absence from inside the application tree or exercise this script.
 */
const BACKEND_ALLOWED_FILES = new Set(
  [
    'scripts/check-source-policy.mjs',
    'README.md',
    'package-lock.json',
    'tests/unit/policy/public-javascript.test.ts',
    'tests/unit/announcements/expiry-guard-source.test.ts',
    'tests/unit/policy/source-policy.test.ts',
  ].map(normalise),
)
const BACKEND_ALLOWED_DIRS = ['docs/']

/** Server-shaped files the framework would pick up if one reappeared. */
const FORBIDDEN_FILES = [
  'proxy.ts',
  'middleware.ts',
  'src/proxy.ts',
  'src/middleware.ts',
  'instrumentation.ts',
  'instrumentation-client.ts',
  'sentry.client.config.ts',
  'sentry.server.config.ts',
  'sentry.edge.config.ts',
]

/** Directories that only a server application has. */
const FORBIDDEN_DIRS = ['app/api', 'supabase']

const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.toml',
  '.sql',
  '.sh',
  '.example',
])

function normalise(path) {
  return path.split(sep).join('/')
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      yield* walk(full)
    } else {
      yield full
    }
  }
}

/**
 * Files to check: everything git would keep, which excludes build output and other
 * generated files (`next-env.d.ts` carries a documentation URL and is regenerated on
 * every build — checking it would be checking Next.js, not this repository).
 * Falls back to a filesystem walk when git is unavailable.
 */
function sourceFiles() {
  if (existsSync(join(ROOT, '.git'))) {
    try {
      const out = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
      )
      const paths = out.split('\0').filter(Boolean)
      if (paths.length > 0) return paths.map((p) => join(ROOT, p))
    } catch {
      // fall through to the walk
    }
  }
  return [...walk(ROOT)]
}

function shouldScan(relPath) {
  if (relPath === '.gitignore' || relPath === '.nvmrc') return false
  const dot = relPath.lastIndexOf('.')
  return dot !== -1 && SCANNED_EXTENSIONS.has(relPath.slice(dot))
}

function isExempt(relPath, files, dirs) {
  return files.has(relPath) || dirs.some((d) => relPath.startsWith(d))
}

const violations = []

function report(rule, relPath, lineNo, line, detail) {
  violations.push({ rule, where: `${relPath}:${lineNo}`, detail, line: line.trim().slice(0, 140) })
}

// Any absolute URL. The host is then checked against the allow-list.
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/([a-z0-9._-]+(?::\d+)?)/gi
// A bare Danish domain literal — the specific risk for this project.
const DK_DOMAIN_RE = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.dk\b/gi
const SET_X_RE = /(^|[;&|]\s*|\brun:\s*)set\s+-[a-wyz]*x/

let scanned = 0

for (const absolute of sourceFiles()) {
  const relPath = normalise(relative(ROOT, absolute))
  if (!shouldScan(relPath)) continue

  let contents
  try {
    contents = readFileSync(absolute, 'utf8')
  } catch {
    continue
  }
  const lines = contents.split(/\r?\n/)
  scanned += 1

  const domainExempt = isExempt(relPath, DOMAIN_ALLOWED_FILES, DOMAIN_ALLOWED_DIRS)
  const backendExempt = isExempt(relPath, BACKEND_ALLOWED_FILES, BACKEND_ALLOWED_DIRS)
  const isWorkflow = relPath.startsWith('.github/workflows/')

  lines.forEach((line, index) => {
    const lineNo = index + 1

    // 1. no-hard-coded-domain
    if (!domainExempt) {
      for (const match of line.matchAll(URL_RE)) {
        const host = (match[1] ?? '').replace(/:\d+$/, '').toLowerCase()
        if (!ALLOWED_HOSTS.has(host) && !isReservedTestHost(host)) {
          report('no-hard-coded-domain', relPath, lineNo, line, `absolute URL host "${host}"`)
        }
      }
      for (const match of line.matchAll(DK_DOMAIN_RE)) {
        report('no-hard-coded-domain', relPath, lineNo, line, `domain literal "${match[0]}"`)
      }
    }

    // 2. no-set-x, in workflows only
    if (isWorkflow && SET_X_RE.test(line)) {
      report('no-set-x', relPath, lineNo, line, '`set -x` can echo secrets into the log')
    }

    // 3. no-backend
    if (!backendExempt) {
      for (const name of BACKEND_NAMES) {
        if (line.includes(name)) {
          report('no-backend', relPath, lineNo, line, `"${name}" — this site has no backend`)
        }
      }
    }
  })
}

for (const file of FORBIDDEN_FILES) {
  if (existsSync(join(ROOT, file))) {
    violations.push({
      rule: 'no-backend',
      where: file,
      detail: 'a server-runtime file the static export cannot have',
      line: '',
    })
  }
}

for (const dir of FORBIDDEN_DIRS) {
  if (existsSync(join(ROOT, dir))) {
    violations.push({
      rule: 'no-backend',
      where: `${dir}/`,
      detail: 'a server or database directory the static site does not have',
      line: '',
    })
  }
}

// A check that silently inspects nothing is worse than no check: it reports success
// forever. Refuse to pass on an empty scan.
if (scanned === 0) {
  console.error(
    'source-policy: scanned 0 files. File discovery is broken — this is a failure, not a pass.',
  )
  process.exit(1)
}

if (violations.length === 0) {
  console.log(
    `source-policy: OK — ${scanned} file(s) scanned; no hard-coded domains, no \`set -x\`, no backend of any kind.`,
  )
  process.exit(0)
}

console.error(`source-policy: ${violations.length} violation(s)\n`)
for (const v of violations) {
  console.error(`  [${v.rule}] ${v.where}`)
  console.error(`      ${v.detail}`)
  console.error(`      ${v.line}\n`)
}
console.error('Absolute site URLs belong in lib/config/site.ts (technical plan §10d).')
console.error('The site is a static export: it has no server, no database and no secrets.')
process.exit(1)
