/**
 * Where a backup comes from and where a restore goes — technical plan §8, §10f;
 * phase 13A (brief §18, §28); the backup-source guard added 2026-09-06.
 *
 * Both commands are handed the same three values — a database URL, an API origin
 * and a service-role key — and both must know that those values describe ONE
 * Supabase project. `assessProjectIdentity()` is that shared question, and the two
 * guards below are the answers each command needs:
 *
 * A RESTORE truncates and reloads a database, so `assessRestoreTarget()` adds a
 * typed confirmation on top of the identity check:
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
 * A BACKUP only reads, so it asks for no confirmation — but it COMBINES what it
 * reads into one recovery point, and a recovery point that pairs one project's
 * database with another project's Storage is a lie that is only discovered at
 * restore time. `assessBackupSource()` therefore fails closed on identity alone:
 *
 *   1. A loopback source (the local stack, the drill) is one project by definition.
 *   2. A hosted source must PROVE it is one project: a ref readable from the
 *      database URL, a ref readable from the API origin, and the two equal.
 *   3. Everything else — a half-loopback pair, disagreeing refs, or a host from
 *      which no ref can be read — is refused before a single byte is dumped. An
 *      unprovable source is not a partial backup; it is no backup at all.
 *
 * Rule 2 is deliberately stricter than the restore guard's, and the difference is
 * the confirmation: a restore operator types the target host, which is a statement
 * about a host a human looked at. A backup has no such statement, so the only
 * evidence it can act on is the configuration itself.
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

/** How each command joins its two halves, for the one refusal that names the act. */
const PAIRING = Object.freeze({ backup: 'combine', restore: 'load' })

/**
 * Do the two halves of a configuration — the database and the Storage API —
 * describe one Supabase project? The question both commands ask, in one place, so
 * that "which project am I pointing at" is answered identically for a backup, a
 * restore and (through `scripts/launch/lib/target.mjs`) a launch tool.
 *
 * The two rules here are the ones that hold whatever the command is: the halves
 * must be on the same side of the loopback line, and two readable refs must agree.
 * What a command does about a ref it cannot read is the command's own decision —
 * see the two guards below.
 *
 * `verb` names the operation in the refusals, because "a restore must load" and
 * "a backup must combine" are the same rule seen from two directions.
 *
 * @param {{ dbUrl: string, apiUrl: string, verb?: string }} config
 * @returns {{
 *   ok: boolean, reasons: string[], dbHost: string, apiHost: string,
 *   dbLoopback: boolean, apiLoopback: boolean, loopback: boolean,
 *   dbRef: string | null, apiRef: string | null, projectRef: string | null,
 *   description: string,
 * }}
 */
export function assessProjectIdentity({ dbUrl, apiUrl, verb = 'operation' }) {
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
        `loopback line. A ${verb} must ${PAIRING[verb] ?? 'pair'} one project’s database with that same ` +
        'project’s Storage.',
    )
  }

  if (dbRef && apiRef && dbRef !== apiRef) {
    reasons.push(
      `The database belongs to project ${dbRef} but the API to project ${apiRef}. Refusing to mix projects.`,
    )
  }

  return {
    ok: reasons.length === 0,
    reasons,
    dbHost: db.host,
    apiHost,
    dbLoopback,
    apiLoopback,
    loopback: dbLoopback && apiLoopback,
    dbRef,
    apiRef,
    projectRef: dbRef ?? apiRef,
    description: `${db.user}@${db.host}:${db.port}/${db.database} · storage at ${apiHost}`,
  }
}

/**
 * Decide whether a backup may read this source and combine what it reads into one
 * recovery point.
 *
 * There is no confirmation variable and there is no `--force`: a backup that cannot
 * PROVE its two halves belong to the same project refuses, and refuses whole. A
 * recovery point is only worth what its manifest claims about where it came from
 * (`manifest.source`), and a manifest cannot claim a project the configuration did
 * not establish.
 *
 * @param {{ dbUrl: string, apiUrl: string }} source
 * @returns {{ ok: boolean, reasons: string[], dbHost: string, apiHost: string, loopback: boolean, projectRef: string | null, description: string }}
 */
export function assessBackupSource({ dbUrl, apiUrl }) {
  const identity = assessProjectIdentity({ dbUrl, apiUrl, verb: 'backup' })
  const reasons = [...identity.reasons]

  // A hosted source proves its project or it does not run. The loopback stack is
  // exempt because there is no project to confuse it with: one container, one
  // database, one Storage API, all on this machine.
  if (!identity.loopback) {
    if (identity.dbRef === null) {
      reasons.push(
        `No Supabase project ref can be read from the database host ${identity.dbHost}. A backup ` +
          'combines a database with a Storage API and must prove they are one project; refusing an ' +
          'unidentifiable source.',
      )
    }
    if (identity.apiRef === null) {
      reasons.push(
        `No Supabase project ref can be read from the API host ${identity.apiHost}. A backup ` +
          'combines a database with a Storage API and must prove they are one project; refusing an ' +
          'unidentifiable source.',
      )
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    dbHost: identity.dbHost,
    apiHost: identity.apiHost,
    loopback: identity.loopback,
    projectRef: identity.projectRef,
    description: identity.description,
  }
}

/**
 * Decide whether a restore may proceed against this target.
 *
 * @param {{ dbUrl: string, apiUrl: string, confirmHost?: string | undefined }} target
 * @returns {{ ok: boolean, reasons: string[], dbHost: string, apiHost: string, loopback: boolean, projectRef: string | null, description: string }}
 */
export function assessRestoreTarget({ dbUrl, apiUrl, confirmHost }) {
  const db = parseDbUrl(dbUrl)
  const identity = assessProjectIdentity({ dbUrl, apiUrl, verb: 'restore' })
  const dbLoopback = identity.dbLoopback
  const apiHost = identity.apiHost
  /** @type {string[]} */
  const reasons = [...identity.reasons]

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
    loopback: identity.loopback,
    projectRef: identity.projectRef,
    description: identity.description,
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
