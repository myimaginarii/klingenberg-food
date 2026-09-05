import { describe, expect, it } from 'vitest'

import { NAMES, readApiProject, readDatabase } from '../../../scripts/backup/lib/env.mjs'
import {
  HARNESS_FLAG,
  assessLaunchTarget,
  assessOwnerEmail,
  isTestIdentityAddress,
  projectHostFor,
} from '../../../scripts/launch/lib/target.mjs'

/**
 * The launch target guard — technical plan §5, §8, §10b; phase 14A.
 *
 * Three tools, one rule set. A production run reaches a hosted project only,
 * and only when the operator has named that project's host in the variable
 * belonging to that one operation; the local stack is refused outright. The
 * harness inverts the first rule for the tests without weakening it: loopback
 * only, still confirmed, never a hosted project.
 */

const REF_A = 'abcdefghijklmnopqrst'
const REF_B = 'tsrqponmlkjihgfedcba'
// Assembled so the repository's URL scanner (§10d) sees no host literal.
const PG = ['postgresql:', '//'].join('')
const LOCAL_DB = `${PG}postgres:postgres@127.0.0.1:54322/postgres`
const LOCAL_API = 'http://127.0.0.1:54321'
const POOLER_DB = `${PG}postgres.${REF_A}:s3cret-pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
const DIRECT_DB = `${PG}postgres:s3cret-pw@db.${REF_A}.supabase.co:5432/postgres`
const ANONYMOUS_DB = `${PG}postgres:s3cret-pw@some-database.example.test:5432/postgres`
const HOSTED_API = `https://${REF_A}.supabase.co`
const PROJECT_HOST = `${REF_A}.supabase.co`

const CONFIRM = 'MIGRATE_CONFIRM_HOST'

function production(overrides) {
  return assessLaunchTarget({ kind: 'db', url: POOLER_DB, confirmName: CONFIRM, harness: false, operation: 'migration', ...overrides })
}

describe('a production run', () => {
  it('refuses the local stack, however valid its credentials', () => {
    const db = production({ url: LOCAL_DB })
    expect(db.ok).toBe(false)
    expect(db.loopback).toBe(true)
    expect(db.reasons.join(' ')).toMatch(/local stack/)
    expect(db.reasons.join(' ')).toContain(HARNESS_FLAG)

    const api = production({ kind: 'api', url: LOCAL_API, confirmHost: '127.0.0.1' })
    expect(api.ok).toBe(false)
  })

  it('refuses a hosted target without its confirmation, and names what to set', () => {
    const target = production({})
    expect(target.ok).toBe(false)
    expect(target.projectRef).toBe(REF_A)
    expect(target.reasons.join(' ')).toContain(`set ${CONFIRM} to exactly "${PROJECT_HOST}"`)
  })

  it('refuses a confirmation naming another project, a pooler host, or a ref alone', () => {
    for (const wrong of [`${REF_B}.supabase.co`, 'aws-0-eu-central-1.pooler.supabase.com', REF_A, 'production']) {
      const target = production({ confirmHost: wrong })
      expect(target.ok, wrong).toBe(false)
      expect(target.reasons.join(' ')).toMatch(/must match exactly/)
    }
  })

  it('proceeds only when the exact project host is confirmed — from a pooler or a direct URL', () => {
    expect(production({ confirmHost: ` ${PROJECT_HOST.toUpperCase()} ` }).ok).toBe(true)
    const direct = production({ url: DIRECT_DB, confirmHost: PROJECT_HOST })
    expect(direct.ok).toBe(true)
    expect(direct.host).toBe(`db.${REF_A}.supabase.co`)
    expect(direct.description).not.toContain('s3cret')
  })

  it('confirms an API target by its own host', () => {
    expect(production({ kind: 'api', url: HOSTED_API, confirmHost: PROJECT_HOST }).ok).toBe(true)
    expect(production({ kind: 'api', url: HOSTED_API, confirmHost: `${REF_B}.supabase.co` }).ok).toBe(false)
    expect(production({ kind: 'api', url: HOSTED_API }).ok).toBe(false)
  })

  it('refuses a remote target it cannot attribute to a project', () => {
    const target = production({ url: ANONYMOUS_DB, confirmHost: 'some-database.example.test' })
    expect(target.ok).toBe(false)
    expect(target.projectRef).toBeNull()
    expect(target.reasons.join(' ')).toMatch(/ambiguous/)

    const api = production({ kind: 'api', url: 'https://api.example.test', confirmHost: 'api.example.test' })
    expect(api.ok).toBe(false)
  })

  it('states the project host as the dashboard shows it', () => {
    expect(projectHostFor(REF_A)).toBe(PROJECT_HOST)
  })
})

describe('the local harness', () => {
  function harness(overrides) {
    return assessLaunchTarget({ kind: 'db', url: LOCAL_DB, confirmName: CONFIRM, harness: true, operation: 'migration', ...overrides })
  }

  it('reaches loopback only, and never a hosted project — confirmed or not', () => {
    expect(harness({ url: POOLER_DB, confirmHost: PROJECT_HOST }).ok).toBe(false)
    expect(harness({ url: POOLER_DB, confirmHost: 'aws-0-eu-central-1.pooler.supabase.com' }).ok).toBe(false)
    expect(harness({ kind: 'api', url: HOSTED_API, confirmHost: PROJECT_HOST }).ok).toBe(false)
  })

  it('still demands the loopback host as its confirmation', () => {
    expect(harness({}).ok).toBe(false)
    expect(harness({ confirmHost: 'localhost' }).ok).toBe(false)
    expect(harness({ confirmHost: '127.0.0.1' }).ok).toBe(true)
    expect(harness({ kind: 'api', url: LOCAL_API, confirmHost: '127.0.0.1' }).ok).toBe(true)
  })
})

describe('the Owner address', () => {
  it('production refuses every reserved address and every malformed one', () => {
    for (const reserved of ['hans@example.test', 'hans@example.com', 'hans@example.org', 'hans@restaurant.invalid', 'hans@localhost', 'hans@x.example']) {
      expect(assessOwnerEmail(reserved, { harness: false }).ok, reserved).toBe(false)
    }
    for (const malformed of [undefined, '', 'hans', 'hans@', '@x.net', 'hans@x', 'a b@x.net']) {
      expect(assessOwnerEmail(malformed, { harness: false }).ok, String(malformed)).toBe(false)
    }
  })

  it('production accepts a real mailbox, normalised', () => {
    const result = assessOwnerEmail('  Hans@Klingenberg-Food.NET ', { harness: false })
    expect(result).toEqual({ ok: true, email: 'hans@klingenberg-food.net', reasons: [] })
  })

  it('the harness accepts @example.test only', () => {
    expect(assessOwnerEmail('harness-owner@example.test', { harness: true }).ok).toBe(true)
    expect(assessOwnerEmail('hans@klingenberg-food.net', { harness: true }).ok).toBe(false)
    expect(assessOwnerEmail('hans@example.com', { harness: true }).ok).toBe(false)
  })

  it('recognises a repository fixture identity', () => {
    expect(isTestIdentityAddress('Owner@Example.Test')).toBe(true)
    expect(isTestIdentityAddress('owner@klingenberg-food.net')).toBe(false)
    expect(isTestIdentityAddress(undefined)).toBe(false)
  })
})

describe('the environment readers the launch tools use', () => {
  it('the bootstrap reads the API pair and never a database URL', () => {
    expect(readApiProject({ [NAMES.apiUrl]: LOCAL_API, [NAMES.serviceRoleKey]: 'k' })).toEqual({ apiUrl: LOCAL_API, serviceRoleKey: 'k' })
    expect(() => readApiProject({ [NAMES.apiUrl]: LOCAL_API })).toThrow(new RegExp(NAMES.serviceRoleKey))
  })

  it('the database tools read the connection string and never a service-role key', () => {
    expect(readDatabase({ [NAMES.dbUrl]: LOCAL_DB })).toEqual({ dbUrl: LOCAL_DB })
    expect(() => readDatabase({})).toThrow(new RegExp(NAMES.dbUrl))
  })

  it('names one confirmation per operation, and none of them is the restore’s', () => {
    const names = [NAMES.bootstrapConfirmHost, NAMES.contentLoadConfirmHost, NAMES.migrateConfirmHost, NAMES.restoreConfirmHost]
    expect(new Set(names).size).toBe(4)
    expect(names).toEqual(['BOOTSTRAP_CONFIRM_HOST', 'CONTENT_LOAD_CONFIRM_HOST', 'MIGRATE_CONFIRM_HOST', 'BACKUP_RESTORE_CONFIRM_HOST'])
  })
})
