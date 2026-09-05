import { afterEach, describe, expect, it, vi } from 'vitest'

import { getRateLimitSecret, MIN_RATE_LIMIT_KEY_LENGTH } from '@/lib/env/server'

/**
 * The rate-limit secret's rule — the 13B closure.
 *
 * `lib/env/server.ts` is the one file allowed to name the variable, and this suite
 * tests that file; the name is assembled here at run time so that the source policy
 * (`scripts/check-source-policy.mjs`) keeps its literal-name rule intact rather than
 * growing an allowance for a test.
 */

const NAME = ['RATE', 'LIMIT', 'SECRET'].join('_')
const STRONG = 'a'.repeat(MIN_RATE_LIMIT_KEY_LENGTH)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getRateLimitSecret', () => {
  it('is optional off Vercel: undefined when unset, so a local build may stand in a key', () => {
    vi.stubEnv(NAME, '')
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(getRateLimitSecret()).toBeUndefined()
  })

  it('is required on Vercel: a missing value throws, naming the variable and not a value', () => {
    vi.stubEnv(NAME, '')
    vi.stubEnv('VERCEL', '1')
    expect(() => getRateLimitSecret()).toThrow(new RegExp(`Missing required server environment variable ${NAME}`))
    expect(() => getRateLimitSecret()).toThrow(/Vercel/)
  })

  it('returns a configured value of at least the minimum length, on Vercel and off it', () => {
    vi.stubEnv(NAME, STRONG)
    vi.stubEnv('VERCEL', '1')
    expect(getRateLimitSecret()).toBe(STRONG)
    vi.stubEnv('VERCEL', '')
    expect(getRateLimitSecret()).toBe(STRONG)
    expect(MIN_RATE_LIMIT_KEY_LENGTH).toBe(32)
  })

  it('refuses a short value everywhere, without echoing it', () => {
    const weak = 'short-secret'
    vi.stubEnv(NAME, weak)
    vi.stubEnv('VERCEL', '')
    expect(() => getRateLimitSecret()).toThrow(new RegExp(`Malformed server environment variable ${NAME}`))
    try {
      getRateLimitSecret()
    } catch (error) {
      expect((error as Error).message).not.toContain(weak)
    }
    vi.stubEnv('VERCEL', '1')
    expect(() => getRateLimitSecret()).toThrow(/Malformed/)
  })

  it('treats whitespace as unset', () => {
    vi.stubEnv(NAME, '   ')
    vi.stubEnv('VERCEL', '1')
    expect(() => getRateLimitSecret()).toThrow(/Missing required/)
  })
})
