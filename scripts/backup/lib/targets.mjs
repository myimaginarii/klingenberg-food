/**
 * Where a backup comes from and where a restore goes — technical plan §8, §10f;
 * phase 13A (brief §18, §28).
 *
 * A backup source needs no confirmation: reading is safe. A restore target is a
 * database that is about to be truncated and reloaded, so this module is where
 * "be careful" is replaced by rules:
 *
 *   1. A loopback target (the local stack, the drill) needs nothing further.
 *   2. Any other target is refused unless the operator has named its exact database
 *      host in BACKUP_RESTORE_CONFIRM_HOST. There is no `--force`; the confirmation
 *      is the hostname itself, typed on purpose.
 *   3. The database and the API must be on the same side of the loopback line, and
 *      when both name a Supabase project ref the refs must agree — a restore that
 *      loads one project's database and another project's Storage is the
 *      cross-environment confusion this guard exists for.
 *
 * Nothing here ever returns a password. `describeDbUrl()` is what the commands print.
 */

export const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** @param {string} host */
export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

/**
 * Parse a PostgreSQL connection URL into the pieces libpq wants as PG* variables.
 * Only `postgres:` and `postgresql:` schemes are accepted; the password is
 * percent-decoded because that is how libpq expects to receive it.
 *
 * @param {string} url
 */
export function parseDbUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('The database URL is not a valid URL.')
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`The database URL must use postgres:// or postgresql://, not ${parsed.protocol}`)
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (!host) throw new Error('The database URL names no host.')
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres'
  return {
    host,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username) || 'postgres',
    password: parsed.password ? decodeURIComponent(parsed.password) : '',
    database,
    sslmode: parsed.searchParams.get('sslmode') ?? undefined,
  }
}

/** A printable description of a database target — never the password. @param {string} url */
export function describeDbUrl(url) {
  const c = parseDbUrl(url)
  return `${c.user}@${c.host}:${c.port}/${c.database}`
}

/** @param {string} apiUrl */
export function apiHostOf(apiUrl) {
  try {
    return new URL(apiUrl).hostname
  } catch {
    throw new Error('The Supabase API URL is not a valid URL.')
  }
}

/** The project ref of a hosted API origin, or null for anything else. @param {string} apiUrl */
export function projectRefFromApiUrl(apiUrl) {
  const host = apiHostOf(apiUrl)
  const match = /^([a-z0-9]{20})\.supabase\.(?:co|in|red)$/.exec(host)
  return match ? match[1] : null
}

/**
 * The project ref a database URL belongs to: the direct host `db.<ref>.supabase.co`
 * or the pooler user `postgres.<ref>`. Null for a local or unrecognised target.
 *
 * @param {string} dbUrl
 */
export function projectRefFromDbUrl(dbUrl) {
  const c = parseDbUrl(dbUrl)
  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.(?:co|in|red)$/.exec(c.host)
  if (fromHost) return fromHost[1]
  const fromUser = /^postgres\.([a-z0-9]{20})$/.exec(c.user)
  return fromUser ? fromUser[1] : null
}

/**
 * Decide whether a restore may proceed against this target.
 *
 * @param {{ dbUrl: string, apiUrl: string, confirmHost?: string | undefined }} target
 * @returns {{ ok: boolean, reasons: string[], dbHost: string, apiHost: string, loopback: boolean, projectRef: string | null, description: string }}
 */
export function assessRestoreTarget({ dbUrl, apiUrl, confirmHost }) {
  const db = parseDbUrl(dbUrl)
  const apiHost = apiHostOf(apiUrl)
  const dbLoopback = isLoopbackHost(db.host)
  const apiLoopback = isLoopbackHost(apiHost)
  const dbRef = projectRefFromDbUrl(dbUrl)
  const apiRef = projectRefFromApiUrl(apiUrl)
  /** @type {string[]} */
  const reasons = []

  if (dbLoopback !== apiLoopback) {
    reasons.push(
      `The database (${db.host}) and the API (${apiHost}) are not on the same side of the ` +
        'loopback line. A restore must load one project’s database and that same ' +
        'project’s Storage.',
    )
  }

  if (dbRef && apiRef && dbRef !== apiRef) {
    reasons.push(
      `The database belongs to project ${dbRef} but the API to project ${apiRef}. Refusing to mix projects.`,
    )
  }

  if (!dbLoopback) {
    const confirmed = (confirmHost ?? '').trim().toLowerCase()
    if (!confirmed) {
      reasons.push(
        `The target ${db.host} is not the local stack. A restore truncates and reloads it; ` +
          'to proceed, set the confirmation variable to exactly that host name.',
      )
    } else if (confirmed !== db.host.toLowerCase()) {
      reasons.push(
        `The confirmation names "${confirmed}" but the target database host is "${db.host}". ` +
          'They must match exactly.',
      )
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    dbHost: db.host,
    apiHost,
    loopback: dbLoopback && apiLoopback,
    projectRef: dbRef ?? apiRef,
    description: `${db.user}@${db.host}:${db.port}/${db.database} · storage at ${apiHost}`,
  }
}

/**
 * Remove secret values from a string before it is logged or thrown. Also masks the
 * password in any URL that carries `user:password@` credentials, so a connection
 * string that arrives inside a tool's error message cannot leak either.
 *
 * @param {string} text
 * @param {readonly string[]} secrets
 */
export function redactSecrets(text, secrets) {
  let out = text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1[redacted]@')
  for (const secret of secrets) {
    if (secret.length < 4) continue
    out = out.split(secret).join('[redacted]')
  }
  return out
}
