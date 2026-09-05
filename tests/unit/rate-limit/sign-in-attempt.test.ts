import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import {
  releasesReservation,
  runThrottledSignIn,
  type SignInReservation,
} from '@/lib/rate-limit/sign-in-attempt'

/**
 * The sign-in attempt under the throttle — the 13B closure.
 *
 * The rule, proved over fake doors: reserve first; a refusal never reaches the
 * attempt; the reservation stays for every verdict the Auth server gives and is
 * released for a success, for an Auth server that gave none, and for an attempt
 * that threw; and no path releases twice or releases what was never reserved. The
 * same orchestration runs unchanged against the real database and Auth server in
 * `tests/integration/sign-in-throttle.test.ts`.
 */

type Answer = { error: AuthApiError | AuthRetryableFetchError | null }

function doors(reservation: SignInReservation, answer: () => Promise<Answer>) {
  const calls = { reserve: 0, release: 0, attempt: 0 }
  const order: string[] = []
  return {
    calls,
    order,
    doors: {
      reserve: async () => {
        calls.reserve += 1
        order.push('reserve')
        return reservation
      },
      release: async () => {
        calls.release += 1
        order.push('release')
      },
      attempt: async () => {
        calls.attempt += 1
        order.push('attempt')
        return answer()
      },
    },
  }
}

const accepted = async (): Promise<Answer> => ({ error: null })
const wrongPassword = async (): Promise<Answer> => ({
  error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
})
const banned = async (): Promise<Answer> => ({ error: new AuthApiError('User is banned', 400, 'user_banned') })
const authThrottled = async (): Promise<Answer> => ({
  error: new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'),
})
const outage = async (): Promise<Answer> => ({ error: new AuthRetryableFetchError('fetch failed', 0) })
const gateway = async (): Promise<Answer> => ({ error: new AuthRetryableFetchError('Bad gateway', 502) })

describe('runThrottledSignIn', () => {
  it('reserves before it attempts, and a refused reservation never reaches the Auth server', async () => {
    const d = doors('refused', wrongPassword)
    const outcome = await runThrottledSignIn(d.doors)
    expect(outcome).toEqual({ status: 'throttled' })
    expect(d.calls).toEqual({ reserve: 1, release: 0, attempt: 0 })
  })

  it('keeps the reservation for a wrong password', async () => {
    const d = doors('reserved', wrongPassword)
    const outcome = await runThrottledSignIn(d.doors)
    expect(outcome.status).toBe('answered')
    expect(d.calls).toEqual({ reserve: 1, release: 0, attempt: 1 })
    expect(d.order).toEqual(['reserve', 'attempt'])
  })

  it('keeps the reservation for a banned account — counted like any refusal', async () => {
    const d = doors('reserved', banned)
    const outcome = await runThrottledSignIn(d.doors)
    expect(outcome.status).toBe('answered')
    if (outcome.status === 'answered') expect(outcome.answer.error?.code).toBe('user_banned')
    expect(d.calls.release).toBe(0)
  })

  it("keeps the reservation when the Auth server's own limit answers: two throttles agreeing", async () => {
    const d = doors('reserved', authThrottled)
    await runThrottledSignIn(d.doors)
    expect(d.calls.release).toBe(0)
  })

  it('releases the reservation exactly once after a success, after the attempt', async () => {
    const d = doors('reserved', accepted)
    const outcome = await runThrottledSignIn(d.doors)
    expect(outcome).toEqual({ status: 'answered', answer: { error: null } })
    expect(d.calls).toEqual({ reserve: 1, release: 1, attempt: 1 })
    expect(d.order).toEqual(['reserve', 'attempt', 'release'])
  })

  it('releases the reservation when the Auth server could not be reached, or answered 5xx', async () => {
    for (const noVerdict of [outage, gateway]) {
      const d = doors('reserved', noVerdict)
      const outcome = await runThrottledSignIn(d.doors)
      expect(outcome.status).toBe('answered')
      expect(d.calls).toEqual({ reserve: 1, release: 1, attempt: 1 })
    }
  })

  it('releases the reservation and rethrows when the attempt itself throws', async () => {
    const boom = new Error('unexpected')
    const d = doors('reserved', async () => {
      throw boom
    })
    await expect(runThrottledSignIn(d.doors)).rejects.toBe(boom)
    expect(d.calls).toEqual({ reserve: 1, release: 1, attempt: 1 })
  })

  it('never releases what was not reserved: an unavailable limiter lets the attempt through and gives nothing back', async () => {
    for (const answer of [accepted, wrongPassword, outage]) {
      const d = doors('unreserved', answer)
      const outcome = await runThrottledSignIn(d.doors)
      expect(outcome.status).toBe('answered')
      expect(d.calls).toEqual({ reserve: 1, release: 0, attempt: 1 })
    }

    const thrown = doors('unreserved', async () => {
      throw new Error('unexpected')
    })
    await expect(runThrottledSignIn(thrown.doors)).rejects.toThrow('unexpected')
    expect(thrown.calls.release).toBe(0)
  })
})

describe('releasesReservation', () => {
  it('is true for a success and for the retryable fetch errors only', async () => {
    expect(releasesReservation(await accepted())).toBe(true)
    expect(releasesReservation(await outage())).toBe(true)
    expect(releasesReservation(await gateway())).toBe(true)
    expect(releasesReservation(await wrongPassword())).toBe(false)
    expect(releasesReservation(await banned())).toBe(false)
    expect(releasesReservation(await authThrottled())).toBe(false)
    expect(releasesReservation({ error: { code: 'unknown' } })).toBe(false)
  })
})
