import 'server-only'

import { randomBytes } from 'node:crypto'

import { headers } from 'next/headers'

import { isLocalSiteUrl } from '@/lib/config/site'
import { getRateLimitSecret } from '@/lib/env/server'
import { createSupabasePublicClient } from '@/lib/supabase/server'

import { consumeRateLimit, peekRateLimit, refusedByRateLimit } from './limiter'
import type { ClientRateLimitScope } from './scopes'
import { deriveClientSubject, normalizeAccountAddress, trustedClientAddress } from './subject'

/**
 * The sign-in and reset throttle — technical plan §8 ("Credential stuffing:
 * Supabase Auth rate limits plus a login-attempt throttle keyed on email"), §0ai.
 *
 * WHAT IT PROTECTS, SAID HONESTLY
 *
 * `/admin/login` posts to a Server Action, which calls the Auth server with the anon
 * key from the server. This throttle sits in that action. It does **not** protect
 * the Auth server's own `/auth/v1/token` endpoint, which anybody who holds the
 * (public by design) anon key can call directly; that path is the Auth server's own
 * per-IP limit, recorded as a deployment prerequisite. What this throttle adds is
 * the site's login form as a stuffing tool: without it, the form is an unlimited
 * proxy to the Auth server from a single origin.
 *
 * TWO COUNTERS, FAILURES ONLY
 *
 *   * per client address (`auth:signin`) — the tight one;
 *   * per account address (`auth:signin-account`) — the loose backstop.
 *
 * Both are asked BEFORE the Auth server is contacted (`peek`) and moved only when a
 * sign-in FAILS (`consume`): a successful sign-in never counts, so a person who logs
 * in from a shared restaurant connection several times a day inherits nothing
 * (brief §22). The two-step shape has one known edge: two failures arriving in the
 * same instant near the threshold may both pass the peek. Both are still counted,
 * so the next attempt is refused; a throttle is not made weaker by one extra
 * attempt at its boundary, and the alternative — counting successes — would be.
 *
 * ENUMERATION (brief §21)
 *
 * The refusal is one sentence, the same for an address that exists and one that
 * does not, and the per-account counter moves identically for both. A throttled
 * request is reported before the Auth server is asked, so it reveals nothing the
 * generic "Forkert e-mail eller adgangskode." did not already conceal. The
 * deactivated-account wording of phase 11C is untouched: it is shown only after an
 * Auth-server answer, and a throttled request never gets one.
 */

export type SignInThrottleSubjects = {
  readonly client: string
  readonly account: string
}

/** The secret, or a stand-in — never logged, never returned to a caller. */
let processKey: string | null = null

function subjectSecret(): string {
  const configured = getRateLimitSecret()
  if (configured !== undefined) return configured

  if (isLocalSiteUrl()) {
    // Local development and the test runs: a fixed key, so the derivation is
    // deterministic on one machine and the throttle is exercised for real.
    return 'local-development-rate-limit-key'
  }

  // A hosted deployment without the secret: keep the throttle working with a key
  // this process made up. Buckets are then per instance rather than shared, which
  // is weaker than intended and is why the secret is a deployment prerequisite
  // (technical plan §10e). Said once, in the server log — without the name, which
  // the source policy keeps in `lib/env/server.ts`.
  if (processKey === null) {
    processKey = randomBytes(32).toString('hex')
    console.warn('The rate-limit secret is not configured; the sign-in throttle is keyed per instance until it is.')
  }
  return processKey
}

/** On Vercel the platform's proxy writes the address headers itself; nowhere else are they believed. */
function trustAddressHeaders(): boolean {
  return process.env.VERCEL === '1'
}

/** The two subjects for this request — derived, never stored in the clear. */
export async function signInThrottleSubjects(email: string): Promise<SignInThrottleSubjects> {
  const secret = subjectSecret()
  const address = trustedClientAddress(await headers(), trustAddressHeaders())

  return {
    client: deriveClientSubject(secret, 'address', address),
    account: deriveClientSubject(secret, 'account', normalizeAccountAddress(email)),
  }
}

/** True when this sign-in attempt must be refused before the Auth server is asked. */
export async function signInIsThrottled(subjects: SignInThrottleSubjects): Promise<boolean> {
  const supabase = createSupabasePublicClient()

  const [client, account] = await Promise.all([
    peekRateLimit(supabase, 'auth:signin', subjects.client),
    peekRateLimit(supabase, 'auth:signin-account', subjects.account),
  ])

  return (
    refusedByRateLimit(client, 'auth:signin') || refusedByRateLimit(account, 'auth:signin-account')
  )
}

/** A sign-in the Auth server refused: count it against both subjects. */
export async function noteSignInFailure(subjects: SignInThrottleSubjects): Promise<void> {
  const supabase = createSupabasePublicClient()

  await Promise.all([
    consumeRateLimit(supabase, 'auth:signin', subjects.client),
    consumeRateLimit(supabase, 'auth:signin-account', subjects.account),
  ])
}

/**
 * The password-reset request: counted on every request (there is no failure to
 * distinguish — the form always reports success), against the client address.
 */
export async function resetRequestIsThrottled(): Promise<boolean> {
  const scope: ClientRateLimitScope = 'auth:reset'
  const subject = deriveClientSubject(
    subjectSecret(),
    'address',
    trustedClientAddress(await headers(), trustAddressHeaders()),
  )

  const decision = await consumeRateLimit(createSupabasePublicClient(), scope, subject)
  return refusedByRateLimit(decision, scope)
}
