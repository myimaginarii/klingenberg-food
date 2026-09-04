/**
 * The PostgreSQL door — technical plan §6, §10f; phase 13A (brief §6, §7, §17).
 *
 * pg_dump and psql are the backup format. Nothing custom is invented: a recovery
 * point's database half is three plain-SQL files a stock psql can load, produced by
 * the PostgreSQL 17 client tools.
 *
 *   db/schema.sql        pg_dump --schema-only of `public`: tables, constraints,
 *                        functions, triggers, RLS policies, grants. A reference copy
 *                        for the day the repository is unavailable; the SUPPORTED
 *                        schema restore is the repository's own migrations (§10b),
 *                        which is what the drill exercises.
 *   db/data-public.sql   pg_dump --data-only of `public`, COPY format — every
 *                        application table, including audit_log.
 *   db/data-auth.sql     pg_dump --data-only of the four DURABLE auth tables (see
 *                        DURABLE_AUTH_TABLES). Sessions, refresh tokens, one-time
 *                        tokens, challenges and flow state are deliberately absent:
 *                        they are revoked on recovery anyway, and a backup is not the
 *                        place to keep live tokens.
 *
 * WHY THE TOOLS RUN THIS WAY. The connection is handed to libpq through PG*
 * environment variables — never on a command line (§8). The Supabase CLI's
 * `db dump` would have put the URL in an argument, so the tooling calls the tools
 * itself, with the same flags the CLI uses where they matter (`--data-only`,
 * `--quote-all-identifiers`, `--role postgres`, and `\restrict` lines neutralised
 * exactly as the CLI does). The tools are used natively when a PostgreSQL 17 client
 * is on the PATH, and otherwise from the official `postgres:17` image — which is
 * how the Windows development machine and the CI runner run the same code.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { commandVersion, run, runToFile } from './run.mjs'
import { isLoopbackHost, parseDbUrl } from './targets.mjs'

export const DEFAULT_PG_IMAGE = 'postgres:17'
export const DOCKER_HOST_ALIAS = 'host.docker.internal'
/** Inside the container the recovery point is mounted read-only here. */
export const DOCKER_MOUNT = '/recovery'
export const PG_DUMP_MIN_MAJOR = 17
export const PSQL_MIN_MAJOR = 16

/** The four auth tables that carry identity rather than a live session (§0ab, §5). */
export const DURABLE_AUTH_TABLES = Object.freeze([
  'auth.users',
  'auth.identities',
  'auth.mfa_factors',
  'auth.webauthn_credentials',
])

export const DATABASE_FILES = Object.freeze({
  schema: 'db/schema.sql',
  publicData: 'db/data-public.sql',
  authData: 'db/data-auth.sql',
})

const BACKSLASH = String.fromCharCode(92)

/**
 * The exact pg_dump arguments for each file. Kept as data so a test can pin them.
 *
 * @param {'schema' | 'publicData' | 'authData'} kind
 * @returns {string[]}
 */
export function pgDumpArgs(kind) {
  const common = ['--no-password', '--quote-all-identifiers', '--role=postgres', '--no-owner']
  switch (kind) {
    case 'schema':
      return [...common, '--schema-only', '--schema=public']
    case 'publicData':
      return [...common, '--data-only', '--schema=public']
    case 'authData':
      return [...common, '--data-only', ...DURABLE_AUTH_TABLES.map((table) => `--table=${table}`)]
    default:
      throw new Error(`Unknown dump kind ${String(kind)}`)
  }
}

/**
 * libpq's environment for a connection. Under Docker a loopback host becomes the
 * host gateway alias, because 127.0.0.1 inside the container is the container.
 *
 * @param {ReturnType<typeof parseDbUrl>} conn
 * @param {{ docker: boolean }} options
 * @returns {Record<string, string>}
 */
export function libpqEnv(conn, { docker }) {
  const loopback = isLoopbackHost(conn.host)
  /** @type {Record<string, string>} */
  const env = {
    PGHOST: docker && loopback ? DOCKER_HOST_ALIAS : conn.host,
    PGPORT: String(conn.port),
    PGUSER: conn.user,
    PGPASSWORD: conn.password,
    PGDATABASE: conn.database,
    PGCONNECT_TIMEOUT: '30',
    // A hosted project is reached over TLS; the local container speaks plain TCP.
    PGSSLMODE: conn.sslmode ?? (loopback ? 'disable' : 'require'),
  }
  return env
}

/**
 * pg_dump 17.6+ emits `\restrict` / `\unrestrict` psql meta-commands. They are
 * harmless to a current psql and fatal to an older one, so they are commented out —
 * the same transformation the Supabase CLI applies to its own dumps.
 *
 * @param {string} sql
 */
export function neutraliseRestrictLines(sql) {
  return sql
    .split('\n')
    .map((line) =>
      line.startsWith(BACKSLASH + 'restrict ') || line.startsWith(BACKSLASH + 'unrestrict ')
        ? '-- ' + line
        : line,
    )
    .join('\n')
}

/**
 * Rows per table in a COPY-format dump: the lines between each `COPY ... FROM stdin;`
 * and its terminating `\.`. Cheap, and it doubles as a structural check.
 *
 * @param {string} sql
 * @returns {Record<string, number>}
 */
export function countCopyRows(sql) {
  /** @type {Record<string, number>} */
  const counts = {}
  const terminator = BACKSLASH + '.'
  let current = null
  for (const line of sql.split('\n')) {
    if (current === null) {
      const match = /^COPY "([^"]+)"\."([^"]+)" \(.*\) FROM stdin;$/.exec(line)
      if (match) {
        current = `${match[1]}.${match[2]}`
        counts[current] = 0
      }
    } else if (line === terminator || line === terminator + '\r') {
      current = null
    } else {
      counts[current] += 1
    }
  }
  return counts
}

/**
 * The statement that empties every application table before a reload. Every table
 * in `public` is truncated — including the singletons the migrations insert — so the
 * COPY statements meet no primary-key conflicts. Run under
 * `session_replication_role = replica`, as the whole restore transaction is.
 */
export const TRUNCATE_PUBLIC_SQL = `do $$
declare
  v_tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ' order by tablename)
    into v_tables
    from pg_tables
   where schemaname = 'public';
  if v_tables is not null then
    execute 'truncate table ' || v_tables || ' cascade';
  end if;
end $$;`

/** The statement that empties the durable auth tables before identities are reloaded. */
export const TRUNCATE_AUTH_SQL = `truncate table ${DURABLE_AUTH_TABLES.join(', ')} cascade;`

export const APPLIED_MIGRATIONS_SQL =
  'select version from supabase_migrations.schema_migrations order by version;'

/** @param {string | null} versionLine */
export function majorVersionOf(versionLine) {
  const match = /\(PostgreSQL\)\s+(\d+)/.exec(versionLine ?? '')
  return match ? Number(match[1]) : null
}

/**
 * Open the door. `mode` is `native`, `docker`, or `auto` (native when a new enough
 * client is on the PATH, otherwise Docker).
 *
 * @param {{
 *   dbUrl: string,
 *   mode?: string | undefined,
 *   image?: string | undefined,
 *   env?: Record<string, string | undefined>,
 *   logger?: import('./run.mjs').Logger,
 * }} options
 */
export async function createPgDoor({ dbUrl, mode = 'auto', image = DEFAULT_PG_IMAGE, env = process.env, logger }) {
  const conn = parseDbUrl(dbUrl)
  logger?.addSecret(conn.password)

  let native = false
  if (mode === 'native' || mode === 'auto') {
    const dumpMajor = majorVersionOf(await commandVersion('pg_dump', env))
    const psqlMajor = majorVersionOf(await commandVersion('psql', env))
    native = dumpMajor !== null && dumpMajor >= PG_DUMP_MIN_MAJOR && psqlMajor !== null && psqlMajor >= PSQL_MIN_MAJOR
    if (mode === 'native' && !native) {
      throw new Error(
        `Native mode needs pg_dump ${PG_DUMP_MIN_MAJOR}+ and psql ${PSQL_MIN_MAJOR}+ on the PATH ` +
          `(found pg_dump ${dumpMajor ?? 'none'}, psql ${psqlMajor ?? 'none'}).`,
      )
    }
  } else if (mode !== 'docker') {
    throw new Error(`Unknown PostgreSQL tool mode "${mode}". Use native, docker or auto.`)
  }

  if (!native && (await commandVersion('docker', env)) === null) {
    throw new Error(
      `No PostgreSQL ${PG_DUMP_MIN_MAJOR} client tools on the PATH and no Docker to run ${image}. ` +
        'Install postgresql-client-17, or start Docker.',
    )
  }

  const pgEnv = libpqEnv(conn, { docker: !native })
  const baseEnv = /** @type {Record<string, string | undefined>} */ ({ ...env, ...pgEnv })

  /**
   * @param {string} tool
   * @param {readonly string[]} args
   * @param {{ mountDir?: string } & Record<string, unknown>} [options]
   * @returns {{ file: string, args: string[] }}
   */
  function command(tool, args, { mountDir } = {}) {
    if (native) return { file: tool, args: [...args] }
    const dockerArgs = [
      'run',
      '--rm',
      '--interactive',
      `--add-host=${DOCKER_HOST_ALIAS}:host-gateway`,
      ...Object.keys(pgEnv).flatMap((name) => ['--env', name]),
    ]
    if (mountDir) dockerArgs.push('--volume', `${resolve(mountDir)}:${DOCKER_MOUNT}:ro`)
    dockerArgs.push(image, tool, ...args)
    return { file: 'docker', args: dockerArgs }
  }

  /** @param {string} dir @param {string} relativeFile */
  function fileArg(dir, relativeFile) {
    return native ? resolve(dir, relativeFile) : `${DOCKER_MOUNT}/${relativeFile.split(/[\\/]/).join('/')}`
  }

  return {
    mode: native ? 'native' : 'docker',
    describe: () => (native ? 'native pg_dump/psql on the PATH' : `pg_dump/psql from the ${image} image`),

    /**
     * Produce one dump file. Returns the byte count after the restrict lines have
     * been neutralised.
     *
     * @param {'schema' | 'publicData' | 'authData'} kind
     * @param {string} outFile
     */
    async dump(kind, outFile) {
      const { file, args } = command('pg_dump', pgDumpArgs(kind))
      await runToFile(file, args, outFile, { env: baseEnv, logger })
      const raw = await readFile(outFile, 'utf8')
      const cleaned = neutraliseRestrictLines(raw)
      if (cleaned !== raw) await writeFile(outFile, cleaned)
      return { bytes: Buffer.byteLength(cleaned) }
    },

    /**
     * Run psql with `-c` commands and `-f` files, in order, in one transaction,
     * stopping at the first error. `files` are relative to `dir`.
     *
     * @param {{ commands?: readonly string[], files?: readonly string[], dir?: string, singleTransaction?: boolean }} options
     */
    async psql({ commands = [], files = [], dir, singleTransaction = true }) {
      const args = ['--no-password', '--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1']
      if (singleTransaction) args.push('--single-transaction')
      // Commands first, then files: the restore's SET and TRUNCATE precede the COPYs.
      for (const sql of commands) args.push('--command', sql)
      for (const relativeFile of files) {
        if (!dir) throw new Error('psql files need a directory.')
        args.push('--file', fileArg(dir, relativeFile))
      }
      const { file, args: full } = command('psql', args, { mountDir: files.length > 0 ? dir : undefined })
      return run(file, full, { env: baseEnv, logger })
    },

    /** One query, tuples only, trimmed. @param {string} sql */
    async query(sql) {
      const { file, args } = command('psql', [
        '--no-password',
        '--no-psqlrc',
        '--tuples-only',
        '--no-align',
        '--set',
        'ON_ERROR_STOP=1',
        '--command',
        sql,
      ])
      const { stdout } = await run(file, args, { env: baseEnv, logger })
      return stdout.trim()
    },

    /** The migration versions applied to this database, oldest first. */
    async appliedMigrations() {
      const out = await this.query(APPLIED_MIGRATIONS_SQL)
      return out ? out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : []
    },
  }
}
