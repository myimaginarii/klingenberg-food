import 'server-only'

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
