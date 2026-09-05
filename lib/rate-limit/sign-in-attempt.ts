/**
 * The sign-in attempt under the throttle — the order, and what each outcome
 * leaves behind. Technical plan §8, §0ai (the 13B closure).
 *
 * Pure orchestration over three doors the caller supplies, so that the rule can be
 * proved without a database or an Auth server (`tests/unit/rate-limit/`), and then
 * run unchanged against both (`tests/integration/sign-in-throttle.test.ts`, and the
 * Server Action itself).
 *
 *   1. RESERVE — one attempt, in both sign-in buckets, atomically. `refused` means
 *      the Auth server is never contacted: the attempt ends here. `unreserved`
 *      means the limiter could not answer and the tier is fail-open: the attempt
 *      goes on, and — holding no reservation — has nothing to give back.
 *   2. ATTEMPT — the one Auth request.
 *   3. SETTLE — the reservation stays or is released, by this rule:
 *
 *        the Auth server refused the credentials      → stays   (a failure)
 *        the Auth server said the account is banned   → stays   (counted like any refusal, brief §21)
 *        any other answer the Auth server gave        → stays   (an answer is an answer)
 *        the Auth server accepted                     → released (a success never counts)
 *        the Auth server could not be reached / 5xx   → released (no verdict was given)
 *        the attempt threw                            → released, and the error is rethrown
 *
 *      "Could not be reached" is `@supabase/auth-js`'s own classification — the
 *      error it names `AuthRetryableFetchError` (a network failure or a 5xx),
 *      recognised here by that name so that this module imports nothing from the
 *      package (`tests/unit/policy/public-javascript.test.ts` keeps Supabase
 *      value imports to the three client-owning modules) — the smallest rule
 *      that keeps an outage from burning a person's allowance, without guessing
 *      at status codes of our own. An Auth-side rate-limit answer (429)
 *      is an answer, and stays: two throttles agreeing is not a bug.
 *
 * One reservation, at most one release: the release is called exactly once, from
 * exactly one of the branches above, and the database lowers a bucket by one and
 * stops at zero. There is no path that releases twice, and no path that releases
 * what was never reserved.
 */

export type SignInReservation = 'reserved' | 'refused' | 'unreserved'

export type AuthAnswer = { readonly error: { readonly name?: string; readonly code?: string } | null }

export type ThrottledSignInDoors<T extends AuthAnswer> = {
  readonly reserve: () => Promise<SignInReservation>
  readonly release: () => Promise<void>
  readonly attempt: () => Promise<T>
}

export type ThrottledSignInOutcome<T extends AuthAnswer> =
  | { readonly status: 'throttled' }
  | { readonly status: 'answered'; readonly answer: T }

/** The name `@supabase/auth-js` gives the error it raises when the Auth server gave no verdict. */
export const AUTH_RETRYABLE_ERROR_NAME = 'AuthRetryableFetchError'

/** Whether an Auth answer is one the reservation should be given back for. */
export function releasesReservation(answer: AuthAnswer): boolean {
  if (answer.error === null) return true
  return answer.error.name === AUTH_RETRYABLE_ERROR_NAME
}

export async function runThrottledSignIn<T extends AuthAnswer>(
  doors: ThrottledSignInDoors<T>,
): Promise<ThrottledSignInOutcome<T>> {
  const reservation = await doors.reserve()
  if (reservation === 'refused') return { status: 'throttled' }

  let answer: T
  try {
    answer = await doors.attempt()
  } catch (caught) {
    if (reservation === 'reserved') await doors.release()
    throw caught
  }

  if (reservation === 'reserved' && releasesReservation(answer)) {
    await doors.release()
  }

  return { status: 'answered', answer }
}
