import 'server-only'

import { redirect } from 'next/navigation'

import { getCurrentProfile, isActiveOwner, isActiveStaff, type Profile } from './session'

/**
 * Authorization guards — technical plan §5, §8.
 *
 * **These are the real gate.** `proxy.ts` redirects unauthenticated visitors away from
 * `/admin`, but that is routing convenience and nothing more: it authorizes nobody.
 * Every protected admin page and every mutation calls one of these functions itself,
 * so a request that reaches a page directly — a bookmarked URL, a Server Action POST,
 * a matcher that stopped covering a route — is still refused.
 *
 * This is also why the Next.js middleware authorization-bypass advisory class cannot
 * break this system (§5, §8). Nothing is authorized in proxy, so nothing is lost when
 * proxy is bypassed. The installed Next.js docs make the same point about Proxy in
 * their own words: authentication and authorization must be verified inside each
 * Server Function rather than relying on Proxy alone.
 *
 * These functions do not return a boolean that a caller might forget to check. They
 * either return the authorized profile or they `redirect()`, which throws — so control
 * never reaches the mutation below them. A guard that is called is a guard that is
 * enforced.
 *
 * RLS is the second, independent layer: the request-scoped client carries the user's
 * own JWT, so the database re-checks the same rule through `public.is_staff()` and
 * `public.is_owner()`. Neither layer is trusted to be the only one.
 */

/** Where an unauthorized request is sent, and why. Used by the pages to explain. */
export const LOGIN_PATH = '/admin/login'
export const FORBIDDEN_PATH = '/admin/ingen-adgang'

/**
 * Require an active staff or owner session.
 *
 * Redirects to the login page when there is no session, when the signed-in auth user
 * has no profile, or when the account has been deactivated. A deactivated user is sent
 * away with a reason rather than silently failing every query.
 */
export async function requireStaff(): Promise<Profile> {
  const profile = await getCurrentProfile()

  if (profile !== null && profile.disabledAt !== null) {
    redirect(`${LOGIN_PATH}?fejl=deaktiveret`)
  }

  if (!isActiveStaff(profile)) {
    redirect(`${LOGIN_PATH}?fejl=log-ind`)
  }

  return profile
}

/**
 * Require an active owner session.
 *
 * A signed-in staff member is not sent to the login page — they are already signed in,
 * and offering them the login form would be misleading. They are sent to an explicit
 * "no access" page instead. Anyone without a usable session goes to login as usual.
 */
export async function requireOwner(): Promise<Profile> {
  const profile = await requireStaff()

  if (!isActiveOwner(profile)) {
    redirect(FORBIDDEN_PATH)
  }

  return profile
}
