import { describe, expect, it } from 'vitest'

import { isFrameworkControlFlow } from '@/lib/monitoring/classify'
import { createStormBoundary, DEFAULT_STORM_WINDOW_MS } from '@/lib/monitoring/storm'

/**
 * The classifier and the storm boundary — phase 13C (brief §2, §16, §22).
 */

function withDigest(digest: string): Error {
  const error = new Error(digest)
  ;(error as Error & { digest: string }).digest = digest
  return error
}

describe('isFrameworkControlFlow', () => {
  it('recognises a redirect, a 404 and the rendering bail-outs by their digest', () => {
    expect(isFrameworkControlFlow(withDigest('NEXT_REDIRECT;replace;/admin?status=gemt;307;'))).toBe(true)
    expect(isFrameworkControlFlow(withDigest('NEXT_NOT_FOUND'))).toBe(true)
    expect(isFrameworkControlFlow(withDigest('NEXT_HTTP_ERROR_FALLBACK;404'))).toBe(true)
    expect(isFrameworkControlFlow(withDigest('DYNAMIC_SERVER_USAGE'))).toBe(true)
    expect(isFrameworkControlFlow(withDigest('BAILOUT_TO_CLIENT_SIDE_RENDERING'))).toBe(true)
    expect(isFrameworkControlFlow(withDigest('NEXT_PRERENDER_INTERRUPTED'))).toBe(true)
  })

  it('recognises a React postpone', () => {
    expect(isFrameworkControlFlow({ $$typeof: Symbol.for('react.postpone'), message: 'x' })).toBe(true)
  })

  it('treats every other thrown value as a failure', () => {
    expect(isFrameworkControlFlow(new Error('Could not read the accounts'))).toBe(false)
    expect(isFrameworkControlFlow(withDigest('1234567890'))).toBe(false)
    expect(isFrameworkControlFlow(withDigest('NEXT_REDIRECTED_ELSEWHERE'))).toBe(false)
    expect(isFrameworkControlFlow('a string')).toBe(false)
    expect(isFrameworkControlFlow(null)).toBe(false)
    expect(isFrameworkControlFlow(undefined)).toBe(false)
  })
})

describe('the storm boundary', () => {
  it('lets one event per key through per window', () => {
    const storm = createStormBoundary(1_000)
    expect(storm.allow('a', 0)).toBe(true)
    expect(storm.allow('a', 500)).toBe(false)
    expect(storm.allow('a', 999)).toBe(false)
    expect(storm.allow('a', 1_000)).toBe(true)
  })

  it('keeps keys apart', () => {
    const storm = createStormBoundary(1_000)
    expect(storm.allow('rate-limiter:unavailable|content:save', 0)).toBe(true)
    expect(storm.allow('rate-limiter:unavailable|content:publish', 0)).toBe(true)
    expect(storm.allow('rate-limiter:unavailable|content:save', 1)).toBe(false)
  })

  it('defaults to one minute and forgets on reset', () => {
    expect(DEFAULT_STORM_WINDOW_MS).toBe(60_000)
    const storm = createStormBoundary()
    expect(storm.allow('a', 0)).toBe(true)
    expect(storm.allow('a', 59_999)).toBe(false)
    storm.reset()
    expect(storm.allow('a', 1)).toBe(true)
  })

  it('stays bounded under many distinct keys', () => {
    const storm = createStormBoundary(1_000)
    for (let i = 0; i < 1_000; i += 1) expect(storm.allow(`k${i}`, i)).toBe(true)
    // The oldest were evicted; a fresh key still works and a recent one is still held.
    expect(storm.allow('fresh', 1_000)).toBe(true)
    expect(storm.allow('k999', 1_001)).toBe(false)
  })
})
