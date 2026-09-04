import { resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BUCKETS, isSafeObjectKey, localPathForObject, parseCacheControlSeconds } from '../../../scripts/backup/lib/keys.mjs'
import {
  DURABLE_AUTH_TABLES,
  TRUNCATE_AUTH_SQL,
  TRUNCATE_PUBLIC_SQL,
  countCopyRows,
  libpqEnv,
  majorVersionOf,
  neutraliseRestrictLines,
  pgDumpArgs,
} from '../../../scripts/backup/lib/pg.mjs'
import { awsEnvFor, compareInventories, parseListing } from '../../../scripts/backup/lib/ship.mjs'

/**
 * Storage key mapping, the PostgreSQL door's arguments, and the shipping
 * comparison — technical plan §6, §8, §10f; phase 13A (brief §6, §8, §26, §28).
 */

const BACKSLASH = String.fromCharCode(92)

describe('object keys', () => {
  it('the two buckets keep their privacy', () => {
    expect(BUCKETS.map((b) => [b.name, b.public])).toEqual([
      ['media-originals', false],
      ['media', true],
    ])
  })

  it('accept the pipeline grammar and any honest slash-separated key', () => {
    expect(isSafeObjectKey('8f3c2a1b-1234-4abc-8def-0123456789ab/original.jpg')).toBe(true)
    expect(isSafeObjectKey('8f3c2a1b-1234-4abc-8def-0123456789ab/960.avif')).toBe(true)
    expect(isSafeObjectKey('deep/er/key.bin')).toBe(true)
  })

  it('refuse traversal, absolute paths, backslashes, control characters and empty segments', () => {
    for (const key of ['../x', 'a/../b', 'a/./b', '/a', 'a//b', 'a/', '', 'a' + BACKSLASH + 'b', 'a' + String.fromCharCode(0) + 'b', 'x'.repeat(1025), 42]) {
      expect(isSafeObjectKey(key), JSON.stringify(key)).toBe(false)
    }
  })

  it('map a key inside the recovery point and never outside it', () => {
    const root = resolve('rp')
    expect(localPathForObject(root, 'media', 'u/480.webp')).toBe(resolve(root, 'storage', 'media', 'u', '480.webp'))
    expect(localPathForObject(root, 'media', 'u/480.webp').startsWith(root + sep)).toBe(true)
    expect(() => localPathForObject(root, 'media', '../../etc/passwd')).toThrow(/unsafe/)
    expect(() => localPathForObject(root, 'other-bucket', 'a/b')).toThrow(/Unknown bucket/)
  })

  it('read the seconds out of a stored cache header', () => {
    expect(parseCacheControlSeconds('max-age=31536000')).toBe('31536000')
    expect(parseCacheControlSeconds('public, max-age=3600')).toBe('3600')
    expect(parseCacheControlSeconds('no-cache')).toBeUndefined()
    expect(parseCacheControlSeconds(null)).toBeUndefined()
  })
})

describe('the PostgreSQL door', () => {
  it('dumps the public schema, the public data, and exactly the durable auth tables', () => {
    expect(pgDumpArgs('schema')).toEqual(['--no-password', '--quote-all-identifiers', '--role=postgres', '--no-owner', '--schema-only', '--schema=public'])
    expect(pgDumpArgs('publicData')).toContain('--data-only')
    expect(pgDumpArgs('publicData')).toContain('--schema=public')
    const auth = pgDumpArgs('authData')
    expect(auth).toContain('--data-only')
    expect(auth.filter((a) => a.startsWith('--table='))).toEqual(DURABLE_AUTH_TABLES.map((t) => `--table=${t}`))
    expect(DURABLE_AUTH_TABLES).toEqual(['auth.users', 'auth.identities', 'auth.mfa_factors', 'auth.webauthn_credentials'])
    // No live-session table is ever dumped.
    for (const transient of ['auth.sessions', 'auth.refresh_tokens', 'auth.one_time_tokens', 'auth.flow_state']) {
      expect(auth.join(' ')).not.toContain(transient)
    }
    expect(() => pgDumpArgs('roles')).toThrow()
  })

  it('hands the connection to libpq through the environment, with the Docker host alias', () => {
    const conn = { host: '127.0.0.1', port: 54322, user: 'postgres', password: 'pw', database: 'postgres', sslmode: undefined }
    expect(libpqEnv(conn, { docker: false })).toMatchObject({ PGHOST: '127.0.0.1', PGPORT: '54322', PGPASSWORD: 'pw', PGSSLMODE: 'disable' })
    expect(libpqEnv(conn, { docker: true })).toMatchObject({ PGHOST: 'host.docker.internal' })
    const hosted = { ...conn, host: 'db.example.test', port: 5432 }
    expect(libpqEnv(hosted, { docker: true })).toMatchObject({ PGHOST: 'db.example.test', PGSSLMODE: 'require' })
    expect(libpqEnv({ ...hosted, sslmode: 'verify-full' }, { docker: false }).PGSSLMODE).toBe('verify-full')
  })

  it('neutralises the restrict meta-commands the way the Supabase CLI does', () => {
    const sql = [BACKSLASH + 'restrict abc', 'SET x = 1;', BACKSLASH + 'unrestrict abc', 'COPY "a"."b" ("c") FROM stdin;', BACKSLASH + '.'].join('\n')
    const out = neutraliseRestrictLines(sql)
    expect(out.split('\n')[0]).toBe('-- ' + BACKSLASH + 'restrict abc')
    expect(out.split('\n')[2]).toBe('-- ' + BACKSLASH + 'unrestrict abc')
    expect(out.split('\n')[4]).toBe(BACKSLASH + '.')
  })

  it('counts the rows of each COPY block', () => {
    const sql = [
      'COPY "public"."dishes" ("id", "name") FROM stdin;',
      'a\tb',
      'c\td',
      BACKSLASH + '.',
      '',
      'COPY "auth"."users" ("id") FROM stdin;',
      BACKSLASH + '.',
      'COPY "public"."news" ("id") FROM stdin;',
      'x',
      BACKSLASH + '.',
    ].join('\n')
    expect(countCopyRows(sql)).toEqual({ 'public.dishes': 2, 'auth.users': 0, 'public.news': 1 })
  })

  it('truncates every application table and the durable auth tables, nothing else', () => {
    expect(TRUNCATE_PUBLIC_SQL).toContain("schemaname = 'public'")
    expect(TRUNCATE_PUBLIC_SQL).toContain('truncate table')
    expect(TRUNCATE_AUTH_SQL).toBe('truncate table auth.users, auth.identities, auth.mfa_factors, auth.webauthn_credentials cascade;')
  })

  it('reads a client major version', () => {
    expect(majorVersionOf('pg_dump (PostgreSQL) 17.6')).toBe(17)
    expect(majorVersionOf('psql (PostgreSQL) 16.10 (Ubuntu 16.10-0ubuntu0.24.04.1)')).toBe(16)
    expect(majorVersionOf(null)).toBeNull()
  })
})

describe('shipping', () => {
  it('gives the AWS CLI its key pair and nothing else secret', () => {
    const env = awsEnvFor(
      { accessKeyId: 'AK', secretAccessKey: 'SK', region: 'auto' },
      { PATH: '/bin', HOME: '/home/x', SOME_SERVICE_KEY: 'leak', PGPASSWORD: 'leak', SOMETHING_ELSE: 'leak' },
    )
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/home/x', AWS_ACCESS_KEY_ID: 'AK', AWS_SECRET_ACCESS_KEY: 'SK', AWS_DEFAULT_REGION: 'auto' })
    expect(Object.values(env)).not.toContain('leak')
    expect(env.AWS_REQUEST_CHECKSUM_CALCULATION).toBe('when_required')
  })

  it('reads a listing back relative to the prefix, and tolerates an empty one', () => {
    const json = JSON.stringify({ Contents: [{ Key: 'p/weekly/id/manifest.json', Size: 3 }, { Key: 'p/weekly/id/db/x.sql', Size: 10 }, { Key: 'p/other', Size: 1 }] })
    expect(parseListing(json, 'p/weekly/id/')).toEqual([
      { key: 'db/x.sql', bytes: 10 },
      { key: 'manifest.json', bytes: 3 },
    ])
    expect(parseListing('', 'p/')).toEqual([])
    expect(parseListing('{}', 'p/')).toEqual([])
  })

  it('reports what is missing or the wrong size, so a partial upload never becomes latest', () => {
    const local = [{ key: 'a', bytes: 1 }, { key: 'b', bytes: 2 }, { key: 'c', bytes: 3 }]
    const remote = [{ key: 'a', bytes: 1 }, { key: 'b', bytes: 9 }, { key: 'd', bytes: 4 }]
    expect(compareInventories(local, remote)).toEqual({ missing: ['c'], mismatched: ['b'], extra: ['d'] })
    expect(compareInventories(local, local)).toEqual({ missing: [], mismatched: [], extra: [] })
  })
})
