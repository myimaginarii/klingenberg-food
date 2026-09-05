import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { consumeRateLimit, peekRateLimit, refusedByRateLimit } from '@/lib/rate-limit/limiter'
import { RATE_LIMIT_SCOPES } from '@/lib/rate-limit/scopes'
import { CLIENT_SUBJECT_PATTERN, deriveClientSubject, normalizeAccountAddress } from '@/lib/rate-limit/subject'

import { clearLocalRateLimits, fillLocalRateLimit, listLocalRateLimitBuckets } from '../support/local-auth-admin'

/**
 * The limiter door against the real local stack — phase 13B (brief §43).
 *
 * pgTAP `029` owns the SQL: privileges, the closed vocabulary, the atomic
 * increment through two real sessions, the window and the pruning. The unit suites
 * own the pure pieces. What only this suite reaches is the application's door as
 * the Server Actions use it — `lib/rate-limit/limiter.ts` over a real Owner REST
 * session and a real anonymous client, through PostgREST — and the test door the
 * browser stories rely on (`fillLocalRateLimit`, `clearLocalRateLimits`).
 *
 * Prerequisites, as for the account suite: `npm run db:start` and the seeded local
 * identities (`npm run db:users`).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let ownerRest: SupabaseClient
let staffRest: SupabaseClient
let ownerId: string
let staffId: string
let anon: SupabaseClient

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function signedIn(email: string, password: string): Promise<[SupabaseClient, string]> {
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) throw new Error(`Could not sign in ${email}: ${error?.message}`)
  return [client, data.user.id]
}

beforeAll(async () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('The rate-limit integration tests need the local Supabase stack (.env.local).')
  }
  await clearLocalRateLimits()
  ;[ownerRest, ownerId] = await signedIn('owner@example.test', 'LocalOwner12345')
  ;[staffRest, staffId] = await signedIn('staff@example.test', 'LocalStaff12345')
  anon = anonClient()
})

afterAll(async () => {
  await clearLocalRateLimits()
  await ownerRest?.auth.signOut({ scope: 'local' })
  await staffRest?.auth.signOut({ scope: 'local' })
})

describe('an actor scope through a real session', () => {
  it('is counted against the session and answers the remaining allowance', async () => {
    const first = await consumeRateLimit(ownerRest, 'content:publish')
    expect(first).toEqual({ status: 'allowed', remaining: RATE_LIMIT_SCOPES['content:publish'].maxHits - 1 })

    const peeked = await peekRateLimit(ownerRest, 'content:publish')
    expect(peeked).toEqual(first)

    const buckets = await listLocalRateLimitBuckets()
    const mine = buckets.filter((b) => b.scope === 'content:publish')
    expect(mine).toHaveLength(1)
    expect(mine[0]?.subject).toBe(ownerId)
    expect(mine[0]?.hits).toBe(1)
  })

  it('keeps two people apart: the staff counter does not move with the owner', async () => {
    const staff = await consumeRateLimit(staffRest, 'content:publish')
    expect(staff).toEqual({ status: 'allowed', remaining: RATE_LIMIT_SCOPES['content:publish'].maxHits - 1 })

    const subjects = (await listLocalRateLimitBuckets())
      .filter((b) => b.scope === 'content:publish')
      .map((b) => b.subject)
      .sort()
    expect(subjects).toEqual([ownerId, staffId].sort())
  })

  it('refuses the hit after the limit, and the refusal maps to a stop for every tier', async () => {
    // The tightest tier, filled to the threshold through the test door, then one
    // real hit: this is exactly the state the browser story puts an account in.
    await fillLocalRateLimit('accounts:invite', ownerId, RATE_LIMIT_SCOPES['accounts:invite'].maxHits)

    const refused = await consumeRateLimit(ownerRest, 'accounts:invite')
    expect(refused.status).toBe('limited')
    if (refused.status === 'limited') {
      expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1)
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMIT_SCOPES['accounts:invite'].windowSeconds)
    }
    expect(refusedByRateLimit(refused, 'accounts:invite')).toBe(true)
  })

  it('cannot be reached without a session', async () => {
    const decision = await consumeRateLimit(anon, 'content:save')
    // The database refuses; the door reports it as unavailable, and the scope's
    // policy — fail-open for content — would let the action continue. That is the
    // documented choice, and it is harmless here: an anonymous caller never
    // reaches a content action, because the guard runs first.
    expect(decision).toEqual({ status: 'unavailable' })
  })
})

describe('a client scope through the anonymous client', () => {
  const secret = 'integration-secret'
  const client = deriveClientSubject(secret, 'address', '203.0.113.7')
  const account = deriveClientSubject(secret, 'account', normalizeAccountAddress('Nobody@Example.TEST'))

  it('accepts only the derived 64-hex subject', async () => {
    expect(client).toMatch(CLIENT_SUBJECT_PATTERN)
    expect(await consumeRateLimit(anon, 'auth:signin', 'plain-address')).toEqual({ status: 'unavailable' })
    expect(await consumeRateLimit(anon, 'auth:signin', client)).toEqual({
      status: 'allowed',
      remaining: RATE_LIMIT_SCOPES['auth:signin'].maxHits - 1,
    })
  })

  it('refuses a caller with a session', async () => {
    expect(await consumeRateLimit(ownerRest, 'auth:signin', client)).toEqual({ status: 'unavailable' })
  })

  it('reaches the threshold exactly at the tier, peek agreeing without counting', async () => {
    const limit = RATE_LIMIT_SCOPES['auth:signin-account'].maxHits
    for (let i = 1; i <= limit; i += 1) {
      const decision = await consumeRateLimit(anon, 'auth:signin-account', account)
      expect(decision).toEqual({ status: 'allowed', remaining: limit - i })
    }
    expect((await peekRateLimit(anon, 'auth:signin-account', account)).status).toBe('limited')
    expect((await consumeRateLimit(anon, 'auth:signin-account', account)).status).toBe('limited')
  })

  it('stores nothing that names the address or the account', async () => {
    const buckets = await listLocalRateLimitBuckets()
    for (const bucket of buckets) {
      expect(bucket.subject).not.toContain('203.0.113.7')
      expect(bucket.subject).not.toContain('@')
      expect(bucket.subject).not.toContain('nobody')
    }
    expect(buckets.some((b) => b.scope === 'auth:signin' && b.subject === client)).toBe(true)
  })
})

describe('the test door', () => {
  it('empties every bucket, and only the buckets', async () => {
    expect((await listLocalRateLimitBuckets()).length).toBeGreaterThan(0)
    await clearLocalRateLimits()
    expect(await listLocalRateLimitBuckets()).toEqual([])

    // The tiers are untouched: the next hit still knows its allowance.
    expect(await consumeRateLimit(ownerRest, 'operation:immediate')).toEqual({
      status: 'allowed',
      remaining: RATE_LIMIT_SCOPES['operation:immediate'].maxHits - 1,
    })
  })
})
