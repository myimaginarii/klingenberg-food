import { describe, expect, it } from 'vitest'

import {
  RETENTION,
  REQUIRED_COMPONENTS,
  buildManifest,
  chooseLatest,
  compareMigrationHistories,
  isComplete,
  isPastRetention,
  latestPointer,
  objectKeyPrefix,
  recoveryPointDate,
  recoveryPointId,
  retentionCutoff,
  validateManifest,
} from '../../../scripts/backup/lib/manifest.mjs'

/**
 * The recovery-point manifest — technical plan §10f; phase 13A (brief §11, §12, §26).
 *
 * What the manifest promises: an id that sorts chronologically and survives an
 * object key and a Windows path; `complete` derived from the required components
 * and never accepted from a caller; a validator that refuses a document claiming
 * completeness it did not earn; the retention contract stated once; and the
 * migration-compatibility rule of brief §17.
 */

const file = { bytes: 10, sha256: 'a'.repeat(64) }

function manifestWith(components, overrides = {}) {
  return buildManifest({
    id: '2026-09-07T03-00-00Z',
    createdAt: '2026-09-07T03:00:00.000Z',
    tier: 'weekly',
    source: { apiHost: 'example.test', dbHost: 'db.example.test', projectRef: null },
    repository: { commit: 'abc', migrations: ['20260829120000'] },
    schema: { appliedMigrations: ['20260829120000'] },
    components,
    files: { 'db/data-public.sql': file },
    ...overrides,
  })
}

describe('recovery-point ids', () => {
  it('name the UTC instant with path-safe characters and round-trip', () => {
    const id = recoveryPointId(new Date('2026-09-07T03:04:05.678Z'))
    expect(id).toBe('2026-09-07T03-04-05Z')
    expect(id).not.toMatch(/[:\\/]/)
    expect(recoveryPointDate(id).toISOString()).toBe('2026-09-07T03:04:05.000Z')
  })

  it('sort chronologically as plain strings', () => {
    const a = recoveryPointId(new Date('2026-09-07T03:00:00Z'))
    const b = recoveryPointId(new Date('2026-10-01T02:59:59Z'))
    expect([b, a].sort()).toEqual([a, b])
  })

  it('refuse an invalid date', () => {
    expect(() => recoveryPointId(new Date('nonsense'))).toThrow()
  })
})

describe('completeness', () => {
  it('is derived from the required components, never passed in', () => {
    const complete = manifestWith({ database: { status: 'ok' }, storage: { status: 'ok' } })
    expect(complete.complete).toBe(true)
    expect(isComplete(complete)).toBe(true)

    const partial = manifestWith({ database: { status: 'ok' }, storage: { status: 'failed', error: 'x' } })
    expect(partial.complete).toBe(false)
    expect(isComplete(partial)).toBe(false)

    expect(REQUIRED_COMPONENTS).toEqual(['database', 'storage'])
  })

  it('a document claiming completeness it did not earn is not a valid manifest', () => {
    const forged = { ...manifestWith({ database: { status: 'ok' }, storage: { status: 'failed' } }), complete: true }
    expect(validateManifest(forged)).toContain('complete is true but a required component did not succeed')
    expect(isComplete(forged)).toBe(false)
  })

  it('validation names every structural problem', () => {
    expect(validateManifest(null)).toEqual(['the manifest is not an object'])
    const problems = validateManifest({ format: 'other', id: 'x', createdAt: 'never', tier: 'daily', complete: 'yes' })
    expect(problems).toEqual(
      expect.arrayContaining([
        'unknown format "other"',
        'invalid id "x"',
        'createdAt is not a timestamp',
        'unknown tier "daily"',
        'complete is not a boolean',
        'components is missing',
        'files is missing',
        'schema is missing',
      ]),
    )
    const badFile = manifestWith({ database: { status: 'ok' }, storage: { status: 'ok' } }, { files: { 'db/x.sql': { bytes: 1, sha256: 'short' } } })
    expect(validateManifest(badFile)).toEqual(['file db/x.sql has no byte count or sha256'])
  })

  it('the latest pointer exists only for a complete recovery point', () => {
    const complete = manifestWith({ database: { status: 'ok' }, storage: { status: 'ok' } })
    expect(latestPointer(complete, 's3://bucket.test/p/weekly/2026-09-07T03-00-00Z/')).toMatchObject({
      id: '2026-09-07T03-00-00Z',
      tier: 'weekly',
      location: 's3://bucket.test/p/weekly/2026-09-07T03-00-00Z/',
    })
    const partial = manifestWith({ database: { status: 'ok' }, storage: { status: 'failed' } })
    expect(() => latestPointer(partial, 'x')).toThrow(/complete/)
  })

  it('chooseLatest picks the newest complete point and ignores partial ones', () => {
    const older = manifestWith({ database: { status: 'ok' }, storage: { status: 'ok' } }, { id: '2026-08-31T03-00-00Z' })
    const newest = manifestWith({ database: { status: 'ok' }, storage: { status: 'ok' } }, { id: '2026-09-07T03-00-00Z' })
    const newerButPartial = manifestWith({ database: { status: 'ok' }, storage: { status: 'failed' } }, { id: '2026-09-14T03-00-00Z' })
    expect(chooseLatest([older, newerButPartial, newest])?.id).toBe('2026-09-07T03-00-00Z')
    expect(chooseLatest([newerButPartial])).toBeNull()
  })
})

describe('retention', () => {
  it('states §10f once: eight weekly points and six monthly ones, with margin', () => {
    expect(RETENTION.weekly.keepDays).toBe(63)
    expect(RETENTION.monthly.keepDays).toBe(190)
    expect(RETENTION.weekly.keepDays).toBeGreaterThan(8 * 7)
    expect(RETENTION.monthly.keepDays).toBeGreaterThan(6 * 31)
  })

  it('never expires the newest recovery point, whatever the tier', () => {
    const now = new Date('2026-11-02T03:00:00Z')
    const newest = recoveryPointId(now)
    expect(isPastRetention(newest, 'weekly', now)).toBe(false)
    expect(isPastRetention(newest, 'monthly', now)).toBe(false)
  })

  it('expires a weekly point only after the eighth successor could exist', () => {
    const now = new Date('2026-11-02T03:00:00Z')
    expect(isPastRetention('2026-09-07T03-00-00Z', 'weekly', now)).toBe(false) // 8 weeks ago: kept
    expect(isPastRetention('2026-08-24T03-00-00Z', 'weekly', now)).toBe(true) // 10 weeks ago: expired
    expect(isPastRetention('2026-08-24T03-00-00Z', 'monthly', now)).toBe(false)
    expect(retentionCutoff('weekly', now).toISOString()).toBe('2026-08-31T03:00:00.000Z')
  })

  it('refuses an unknown tier', () => {
    expect(() => retentionCutoff('daily', new Date())).toThrow(/Unknown tier/)
  })
})

describe('destination keys', () => {
  it('put the tier under the prefix so one lifecycle rule per tier is enough', () => {
    expect(objectKeyPrefix('klingenberg-food', 'weekly', '2026-09-07T03-00-00Z')).toBe('klingenberg-food/weekly/2026-09-07T03-00-00Z')
    expect(objectKeyPrefix('/a/b/', 'monthly', '2026-09-07T03-00-00Z')).toBe('a/b/monthly/2026-09-07T03-00-00Z')
  })

  it('refuse a prefix that is not plain path segments', () => {
    expect(() => objectKeyPrefix('a/../b', 'weekly', '2026-09-07T03-00-00Z')).toThrow()
    expect(() => objectKeyPrefix('a b', 'weekly', '2026-09-07T03-00-00Z')).toThrow()
    expect(() => objectKeyPrefix('a', 'weekly', 'latest')).toThrow()
  })
})

describe('migration compatibility (brief §17)', () => {
  const backup = ['20260829120000', '20260829140000']
  it('equal histories proceed', () => {
    expect(compareMigrationHistories(backup, backup)).toBe('equal')
  })
  it('a newer target is named, so the restore can demand --allow-newer-schema', () => {
    expect(compareMigrationHistories([...backup, '20260903120000'], backup)).toBe('target-newer')
  })
  it('an older target must apply migrations first', () => {
    expect(compareMigrationHistories(['20260829120000'], backup)).toBe('target-older')
  })
  it('a different lineage is refused outright', () => {
    expect(compareMigrationHistories(['20260829120000', '20260901000000'], backup)).toBe('divergent')
  })
})
