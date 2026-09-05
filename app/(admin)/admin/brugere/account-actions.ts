'use server'

import { redirect } from 'next/navigation'

import { changeAccountRole, setAccountActive } from '@/lib/accounts/admin'
import { createAuthAdmin } from '@/lib/accounts/auth-admin'
import {
  DEACTIVATE_OUTCOME_CODES,
  DEACTIVATED_SESSIONS_OPEN_CODE,
  isAccountRole,
  REACTIVATE_OUTCOME_CODES,
  REACTIVATED_LOGIN_LOCKED_CODE,
  ROLE_OUTCOME_CODES,
} from '@/lib/accounts/model'
import { LOGIN_PATH, requireOwner } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { readAccountTarget, USERS_FORM } from './forms'
import { usersHref } from './routes'

/**
 * The three account transitions — technical plan §5 ("Accounts", decision 11), §6,
 * §8; phase 11C.
 *
 * Each action is thin and in the same fixed order: `requireOwner()`; parse the
 * target (the account id and the version token — strict, nothing else); hand the
 * request to `lib/accounts/admin.ts`, which calls the trusted database transition
 * through the Owner's own JWT and, for the active state, the Auth-side ban or unban
 * through the one Auth Admin door; report by redirecting with one code from a
 * closed set.
 *
 * **The browser never names the actor.** The actor is the JWT's, read by the
 * transition through `auth.uid()`; the audit row is attributed from it. The browser
 * names *which* account and *which* approved change — a role from the closed
 * vocabulary, or the direction of the active state, which is the action itself.
 *
 * **The last active owner is refused by the database**, under a lock, whatever the
 * screen offered (`last_owner`). The screen's absent controls are an explanation.
 *
 * **Acting on yourself.** An owner may demote or deactivate themselves while
 * another active owner exists (the database allows exactly that). The consequence
 * is immediate and this action states it: a self-demotion lands on the dashboard,
 * whose next render already lacks the Owner tiles and whose Owner-only screens now
 * refuse; a self-deactivation ends this very session and lands on the login screen
 * saying why. Nothing keeps a deactivated person signed in for one more request.
 */

export async function changeRole(formData: FormData): Promise<void> {
  const profile = await requireOwner()
  await enforceRateLimit('accounts:mutation', usersHref({ status: RATE_LIMIT_STATUS }))

  const target = readAccountTarget(formData)
  const role = formData.get(USERS_FORM.role)

  if (target === null || !isAccountRole(role)) {
    redirect(usersHref({ status: 'ugyldig_aendring' }))
  }

  const supabase = await createSupabaseServerClient()
  const result = await changeAccountRole(supabase, {
    userId: target.userId,
    role,
    expectedUpdatedAt: target.expectedUpdatedAt,
  })

  if (result.status === 'updated' && target.userId === profile.userId && role === 'staff') {
    // The demotion is already in force for the next request — including this
    // screen, which `requireOwner()` would now refuse. Say so where the person lands.
    redirect('/admin?besked=rolle-skiftet')
  }

  redirect(
    usersHref({
      status: ROLE_OUTCOME_CODES[result.status],
      focus: { userId: target.userId, control: 'role' },
    }),
  )
}

export async function deactivateAccount(formData: FormData): Promise<void> {
  const profile = await requireOwner()
  await enforceRateLimit('accounts:mutation', usersHref({ status: RATE_LIMIT_STATUS }))

  const target = readAccountTarget(formData)
  if (target === null) {
    redirect(usersHref({ status: 'ugyldig_aendring' }))
  }

  const supabase = await createSupabaseServerClient()
  const result = await setAccountActive(supabase, createAuthAdmin(), {
    userId: target.userId,
    active: false,
    expectedUpdatedAt: target.expectedUpdatedAt,
  })

  const reached = result.status === 'updated' || result.status === 'unchanged'

  if (reached && target.userId === profile.userId) {
    // Self-deactivation: the database already refuses this person, and the Auth
    // server now refuses their tokens. End the cookie session too, so the next
    // request is the login screen and not a redirect there.
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      // The session is refused by the Auth server either way.
    }
    redirect(`${LOGIN_PATH}?fejl=deaktiveret`)
  }

  const status = reached
    ? result.authStep === 'done'
      ? DEACTIVATE_OUTCOME_CODES.updated
      : DEACTIVATED_SESSIONS_OPEN_CODE
    : DEACTIVATE_OUTCOME_CODES[result.status]

  redirect(
    usersHref({
      status,
      focus: { userId: target.userId, control: reached ? 'reactivate' : 'deactivate' },
    }),
  )
}

export async function reactivateAccount(formData: FormData): Promise<void> {
  await requireOwner()
  await enforceRateLimit('accounts:mutation', usersHref({ status: RATE_LIMIT_STATUS }))

  const target = readAccountTarget(formData)
  if (target === null) {
    redirect(usersHref({ status: 'ugyldig_aendring' }))
  }

  const supabase = await createSupabaseServerClient()
  const result = await setAccountActive(supabase, createAuthAdmin(), {
    userId: target.userId,
    active: true,
    expectedUpdatedAt: target.expectedUpdatedAt,
  })

  const reached = result.status === 'updated' || result.status === 'unchanged'

  const status = reached
    ? result.authStep === 'done'
      ? REACTIVATE_OUTCOME_CODES.updated
      : REACTIVATED_LOGIN_LOCKED_CODE
    : REACTIVATE_OUTCOME_CODES[result.status]

  redirect(
    usersHref({
      status,
      focus: { userId: target.userId, control: reached ? 'deactivate' : 'reactivate' },
    }),
  )
}
