#!/usr/bin/env node
/**
 * Repository source-policy checks — technical plan §8, §10d, §10f.
 *
 * Four rules, all cheap, all run in CI before the build:
 *
 *   1. no-hard-coded-domain  A site domain literal may appear only in
 *                            lib/config/site.ts. Choosing the restaurant's domain
 *                            later must be a configuration change, not a code change.
 *                            Hosts under the reserved `.test` TLD are exempt: they
 *                            cannot resolve, so they are fixtures, not domains.
 *   2. no-set-x              `set -x` is forbidden in GitHub workflow scripts; it
 *                            echoes commands and can spill secrets into logs.
 *   3. server-secrets        Secrets named in §10e may only be referenced in
 *                            lib/env/server.ts (and documentation).
 *   4. map-provenance        The static map asset must record where it came from, so
 *                            the launch check has something to read (§7g, §13 item C).
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
    '.env.example',
    'README.md',
    'package-lock.json',
  ].map(normalise),
)

/** Directories exempt from the domain rule (documentation records decisions, not code). */
const DOMAIN_ALLOWED_DIRS = ['docs/']

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
  'www.google.com', // Google Maps directions URL (§7g) — not a site domain
  // The restaurant's Facebook page is a confirmed business fact and is stored as
  // content in `site_contact.facebook_url`, seeded in supabase/seed.sql. It is a
  // third-party profile URL, not this site's origin, so the §10d rule — "choosing our
  // domain later must be configuration, not a code change" — does not apply to it.
  'www.facebook.com',
])

/**
 * Hosts under the reserved `.test` top-level domain (RFC 2606) are allowed anywhere.
 *
 * `.test` is reserved by the IETF precisely so that it can never resolve on the public
 * internet, which makes it the correct home for a fixture host — and the opposite of
 * what this rule guards against. §10d exists so that *this site's* domain is a
 * configuration value rather than a literal in the code; a host that cannot exist is
 * not this site's domain and never will be.
 *
 * The security tests need such hosts by name: pgTAP and the schema suite assert which
 * announcement links are accepted, and the browser suite aims the preview route at a
 * foreign origin to prove the open-redirect refusal in §8.
 */
function isReservedTestHost(host) {
  return host.endsWith('.test')
}

/** Secrets that may only be read through lib/env/server.ts (§10e). */
const SERVER_SECRETS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SENTRY_DSN',
  'RESEND_API_KEY',
  'BACKUP_S3_',
  'SUPABASE_STORAGE_S3_',
]

/**
 * `lib/env/server.ts` is the single door to a secret for the Next.js runtime: it
 * imports `server-only`, so anything reaching it from a Client Component is a build
 * error. Application code asks it for a capability (`getServiceRoleKey()`) and never
 * names the variable, which is what keeps this list short.
 *
 * `scripts/seed-local-users.mjs` (phase 1) is the exception, and a deliberate one. It
 * is a local development bootstrap run with `node`, not part of any bundle, and it
 * cannot import `lib/env/server.ts` precisely because that module imports
 * `server-only`. It reads the service-role key from the environment directly, and it
 * refuses to run against anything but a loopback Supabase.
 */
const SECRET_ALLOWED_FILES = new Set(
  [
    'lib/env/server.ts',
    'scripts/seed-local-users.mjs',
    'eslint.config.mjs',
    'scripts/check-source-policy.mjs',
    '.env.example',
    'README.md',
    'package-lock.json',
  ].map(normalise),
)
const SECRET_ALLOWED_DIRS = ['docs/', '.github/']

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
  if (relPath === '.env.example') return true
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
  const secretExempt = isExempt(relPath, SECRET_ALLOWED_FILES, SECRET_ALLOWED_DIRS)
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

    // 3. server secrets outside their single door
    if (!secretExempt) {
      for (const secret of SERVER_SECRETS) {
        if (line.includes(secret)) {
          report(
            'server-secret-outside-lib-env',
            relPath,
            lineNo,
            line,
            `"${secret}" must be read through lib/env/server.ts`,
          )
        }
      }
    }
  })
}

// --- 4. map-provenance (§7g) -------------------------------------------------------
//
// The Find os map is a single licensed static image. Until the licensed asset arrives it
// is a placeholder, and the plan makes shipping that placeholder a launch-blocking
// mistake. This check keeps the record it will be caught by: the provenance field must
// exist and must say something. Phase 14 tightens the same check to reject the value
// `placeholder` in a production build.

const MAP_LICENCE = 'public/map/LICENSE.md'
const PROVENANCE_RE = /^\|\s*\*\*Provenance\*\*\s*\|\s*`?([^|`]+?)`?\s*\|/m

const licencePath = join(ROOT, MAP_LICENCE)
if (!existsSync(licencePath)) {
  violations.push({
    rule: 'map-provenance',
    where: MAP_LICENCE,
    detail: 'the static map asset has no provenance record',
    line: '',
  })
} else {
  const licence = readFileSync(licencePath, 'utf8')
  const provenance = PROVENANCE_RE.exec(licence)?.[1]?.trim()

  if (!provenance) {
    violations.push({
      rule: 'map-provenance',
      where: MAP_LICENCE,
      detail: 'no **Provenance** row — record where the map image came from',
      line: '',
    })
  } else {
    console.log(`source-policy: map asset provenance is "${provenance}".`)
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
    `source-policy: OK — ${scanned} file(s) scanned; no hard-coded domains, no \`set -x\`, no stray secret access.`,
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
console.error('Server secrets belong in lib/env/server.ts (technical plan §10e).')
process.exit(1)
