import 'server-only'

import { isVercelDeployment } from '@/lib/config/site'

/**
 * Server-only environment access — technical plan §8, §10e.
 *
 * Importing `server-only` makes this module a build error if it is ever reached from a
 * Client Component, so a secret cannot enter a browser bundle by accident. Every secret
 * named in §10e is read here and nowhere else; `scripts/check-source-policy.mjs` enforces
 * that rule across the repository.
 *
 * Values are read lazily, at call time. Nothing throws at import time, so a build that
 * does not use a given secret does not require it to be present.
 */

/** Secrets that must never be prefixed `NEXT_PUBLIC_` and never referenced elsewhere. */
export type ServerSecretName =
  | 'SUPABASE_SERVICE_ROLE_KEY'
  | 'SUPABASE_DB_URL'
  | 'SENTRY_DSN'
  /** Keys the sign-in throttle's client subjects (phase 13B, `lib/rate-limit/sign-in.ts`). */
  | 'RATE_LIMIT_SECRET'

function read(name: ServerSecretName): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

/** Read a server secret, or `undefined` when it is not configured in this environment. */
export function optionalSecret(name: ServerSecretName): string | undefined {
  return read(name)
}

/**
 * Read a server secret, failing loudly when it is missing.
 * The error names the variable but never echoes a value (§8 — log hygiene).
 */
export function requireSecret(name: ServerSecretName): string {
  const value = read(name)
  if (!value) {
    throw new Error(
      `Missing required server environment variable ${name}. ` +
        'See .env.example for the expected names; the value belongs in the ' +
        'hosting provider\u2019s environment settings, never in the repository.',
    )
  }
  return value
}

/**
 * The Supabase service-role key (§8, §10e).
 *
 * Exposed as its own accessor so that no other file in `lib/` or `app/` ever needs to
 * write the variable's name. `scripts/check-source-policy.mjs` enforces exactly that.
 * Callers ask for the capability, not for the environment variable.
 *
 * The key bypasses RLS entirely. Per §8 it has four intended call sites across the
 * whole project — the image storage boundary (`lib/images/storage.ts`, phase 10A), the
 * Auth Admin boundary (`lib/accounts/auth-admin.ts`, phase 11C), migrations and seeding,
 * and the one-time owner bootstrap — and it is reachable only from modules that, like
 * this one, import `server-only`, so it cannot enter a browser bundle.
 * `tests/unit/policy/images-boundary.test.ts` pins the two runtime importers.
 */
export function getServiceRoleKey(): string {
  return requireSecret('SUPABASE_SERVICE_ROLE_KEY')
}

/** The shortest secret the sign-in throttle accepts: `openssl rand -hex 32` gives 64. */
export const MIN_RATE_LIMIT_KEY_LENGTH = 32

/**
 * The rate-limit secret (§10e, phase 13B; required on Vercel since the 13B closure),
 * or `undefined` when this environment may stand one in.
 *
 * Keys the HMAC that turns a client address or an account address into the
 * sign-in throttle's subject (`lib/rate-limit/subject.ts`), so that nothing stored
 * can be turned back into either — and, since the closure, so that nobody outside
 * the server can name a subject to the reservation doors at all. Two rules:
 *
 *   * **On Vercel it is required.** That is the one environment where the address
 *     headers are believed and client-derived subjects exist; a key each instance
 *     made up would give the same client a different bucket per instance, which is
 *     no limit. A missing value throws, naming the variable and never a value, at
 *     the first sign-in or reset request — so the deployment refuses to run the two
 *     unauthenticated forms rather than run them weakly. Nothing throws at build.
 *   * **Anywhere else it is optional.** `lib/rate-limit/sign-in.ts` stands in a
 *     fixed development key on the local origin — so a local `next build && next
 *     start` is testable without one — and a per-process key, with one warning, on
 *     an origin that is neither local nor Vercel.
 *
 * A configured value must be at least {@link MIN_RATE_LIMIT_KEY_LENGTH}
 * characters wherever it is set: a short key is a misconfiguration, not a weaker
 * limit, and is refused the same way.
 */
export function getRateLimitSecret(): string | undefined {
  const value = optionalSecret('RATE_LIMIT_SECRET')

  if (value === undefined) {
    if (isVercelDeployment()) {
      throw new Error(
        'Missing required server environment variable RATE_LIMIT_SECRET on this Vercel ' +
          'deployment. The sign-in throttle refuses to run without it: set any random ' +
          `string of at least ${MIN_RATE_LIMIT_KEY_LENGTH} characters (for example ` +
          '`openssl rand -hex 32`) in the Vercel project’s environment settings, ' +
          'never in the repository. See docs/runbooks/production-security.md.',
      )
    }
    return undefined
  }

  if (value.length < MIN_RATE_LIMIT_KEY_LENGTH) {
    throw new Error(
      'Malformed server environment variable RATE_LIMIT_SECRET: it must be at least ' +
        `${MIN_RATE_LIMIT_KEY_LENGTH} characters (for example \`openssl rand -hex 32\`). ` +
        'The value is not shown.',
    )
  }

  return value
}
