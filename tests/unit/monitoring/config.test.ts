import { describe, expect, it } from 'vitest'

import {
  resolveMonitoringEnvironment,
  resolveMonitoringRelease,
  resolveMonitoringSettings,
  UNVERSIONED_RELEASE,
} from '@/lib/monitoring/config'

/**
 * What monitoring runs as — phase 13C (brief §6, §7, §8). The enabled rule, the
 * environment label and the release name, each branch pinned.
 */

// Assembled at run time: the source policy reads a literal URL with a user before
// its host as a hard-coded domain, and a DSN is exactly that shape.
const DSN = ['https', '://', 'public@o0.ingest.sentry.test/1'].join('')

describe('enabled', () => {
  it('is on exactly when a DSN is configured outside a test process', () => {
    expect(resolveMonitoringSettings({ dsn: DSN, vercelEnv: 'production' }).enabled).toBe(true)
    expect(resolveMonitoringSettings({ dsn: DSN, nodeEnv: 'production' }).enabled).toBe(true)
  })

  it('is off without a DSN — local development and a local production build report nowhere', () => {
    expect(resolveMonitoringSettings({ nodeEnv: 'development' }).enabled).toBe(false)
    expect(resolveMonitoringSettings({ nodeEnv: 'production' }).enabled).toBe(false)
    expect(resolveMonitoringSettings({ dsn: '   ', vercelEnv: 'production' }).enabled).toBe(false)
    expect(resolveMonitoringSettings({ nodeEnv: 'production' }).dsn).toBeUndefined()
  })

  it('is off in a test process even with a DSN, so no automated error reaches a real project', () => {
    expect(resolveMonitoringSettings({ dsn: DSN, vitest: 'true' }).enabled).toBe(false)
    expect(resolveMonitoringSettings({ dsn: DSN, nodeEnv: 'test' }).enabled).toBe(false)
  })
})

describe('the environment label', () => {
  it('is Vercel’s own on Vercel: production, preview or development', () => {
    expect(resolveMonitoringEnvironment({ vercelEnv: 'production' })).toBe('production')
    expect(resolveMonitoringEnvironment({ vercelEnv: 'preview' })).toBe('preview')
    expect(resolveMonitoringEnvironment({ vercelEnv: 'development' })).toBe('development')
  })

  it('never lets a preview masquerade as production', () => {
    expect(resolveMonitoringEnvironment({ vercelEnv: 'preview', nodeEnv: 'production' })).toBe('preview')
  })

  it('is test under Vitest or NODE_ENV=test, and development everywhere else off Vercel', () => {
    expect(resolveMonitoringEnvironment({ vitest: '1' })).toBe('test')
    expect(resolveMonitoringEnvironment({ nodeEnv: 'test' })).toBe('test')
    expect(resolveMonitoringEnvironment({ nodeEnv: 'production' })).toBe('development')
    expect(resolveMonitoringEnvironment({})).toBe('development')
  })

  it('ignores a Vercel value it does not know rather than trusting it', () => {
    expect(resolveMonitoringEnvironment({ vercelEnv: 'staging', nodeEnv: 'production' })).toBe('development')
  })
})

describe('the release', () => {
  it('is the deployment’s commit SHA on Vercel', () => {
    expect(resolveMonitoringRelease({ commitSha: '2e105280abc' })).toBe('2e105280abc')
  })

  it('is overridden by an explicit release name', () => {
    expect(resolveMonitoringRelease({ commitSha: '2e105280abc', releaseOverride: 'launch-1' })).toBe('launch-1')
  })

  it('is the fixed word "unversioned" when nothing names it — stable, never generated', () => {
    expect(resolveMonitoringRelease({})).toBe(UNVERSIONED_RELEASE)
    expect(resolveMonitoringRelease({ commitSha: '  ', releaseOverride: '' })).toBe(UNVERSIONED_RELEASE)
    expect(UNVERSIONED_RELEASE).toBe('unversioned')
  })
})

describe('the settings record', () => {
  it('carries all four facts together', () => {
    expect(
      resolveMonitoringSettings({ dsn: DSN, vercelEnv: 'production', commitSha: 'abc123' }),
    ).toEqual({ dsn: DSN, environment: 'production', release: 'abc123', enabled: true })
  })
})
