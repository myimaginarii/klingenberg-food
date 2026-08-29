import 'server-only'

import { cache } from 'react'

import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Session and profile resolution — technical plan §5.
 *
 * This is the data-access layer the guards in `./guards.ts` are built on. It is the
 * only place the application asks "who is this request from?".
 *
 * WHY `getUser()` AND NOT `getSession()`
 *
 * `getSession()` decodes the session cookie without verifying it, so its result is
 * only as trustworthy as the cookie — which arrives from the client. `getUser()`
 * validates the token with the Auth server, so a forged, expired or revoked token is
 * rejected. Authorization must never be decided from unverified input, so nothing in
 * this file or in `guards.ts` calls `getSession()`.
 *
 * Both functions are wrapped in React's `cache()`, which memoises per render pass.
 * A page that calls `requireStaff()` in its own body and again in a Server Action gets
 * one round trip, not several, and every caller sees a consistent answer.
 */

export type Role = 'owner' | 'staff'

export type Profile = {
  userId: string
  email: string | null
  name: string
  role: Role
  /** Non-null when the account has been deactivated by an owner (§5). */
  disabledAt: string | null
}

/** The verified auth user for this request, or null when there is no valid session. */
export const getSessionUser = cache(async () => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user
})

/**
 * The application profile for the current session.
 *
 * Returns null when there is no session, and — importantly — also when the signed-in
 * auth user has no `profiles` row. An auth user without a profile is not staff: they
 * hold no role, `is_staff()` returns false for them in the database, and they must be
 * treated the same way here.
 *
 * A deactivated account *is* returned, with `disabledAt` set, so the guards can tell
 * the person why they are being turned away instead of showing a bare login form they
 * will never get past.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getSessionUser()
  if (!user) return null

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, name, role, disabled_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return null

  return {
    userId: data.user_id as string,
    email: user.email ?? null,
    name: data.name as string,
    role: data.role as Role,
    disabledAt: (data.disabled_at as string | null) ?? null,
  }
})

/** True when the profile may use the admin at all. */
export function isActiveStaff(profile: Profile | null): profile is Profile {
  return profile !== null && profile.disabledAt === null
}

/** True when the profile holds the owner role and is active. */
export function isActiveOwner(profile: Profile | null): profile is Profile {
  return isActiveStaff(profile) && profile.role === 'owner'
}
