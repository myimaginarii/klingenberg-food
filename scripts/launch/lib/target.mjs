/**
 * Where a launch tool may point — technical plan §5, §8, §10b; phase 14A.
 *
 * Three operations touch a production project once, at launch, and never by
 * accident: the migration door, the confirmed-content load and the Owner
 * bootstrap. This module is the one rule set they share, built on the same
 * primitives as the restore guard (`scripts/backup/lib/targets.mjs`) so that
 * "which project am I pointing at" is answered the same way everywhere:
 *
 *   1. A production tool operates on a HOSTED Supabase project only. The local
 *      stack is refused outright — the fact that local credentials happen to be
 *      valid is never a reason to run a launch tool against them.
 *   2. The operator confirms the target by naming its project host exactly
 *      (`<ref>.supabase.co`, the host the dashboard shows) in a variable that
 *      belongs to that one operation. A shared pooler host would name a region,
 *      not a project, so the confirmation always carries the project ref.
 *   3. A target from which no project ref can be read is ambiguous and refused.
 *
 * Tests exercise the same code through the LOCAL HARNESS mode, which inverts
 * rule 1 rather than weakening it: with `--local-harness` a tool accepts a
 * loopback target only, still demands the confirmation (the loopback host
 * itself), and refuses every hosted project. The two modes share no path on
 * which a hosted project can be reached without its confirmation.
 *
 * Nothing here returns a credential; `description` is what the commands print.
 */

import { apiHostOf, isLoopbackHost, parseDbUrl, projectRefFromApiUrl, projectRefFromDbUrl } from '../../backup/lib/targets.mjs'

/** The flag every launch tool spells the same way. */
export const HARNESS_FLAG = '--local-harness'

/** A hosted project's own host: the ref, then the platform domain. */
const PROJECT_HOST_RE = /^([a-z0-9]{20})\.supabase\.(?:co|in|red)$/

/** The project host a confirmation must name, for a target whose ref is known. */
export function projectHostFor(projectRef) {
  return `${projectRef}.supabase.co`
}

/**
 * Decide whether a launch tool may proceed against this target.
 *
 * @param {{
 *   kind: 'api' | 'db',
 *   url: string,
 *   confirmHost?: string | undefined,
 *   confirmName: string,
 *   harness: boolean,
 *   operation: string,
 * }} input
 * @returns {{ ok: boolean, reasons: string[], host: string, projectRef: string | null, loopback: boolean, description: string }}
 */
export function assessLaunchTarget({ kind, url, confirmHost, confirmName, harness, operation }) {
  let host
  let projectRef
  let description
  if (kind === 'api') {
    host = apiHostOf(url)
    projectRef = projectRefFromApiUrl(url)
    description = `API at ${host}`
  } else if (kind === 'db') {
    const conn = parseDbUrl(url)
    host = conn.host
    projectRef = projectRefFromDbUrl(url)
    description = `${conn.user}@${conn.host}:${conn.port}/${conn.database}`
  } else {
    throw new Error(`Unknown target kind ${String(kind)}`)
  }

  const loopback = isLoopbackHost(host)
  const confirmed = (confirmHost ?? '').trim().toLowerCase()
  /** @type {string[]} */
  const reasons = []

  if (harness) {
    if (!loopback) {
      reasons.push(
        `The local harness only ever reaches the local stack, and ${host} is not loopback. ` +
          `Run the production ${operation} without ${HARNESS_FLAG}.`,
      )
    } else if (!confirmed) {
      reasons.push(`Even the harness confirms its target: set ${confirmName} to exactly "${host}".`)
    } else if (confirmed !== host.toLowerCase()) {
      reasons.push(`${confirmName} names "${confirmed}" but the harness target is "${host}". They must match exactly.`)
    }
  } else if (loopback) {
    reasons.push(
      `The target ${host} is the local stack. The production ${operation} never operates on a local ` +
        `Supabase; a test exercises it with ${HARNESS_FLAG}.`,
    )
  } else if (projectRef === null) {
    reasons.push(
      `The target ${host} is not a hosted Supabase project this tooling recognises: no project ref ` +
        'can be read from it. Refusing an ambiguous target.',
    )
  } else if (kind === 'api' && !PROJECT_HOST_RE.test(host)) {
    reasons.push(`The API host ${host} is not a project host. Refusing an ambiguous target.`)
  } else {
    const expected = kind === 'api' ? host.toLowerCase() : projectHostFor(projectRef)
    const confirmedRef = PROJECT_HOST_RE.exec(confirmed)?.[1] ?? null
    if (!confirmed) {
      reasons.push(
        `The target is project ${projectRef}. To proceed, set ${confirmName} to exactly "${expected}" — ` +
          'the project host the Supabase dashboard shows.',
      )
    } else if (confirmedRef !== projectRef) {
      reasons.push(
        `${confirmName} names "${confirmed}" but the target is project ${projectRef} ("${expected}"). ` +
          'They must match exactly.',
      )
    }
  }

  return { ok: reasons.length === 0, reasons, host, projectRef, loopback, description }
}

/** Top-level domains that can never hold a real mailbox (RFC 2606 and RFC 6761). */
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost'])
/** Second-level names reserved for documentation (RFC 2606). */
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org'])
const HARNESS_DOMAIN = 'example.test'

/**
 * The address the first Owner is invited at.
 *
 * Production refuses every reserved address: an Owner under `.test` or
 * `example.com` is a fixture that walked into a production run. The harness
 * requires `@example.test`, the same reserved domain every test identity of this
 * repository lives under, so a harness run can never create a real mailbox's
 * account.
 *
 * @param {string | undefined} raw
 * @param {{ harness: boolean }} options
 * @returns {{ ok: boolean, email: string, reasons: string[] }}
 */
export function assessOwnerEmail(raw, { harness }) {
  const email = (raw ?? '').trim().toLowerCase()
  /** @type {string[]} */
  const reasons = []

  const at = email.lastIndexOf('@')
  const domain = at > 0 ? email.slice(at + 1) : ''
  const tld = domain.slice(domain.lastIndexOf('.') + 1)
  const wellFormed = at > 0 && /^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(email)

  if (!wellFormed) {
    reasons.push('The Owner e-mail address is missing or malformed.')
  } else if (harness) {
    if (domain !== HARNESS_DOMAIN) {
      reasons.push(`The local harness invites @${HARNESS_DOMAIN} addresses only; "${email}" is not one.`)
    }
  } else if (RESERVED_TLDS.has(tld) || RESERVED_DOMAINS.has(domain)) {
    reasons.push(
      `"${email}" is a reserved address (RFC 2606) and can never receive an invitation. ` +
        'The production Owner is a real mailbox.',
    )
  }

  return { ok: reasons.length === 0, email, reasons }
}

/** Whether an Auth identity's address is a repository test fixture. @param {string | undefined} email */
export function isTestIdentityAddress(email) {
  return (email ?? '').trim().toLowerCase().endsWith(`@${HARNESS_DOMAIN}`)
}
