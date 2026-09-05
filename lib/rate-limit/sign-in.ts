import 'server-only'

import { randomBytes } from 'node:crypto'

import { headers } from 'next/headers'

import { isLocalSiteUrl, isVercelDeployment } from '@/lib/config/site'
import { getRateLimitSecret } from '@/lib/env/server'
import { createSupabasePublicClient } from '@/lib/supabase/server'

import { consumeRateLimit, refusedByRateLimit, releaseSignInAttempt, reserveSignInAttempt } from './limiter'
import {
  runThrottledSignIn,
  type AuthAnswer,
  type SignInReservation,
  type ThrottledSignInOutcome,
} from './sign-in-attempt'
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
 * TWO COUNTERS, FAILURES ONLY — RESERVED FIRST
 *
 *   * per client address (`auth:signin`) — the tight one;
 *   * per account address (`auth:signin-account`) — the loose backstop.
 *
 * An attempt is RESERVED in both before the Auth server is contacted — one atomic
 * decision under the row locks (`reserve_sign_in_attempt()`), so that once the
 * tier's last allowance is taken every simultaneous attempt after it is refused
 * before any Auth request is made. The reservation then STAYS when the Auth server
 * refuses (a failure) and is RELEASED when it accepts, so a successful sign-in
 * still never counts: a person who logs in from a shared restaurant connection
 * several times a day inherits nothing (brief §22). The full rule, outage included,
 * is `sign-in-attempt.ts`.
 *
 * Phase 13B's first shape — peek, then Auth, then consume on failure — left the
 * whole Auth round-trip between the read and the write; eight simultaneous wrong
 * passwords with one allowance left all reached the Auth server (§0ai, the
 * closure). The reservation closes that gap.
 *
 * ENUMERATION (brief §21)
 *
 * The refusal is one sentence, the same for an address that exists and one that
 * does not, and both counters move identically for both. A throttled request is
 * reported before the Auth server is asked, so it reveals nothing the generic
 * "Forkert e-mail eller adgangskode." did not already conceal. The
 * deactivated-account wording of phase 11C is untouched: it is shown only after an
 * Auth-server answer, and a throttled request never gets one.
 */

export type SignInThrottleSubjects = {
  readonly client: string
  readonly account: string
}

/** The stand-in key of a host that is neither local nor Vercel — never logged, never returned. */
let processKey: string | null = null

function subjectSecret(): string {
  // On Vercel this throws when the secret is missing (`lib/env/server.ts`): a
  // deployment where client-derived subjects exist does not get a made-up key.
  const configured = getRateLimitSecret()
  if (configured !== undefined) return configured

  if (isLocalSiteUrl()) {
    // Local development, the test runs, and a local production build: a fixed key,
    // so the derivation is deterministic on one machine and the throttle is
    // exercised for real.
    return 'local-development-rate-limit-key'
  }

  // An origin that is neither local nor Vercel: no address header is believed here
  // (every client is `local`), so the only per-instance effect is the account key.
  // Said once, in the server log — without the name, which the source policy keeps
  // in `lib/env/server.ts`.
  if (processKey === null) {
    processKey = randomBytes(32).toString('hex')
    console.warn('The rate-limit secret is not configured; the sign-in throttle is keyed per instance until it is.')
  }
  return processKey
}

/** On Vercel the platform's proxy writes the address headers itself; nowhere else are they believed. */
function trustAddressHeaders(): boolean {
  return isVercelDeployment()
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

/**
 * One attempt reserved in both buckets, or refused with nothing moved. When the
 * limiter cannot answer, the tier's fail-open rule lets the attempt go on without
 * a reservation (`scopes.ts`).
 */
export async function reserveSignIn(subjects: SignInThrottleSubjects): Promise<SignInReservation> {
  const decision = await reserveSignInAttempt(createSupabasePublicClient(), subjects.client, subjects.account)
  if (decision.status === 'allowed') return 'reserved'
  return refusedByRateLimit(decision, 'auth:signin') ? 'refused' : 'unreserved'
}

/** The reservation given back — after a success, or an Auth server that gave no verdict. */
export async function releaseSignIn(subjects: SignInThrottleSubjects): Promise<void> {
  await releaseSignInAttempt(createSupabasePublicClient(), subjects.client, subjects.account)
}

/**
 * The sign-in attempt as the Server Action runs it: reserve, ask the Auth server,
 * settle. `attempt` is the one Auth request; the caller reads the answer exactly as
 * it would have without the throttle.
 */
export async function signInUnderThrottle<T extends AuthAnswer>(
  subjects: SignInThrottleSubjects,
  attempt: () => Promise<T>,
): Promise<ThrottledSignInOutcome<T>> {
  return runThrottledSignIn({
    reserve: () => reserveSignIn(subjects),
    release: () => releaseSignIn(subjects),
    attempt,
  })
}

/**
 * The password-reset request: counted on every request (there is no failure to
 * distinguish — the form always reports success), against the client address.
 * Consumed BEFORE the e-mail is requested, atomically, so it has no gap to close.
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
