'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { getCurrentProfile } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/config/site'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { resetRequestIsThrottled, signInThrottleSubjects, signInUnderThrottle } from '@/lib/rate-limit/sign-in'

/**
 * Authentication Server Actions — technical plan §1 (adjustment 2), §5.
 *
 * Every one of these runs only on the server. The browser never holds a Supabase
 * client or a token: it posts a form, and the session arrives as httpOnly, secure,
 * SameSite=Lax cookies written by `@supabase/ssr`.
 *
 * There is no sign-up action, and there never will be one. Public signup is disabled at
 * the Supabase project level (`supabase/config.toml`), and accounts are created by an
 * owner through the invite flow in a later phase (§5, decision 11).
 *
 * Errors are returned by redirecting back to the form with a code in the query string,
 * so the whole flow works without any client-side JavaScript. The code is one of a
 * closed set the page knows how to translate — never a message from the auth server,
 * which would let an attacker probe for valid addresses through the UI.
 */

/** Login failures are reported with one deliberately unspecific code. */
const GENERIC_LOGIN_ERROR = 'forkert'

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = safeNextPath(formData.get('videre'))

  if (!email || !password) {
    redirect(`/admin/login?fejl=mangler${nextParam(next)}`)
  }

  // The sign-in throttle (phase 13B, `lib/rate-limit/sign-in.ts`): one attempt is
  // reserved in both counters, atomically, before the Auth server is asked. The
  // reservation stays for every refusal the Auth server gives — a wrong password,
  // an unknown address and a banned account alike, so the counters move identically
  // for an address that exists and one that does not — and is released after a
  // success, or an Auth server that gave no verdict. A throttled attempt never
  // reaches the Auth server, so it can reveal nothing about the address.
  const throttle = await signInThrottleSubjects(email)
  const supabase = await createSupabaseServerClient()
  const outcome = await signInUnderThrottle(throttle, () =>
    supabase.auth.signInWithPassword({ email, password }),
  )

  if (outcome.status === 'throttled') {
    redirect(`/admin/login?fejl=${RATE_LIMIT_STATUS}${nextParam(next)}`)
  }

  const { error } = outcome.answer

  if (error) {
    // A deactivated account is banned at the Auth server (phase 11C), and the Auth
    // server says so before it checks the password. The person is told the truth —
    // they held an account here, and the Owner can reactivate it — which is what the
    // phase-1 profile check below tells a deactivated person whose sign-in the Auth
    // server still accepts. It reveals nothing a stranger could use: the address is
    // one the restaurant itself handed out.
    if (error.code === 'user_banned') {
      redirect('/admin/login?fejl=deaktiveret')
    }

    // One message for "no such account" and for "wrong password" alike, so the form
    // cannot be used to discover which addresses exist (§8 — credential stuffing).
    redirect(`/admin/login?fejl=${GENERIC_LOGIN_ERROR}${nextParam(next)}`)
  }

  // Authentication is not authorization. A person can hold a valid Supabase session
  // and still have no business in the admin: no profile row, or a deactivated one.
  // Both are ended here rather than left to fail confusingly on the next page.
  const profile = await getCurrentProfile()

  if (profile === null) {
    await supabase.auth.signOut()
    redirect(`/admin/login?fejl=${GENERIC_LOGIN_ERROR}`)
  }

  if (profile.disabledAt !== null) {
    await supabase.auth.signOut()
    redirect('/admin/login?fejl=deaktiveret')
  }

  redirect(next ?? '/admin')
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/admin/login?besked=logget-ud')
}

/**
 * Request a password-reset email.
 *
 * Always reports success, whether or not the address belongs to an account. Telling a
 * visitor "no such user" would turn this form into an account-enumeration oracle.
 *
 * Locally the message is captured by the Supabase CLI mail catcher on port 54324 and
 * never leaves the machine (§10c). The link points at `/admin/bekraeft`, a route
 * handler that exchanges the token for a session server-side.
 */
export async function requestPasswordReset(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim()

  if (email) {
    // Counted per client address on every request (phase 13B): the form's answer is
    // the same whether or not an e-mail goes out, so a refusal is the one thing it
    // has to say differently — and it says it without mentioning the address.
    if (await resetRequestIsThrottled()) {
      redirect(`/admin/glemt-adgangskode?fejl=${RATE_LIMIT_STATUS}`)
    }

    const supabase = await createSupabaseServerClient()
    // The result is deliberately not inspected: the response to the visitor is the
    // same either way.
    await supabase.auth.resetPasswordForEmail(email, {
      // Absolute, and resolved through lib/config/site.ts — the only module in the
      // repository allowed to produce a site origin (§10d).
      redirectTo: absoluteUrl('/admin/bekraeft'),
    })
  }

  redirect('/admin/glemt-adgangskode?besked=sendt')
}

/**
 * Set a new password.
 *
 * Reached only from the recovery link, which has already established a session through
 * `/admin/bekraeft`. `requireStaff()` is called first regardless — the recovery session
 * is a session like any other, and this action must not become a way for a person with
 * a stale cookie and no profile to change a password.
 */
export async function setNewPassword(formData: FormData): Promise<void> {
  await requireStaff()

  const password = String(formData.get('password') ?? '')
  const repeated = String(formData.get('gentag') ?? '')

  if (password !== repeated) {
    redirect('/admin/ny-adgangskode?fejl=uens')
  }

  // Mirrors `minimum_password_length` in supabase/config.toml. The database is still
  // the authority; this only produces a better message than a raw API error.
  if (password.length < 12) {
    redirect('/admin/ny-adgangskode?fejl=kort')
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    redirect('/admin/ny-adgangskode?fejl=afvist')
  }

  redirect('/admin?besked=adgangskode-skiftet')
}

/**
 * Only a site-relative path may be used as a post-login destination. Anything absolute,
 * protocol-relative, or outside /admin is discarded — otherwise `?videre=` would be an
 * open redirect (§8).
 */
function safeNextPath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path.startsWith('/admin')) return null
  if (path.startsWith('//')) return null
  if (path.includes('\\')) return null
  return path
}

function nextParam(next: string | null): string {
  return next ? `&videre=${encodeURIComponent(next)}` : ''
}
