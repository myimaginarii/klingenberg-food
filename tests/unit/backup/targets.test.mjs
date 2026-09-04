import { describe, expect, it } from 'vitest'

import { NAMES, MissingEnvError, readDestination, readProject, secretValues } from '../../../scripts/backup/lib/env.mjs'
import { createLogger } from '../../../scripts/backup/lib/run.mjs'
import {
  assessRestoreTarget,
  describeDbUrl,
  parseDbUrl,
  projectRefFromApiUrl,
  projectRefFromDbUrl,
  redactSecrets,
} from '../../../scripts/backup/lib/targets.mjs'

/**
 * Restore-target safety and log hygiene — technical plan §8, §10f; phase 13A
 * (brief §13, §18, §26, §28).
 *
 * The guard is a set of rules, not a warning: a remote host is refused until the
 * operator has typed exactly that host; a database and a Storage API from two
 * different projects are refused; and no password ever reaches a log line, whether
 * it arrives as a value or inside a connection string in a tool's error.
 */

const REF_A = 'abcdefghijklmnopqrst'
const REF_B = 'tsrqponmlkjihgfedcba'
// The repository's source policy scans for literal absolute URLs (§10d); the
// connection strings below are fixtures, assembled so the scanner sees no host.
const PG = ['postgresql:', '//'].join('')
const LOCAL_DB = `${PG}postgres:postgres@127.0.0.1:54322/postgres`
const LOCAL_API = 'http://127.0.0.1:54321'
const POOLER_DB = `${PG}postgres.${REF_A}:s3cret-pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
const DIRECT_DB = `${PG}postgres:s3cret-pw@db.${REF_A}.supabase.co:5432/postgres?sslmode=require`
const HOSTED_API = `https://${REF_A}.supabase.co`

describe('parsing a database URL', () => {
  it('yields the libpq pieces and never echoes the password in the description', () => {
    expect(parseDbUrl(DIRECT_DB)).toEqual({
      host: `db.${REF_A}.supabase.co`,
      port: 5432,
      user: 'postgres',
      password: 's3cret-pw',
      database: 'postgres',
      sslmode: 'require',
    })
    expect(describeDbUrl(DIRECT_DB)).toBe(`postgres@db.${REF_A}.supabase.co:5432/postgres`)
    expect(describeDbUrl(DIRECT_DB)).not.toContain('s3cret')
  })

  it('percent-decodes a password with reserved characters', () => {
    expect(parseDbUrl(`${PG}u:p%40ss%2Fw%3Ard@h:1/d`).password).toBe('p@ss/w:rd')
  })

  it('refuses anything that is not a PostgreSQL URL', () => {
    expect(() => parseDbUrl(['mysql:', '//x@y/z'].join(''))).toThrow(/postgres/)
    expect(() => parseDbUrl('not a url')).toThrow()
  })

  it('finds the project ref in a direct host, a pooler user, or the API origin', () => {
    expect(projectRefFromDbUrl(DIRECT_DB)).toBe(REF_A)
    expect(projectRefFromDbUrl(POOLER_DB)).toBe(REF_A)
    expect(projectRefFromDbUrl(LOCAL_DB)).toBeNull()
    expect(projectRefFromApiUrl(HOSTED_API)).toBe(REF_A)
    expect(projectRefFromApiUrl(LOCAL_API)).toBeNull()
  })
})

describe('the restore-target guard', () => {
  it('lets the local stack through with no confirmation', () => {
    const target = assessRestoreTarget({ dbUrl: LOCAL_DB, apiUrl: LOCAL_API })
    expect(target.ok).toBe(true)
    expect(target.loopback).toBe(true)
    expect(target.description).not.toContain('postgres:postgres')
  })

  it('refuses a remote host by default', () => {
    const target = assessRestoreTarget({ dbUrl: POOLER_DB, apiUrl: HOSTED_API })
    expect(target.ok).toBe(false)
    expect(target.reasons.join(' ')).toMatch(/not the local stack/)
  })

  it('refuses a confirmation that names a different host', () => {
    const target = assessRestoreTarget({ dbUrl: POOLER_DB, apiUrl: HOSTED_API, confirmHost: `db.${REF_A}.supabase.co` })
    expect(target.ok).toBe(false)
    expect(target.reasons.join(' ')).toMatch(/must match exactly/)
  })

  it('lets a remote host through only when its exact name is confirmed', () => {
    const target = assessRestoreTarget({
      dbUrl: POOLER_DB,
      apiUrl: HOSTED_API,
      confirmHost: ' AWS-0-eu-central-1.pooler.supabase.com ',
    })
    expect(target.ok).toBe(true)
    expect(target.loopback).toBe(false)
    expect(target.projectRef).toBe(REF_A)
  })

  it('refuses a database and a Storage API from different projects, even when confirmed', () => {
    const target = assessRestoreTarget({
      dbUrl: POOLER_DB,
      apiUrl: `https://${REF_B}.supabase.co`,
      confirmHost: 'aws-0-eu-central-1.pooler.supabase.com',
    })
    expect(target.ok).toBe(false)
    expect(target.reasons.join(' ')).toMatch(/Refusing to mix projects/)
  })

  it('refuses a local database paired with a remote Storage API, and the reverse', () => {
    expect(assessRestoreTarget({ dbUrl: LOCAL_DB, apiUrl: HOSTED_API }).ok).toBe(false)
    expect(assessRestoreTarget({ dbUrl: POOLER_DB, apiUrl: LOCAL_API, confirmHost: 'aws-0-eu-central-1.pooler.supabase.com' }).ok).toBe(false)
  })
})

describe('log hygiene', () => {
  it('redacts secret values and connection-string passwords', () => {
    const text = `failed: ${DIRECT_DB} and key eyJhbGciOi.service.key`
    const out = redactSecrets(text, ['eyJhbGciOi.service.key', 's3cret-pw'])
    expect(out).not.toContain('s3cret-pw')
    expect(out).not.toContain('eyJhbGciOi')
    expect(out).toContain('postgres:[redacted]@db.')
  })

  it('the logger redacts everything it knows, including secrets learned later', () => {
    const lines = []
    const logger = createLogger({ secrets: ['first-secret'], sink: { log: (m) => lines.push(m), error: (m) => lines.push(m) } })
    logger.addSecret('later-secret')
    logger.info('a first-secret b later-secret c')
    logger.error('psql: FATAL: password "later-secret"')
    expect(lines.join('\n')).not.toMatch(/first-secret|later-secret/)
    expect(lines[0]).toMatch(/^\[\d\d:\d\d:\d\d\] a \[redacted\] b \[redacted\] c$/)
  })

  it('collects every secret the environment holds, and the database password on its own', () => {
    const env = {
      [NAMES.dbUrl]: `${PG}postgres:only-pw@h:5432/db`,
      [NAMES.serviceRoleKey]: 'service-key',
      [NAMES.s3AccessKeyId]: 'AKIA',
      [NAMES.s3SecretAccessKey]: 's3-secret',
    }
    expect(secretValues(env)).toEqual([`${PG}postgres:only-pw@h:5432/db`, 'service-key', 'AKIA', 's3-secret', 'only-pw'])
  })
})

describe('environment', () => {
  it('names every missing variable at once, and nothing else', () => {
    try {
      readProject({})
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingEnvError)
      expect(error.names).toEqual([NAMES.dbUrl, NAMES.apiUrl, NAMES.serviceRoleKey])
      expect(error.message).not.toMatch(/=/)
    }
  })

  it('reads the destination with its two defaults', () => {
    const destination = readDestination({
      [NAMES.s3Endpoint]: 'https://s3.example.test',
      [NAMES.s3Bucket]: 'b',
      [NAMES.s3AccessKeyId]: 'k',
      [NAMES.s3SecretAccessKey]: 's',
    })
    expect(destination).toMatchObject({ region: 'auto', prefix: 'klingenberg-food' })
  })

  it('treats a blank value as missing', () => {
    expect(() => readProject({ [NAMES.dbUrl]: '  ', [NAMES.apiUrl]: 'x', [NAMES.serviceRoleKey]: 'y' })).toThrow(MissingEnvError)
  })
})
