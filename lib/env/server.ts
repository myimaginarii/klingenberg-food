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
