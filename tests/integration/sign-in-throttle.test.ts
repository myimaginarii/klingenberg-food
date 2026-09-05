import { createClient, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { releaseSignInAttempt, reserveSignInAttempt } from '@/lib/rate-limit/limiter'
import { RATE_LIMIT_SCOPES } from '@/lib/rate-limit/scopes'
import { signInUnderThrottle, type SignInThrottleSubjects } from '@/lib/rate-limit/sign-in'
import { deriveClientSubject, normalizeAccountAddress } from '@/lib/rate-limit/subject'

import { clearLocalRateLimits, fillLocalRateLimit, listLocalRateLimitBuckets } from '../support/local-auth-admin'

/**
 * The sign-in throttle against the real local Auth server — the 13B closure.
 *
 * pgTAP `030` owns the SQL: the all-or-nothing reservation under the row locks,
 * the release, and the two-session race. The unit suite owns the settle rule over
 * fake doors. What only this suite reaches is the whole thing as the Server Action
 * runs it — `signInUnderThrottle()` over the anonymous server client, the real
 * `reserve_sign_in_attempt()` / `release_sign_in_attempt()` through PostgREST, and
 * a REAL `signInWithPassword()` against the local Auth server — with the Auth
 * requests counted where they leave the process: a fetch wrapper on the Auth
 * client counts every request to `/auth/v1/token`. That count is the proof: with N
 * simultaneous wrong passwords and k allowances left, exactly k requests reach the
 * Auth server and N - k are refused by the application, whatever the timing.
 *
 * The same scenario under phase 13B's peek/consume shape, measured before the
 * closure: one allowance left, eight simultaneous attempts, eight Auth requests,
 * a bucket at seventeen (§0ai).
 *
 * Prerequisites, as for the account suite: `npm run db:start` and the seeded local
 * identities (`npm run db:users`).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const STAFF = { email: 'staff@example.test', password: 'LocalStaff12345' }
const WRONG = 'ForkertAdgangskode1'

// The subjects exactly as the server derives them — a test secret, since the
// derivation is pure and the database sees only the 64-hex result.
const SECRET = 'integration-sign-in-secret'
const subjects: SignInThrottleSubjects = {
  client: deriveClientSubject(SECRET, 'address', '203.0.113.9'),
  account: deriveClientSubject(SECRET, 'account', normalizeAccountAddress(STAFF.email)),
}

const LIMIT = RATE_LIMIT_SCOPES['auth:signin'].maxHits

let authRequests = 0

/** An Auth client whose every token request is counted as it leaves the process. */
function countingAuthClient(): SupabaseClient {
  const countingFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/auth/v1/token')) authRequests += 1
    return fetch(input, init)
  }
  return createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: countingFetch },
  })
}

/** An Auth client that cannot reach the Auth server at all. */
function unreachableAuthClient(): SupabaseClient {
  const failingFetch: typeof fetch = async () => {
    throw new TypeError('fetch failed')
  }
  return createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: failingFetch },
  })
}

function plainAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function hits(scope: 'auth:signin' | 'auth:signin-account', subject: string): Promise<number | null> {
  const bucket = (await listLocalRateLimitBuckets()).find((b) => b.scope === scope && b.subject === subject)
  return bucket?.hits ?? null
}

function attemptWith(auth: SupabaseClient, password: string) {
  return () => auth.auth.signInWithPassword({ email: STAFF.email, password })
}

beforeAll(async () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('The sign-in throttle integration tests need the local Supabase stack (.env.local).')
  }
  await clearLocalRateLimits()
})

afterAll(async () => {
  await clearLocalRateLimits()
})

describe('concurrent wrong passwords at the threshold', () => {
  const N = 8
  const left = 2

  it(`with ${left} allowances left, exactly ${left} of ${N} simultaneous attempts reach the Auth server; the rest are refused by the application`, async () => {
    await fillLocalRateLimit('auth:signin', subjects.client, LIMIT - left)
    authRequests = 0
    const auth = countingAuthClient()

    const outcomes = await Promise.all(
      Array.from({ length: N }, () => signInUnderThrottle(subjects, attemptWith(auth, WRONG))),
    )

    const answered = outcomes.filter((o) => o.status === 'answered')
    const throttled = outcomes.filter((o) => o.status === 'throttled')
    expect(answered).toHaveLength(left)
    expect(throttled).toHaveLength(N - left)
    for (const outcome of answered) {
      if (outcome.status === 'answered') expect(outcome.answer.error?.code).toBe('invalid_credentials')
    }

    // The proof: the Auth server saw exactly the allowed number, not one more.
    expect(authRequests).toBe(left)

    // And the counters hold exactly the tier — the refusals added nothing.
    expect(await hits('auth:signin', subjects.client)).toBe(LIMIT)
    expect(await hits('auth:signin-account', subjects.account)).toBe(left)
  })

  it('at the threshold, the RIGHT password is refused too, before the Auth server is asked', async () => {
    authRequests = 0
    const outcome = await signInUnderThrottle(subjects, attemptWith(countingAuthClient(), STAFF.password))
    expect(outcome).toEqual({ status: 'throttled' })
    expect(authRequests).toBe(0)
    expect(await hits('auth:signin', subjects.client)).toBe(LIMIT)
  })
})

describe('after the window (here: the counters emptied)', () => {
  it('the right password signs in, and the successful attempt leaves no failure behind', async () => {
    await clearLocalRateLimits()
    authRequests = 0

    const outcome = await signInUnderThrottle(subjects, attemptWith(countingAuthClient(), STAFF.password))
    expect(outcome.status).toBe('answered')
    if (outcome.status === 'answered') expect(outcome.answer.error).toBeNull()
    expect(authRequests).toBe(1)

    // Reserved, then released: the buckets exist for this window and hold nothing.
    expect(await hits('auth:signin', subjects.client)).toBe(0)
    expect(await hits('auth:signin-account', subjects.account)).toBe(0)
  })

  it('a wrong password keeps its reservation: one failure counted in each bucket', async () => {
    const outcome = await signInUnderThrottle(subjects, attemptWith(countingAuthClient(), WRONG))
    expect(outcome.status).toBe('answered')
    expect(await hits('auth:signin', subjects.client)).toBe(1)
    expect(await hits('auth:signin-account', subjects.account)).toBe(1)
  })

  it('an Auth server that cannot be reached gives the reservation back: an outage burns nothing', async () => {
    const outcome = await signInUnderThrottle(subjects, attemptWith(unreachableAuthClient(), STAFF.password))
    expect(outcome.status).toBe('answered')
    if (outcome.status === 'answered') {
      expect(outcome.answer.error).not.toBeNull()
      expect(isAuthRetryableFetchError(outcome.answer.error)).toBe(true)
    }
    expect(await hits('auth:signin', subjects.client)).toBe(1)
    expect(await hits('auth:signin-account', subjects.account)).toBe(1)
  })

  it('an attempt that throws gives the reservation back and rethrows', async () => {
    await expect(
      signInUnderThrottle(subjects, async () => {
        throw new Error('unexpected application error')
      }),
    ).rejects.toThrow('unexpected application error')
    expect(await hits('auth:signin', subjects.client)).toBe(1)
    expect(await hits('auth:signin-account', subjects.account)).toBe(1)
  })

  it('the successful sign-in did not consume a failure allowance: the full tier is still available', async () => {
    // One failure stands. The remaining allowance is LIMIT - 1, and the reservation
    // for each further attempt says so.
    const decision = await reserveSignInAttempt(plainAnonClient(), subjects.client, subjects.account)
    expect(decision).toEqual({ status: 'allowed', remaining: LIMIT - 2 })
    await releaseSignInAttempt(plainAnonClient(), subjects.client, subjects.account)
    expect(await hits('auth:signin', subjects.client)).toBe(1)
  })
})

describe('the doors through PostgREST, as a stranger with the anon key would call them', () => {
  it('refuse a subject that is not the derived key, and give nothing back for a key nobody holds', async () => {
    const anon = plainAnonClient()
    expect(await reserveSignInAttempt(anon, 'staff@example.test', subjects.account)).toEqual({ status: 'unavailable' })
    expect(await releaseSignInAttempt(anon, subjects.client, 'not-a-key')).toBe(false)

    const before = await hits('auth:signin', subjects.client)
    const stranger = deriveClientSubject('a-secret-nobody-holds', 'address', '203.0.113.9')
    const strangerAccount = deriveClientSubject('a-secret-nobody-holds', 'account', STAFF.email)
    expect(await releaseSignInAttempt(anon, stranger, strangerAccount)).toBe(true)
    expect(await hits('auth:signin', subjects.client)).toBe(before)
    expect(await hits('auth:signin', stranger)).toBeNull()
  })

  it('refuse a caller with a session', async () => {
    const signedIn = plainAnonClient()
    const { error } = await signedIn.auth.signInWithPassword(STAFF)
    if (error) throw new Error(`Could not sign in the seeded staff member: ${error.message}`)

    expect(await reserveSignInAttempt(signedIn, subjects.client, subjects.account)).toEqual({ status: 'unavailable' })
    expect(await releaseSignInAttempt(signedIn, subjects.client, subjects.account)).toBe(false)
    await signedIn.auth.signOut({ scope: 'local' })
  })

  it('store nothing that names the address or the account', async () => {
    for (const bucket of await listLocalRateLimitBuckets()) {
      expect(bucket.subject).not.toContain('203.0.113.9')
      expect(bucket.subject).not.toContain('@')
      expect(bucket.subject).not.toContain('staff')
    }
  })
})
