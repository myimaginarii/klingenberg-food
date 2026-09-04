/**
 * Environment access for the backup tooling — technical plan §8, §10e, §10f; phase 13A.
 *
 * This is the ONE file under scripts/backup that names a secret. Every other module
 * receives values as function arguments and never touches `process.env`, which is what
 * keeps `scripts/check-source-policy.mjs`'s allow-list at one entry for the whole
 * tooling. The scripts cannot import `lib/env/server.ts` — it imports `server-only`
 * and belongs to the Next.js runtime — so this module is the Node-side counterpart,
 * in the family of `scripts/seed-local-users.mjs`.
 *
 * Nothing here prints a value. Errors name the variable that is missing and nothing
 * else (§8 — log hygiene).
 */

/** Every variable the tooling reads, by role. Tests reference these, never the literals. */
export const NAMES = Object.freeze({
  /** PostgreSQL connection string of the source (backup) or target (restore) project. */
  dbUrl: 'SUPABASE_DB_URL',
  /** The project's API origin — the same variable the application uses. */
  apiUrl: 'NEXT_PUBLIC_SUPABASE_URL',
  /** The service-role key: the trusted administrative door to Storage (§8). */
  serviceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY',

  /** Off-platform destination: any S3-compatible private bucket (§10f). */
  s3Endpoint: 'BACKUP_S3_ENDPOINT',
  s3Bucket: 'BACKUP_S3_BUCKET',
  s3Region: 'BACKUP_S3_REGION',
  s3Prefix: 'BACKUP_S3_PREFIX',
  s3AccessKeyId: 'BACKUP_S3_ACCESS_KEY_ID',
  s3SecretAccessKey: 'BACKUP_S3_SECRET_ACCESS_KEY',

  /** Restore safety: the exact database host an operator confirms for a remote target. */
  restoreConfirmHost: 'BACKUP_RESTORE_CONFIRM_HOST',

  /** Tooling knobs — none of them secret. */
  pgMode: 'BACKUP_PG_MODE',
  pgImage: 'BACKUP_PG_IMAGE',
  awsCli: 'BACKUP_AWS_CLI',
})

export const DEFAULT_S3_REGION = 'auto'
export const DEFAULT_S3_PREFIX = 'klingenberg-food'

export class MissingEnvError extends Error {
  /** @param {string[]} names */
  constructor(names) {
    super(
      `Missing required environment variable(s): ${names.join(', ')}. ` +
        'See .env.example and docs/runbooks/backups.md for where each value lives.',
    )
    this.name = 'MissingEnvError'
    this.names = names
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 */
function read(env, name) {
  const value = env[name]?.trim()
  return value ? value : undefined
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[]} names
 */
function requireAll(env, names) {
  const missing = names.filter((name) => read(env, name) === undefined)
  if (missing.length > 0) throw new MissingEnvError(missing)
}

/**
 * The Supabase project the tooling talks to: the database for pg_dump/psql and the
 * API + service role for Storage. The same three values describe a backup source
 * and a restore target — which is exactly why restore demands its own confirmation
 * (see targets.mjs).
 *
 * @param {Record<string, string | undefined>} env
 */
export function readProject(env = process.env) {
  requireAll(env, [NAMES.dbUrl, NAMES.apiUrl, NAMES.serviceRoleKey])
  return {
    dbUrl: /** @type {string} */ (read(env, NAMES.dbUrl)),
    apiUrl: /** @type {string} */ (read(env, NAMES.apiUrl)),
    serviceRoleKey: /** @type {string} */ (read(env, NAMES.serviceRoleKey)),
  }
}

/**
 * The off-platform destination (§10f). Provider-neutral: an endpoint, a bucket, a
 * key pair. Region defaults to `auto` (what R2 expects; harmless elsewhere) and the
 * prefix to the project name.
 *
 * @param {Record<string, string | undefined>} env
 */
export function readDestination(env = process.env) {
  requireAll(env, [NAMES.s3Endpoint, NAMES.s3Bucket, NAMES.s3AccessKeyId, NAMES.s3SecretAccessKey])
  return {
    endpoint: /** @type {string} */ (read(env, NAMES.s3Endpoint)),
    bucket: /** @type {string} */ (read(env, NAMES.s3Bucket)),
    region: read(env, NAMES.s3Region) ?? DEFAULT_S3_REGION,
    prefix: read(env, NAMES.s3Prefix) ?? DEFAULT_S3_PREFIX,
    accessKeyId: /** @type {string} */ (read(env, NAMES.s3AccessKeyId)),
    secretAccessKey: /** @type {string} */ (read(env, NAMES.s3SecretAccessKey)),
  }
}

/** Non-secret knobs, all optional. @param {Record<string, string | undefined>} env */
export function readOptions(env = process.env) {
  return {
    restoreConfirmHost: read(env, NAMES.restoreConfirmHost),
    pgMode: read(env, NAMES.pgMode),
    pgImage: read(env, NAMES.pgImage),
    awsCli: read(env, NAMES.awsCli),
  }
}

/**
 * Every secret value present in the environment, for the logger's redaction list.
 * The database URL is included whole and its password separately, so neither form
 * can reach a log line.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function secretValues(env = process.env) {
  const values = []
  for (const name of [NAMES.dbUrl, NAMES.serviceRoleKey, NAMES.s3AccessKeyId, NAMES.s3SecretAccessKey]) {
    const value = read(env, name)
    if (value) values.push(value)
  }
  const dbUrl = read(env, NAMES.dbUrl)
  if (dbUrl) {
    const password = passwordOf(dbUrl)
    if (password) values.push(password)
  }
  return values
}

/** @param {string} url */
function passwordOf(url) {
  try {
    const password = new URL(url).password
    return password ? decodeURIComponent(password) : undefined
  } catch {
    return undefined
  }
}
