import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { cache } from 'react'

import { reportOperationalEvent } from '@/lib/monitoring/report'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import type { AuthAdmin, AuthIdentity } from './auth-admin'
import {
  accountStatusOf,
  isAccountRole,
  parseTransitionResult,
  type Account,
  type AccountRole,
  type AuthStepStatus,
  type InviteStatus,
  type InviteSubmission,
  type TransitionStatus,
} from './model'

/**
 * The user administration's reads and writes — technical plan §5 ("Accounts",
 * decision 11), §6, §8; phase 11C.
 *
 * A wrapper, not a mechanism, in the family of `lib/images/admin.ts`. Every read
 * and every profile write goes through the **caller's own JWT** — the request-scoped
 * client — so RLS re-decides the §5 row underneath `requireOwner()`, and the three
 * database transitions (`create_account_profile()`, `set_account_role()`,
 * `set_account_active()`, migration 20260903120000) carry the version check, the
 * last-owner check under the invariant lock and the audit row. Nothing here writes
 * `profiles` directly, and nothing here could: the guard on the table refuses a
 * direct movement of `role` or `disabled_at` from any browser role.
 *
 * The Auth side — creating the identity, sending the invitation, banning and
 * unbanning — is the injected `AuthAdmin` capability (`./auth-admin.ts`), the one
 * service-role door. Which system is authoritative for which fact is stated there
 * and in the migration; this module orders the two so that a failure between them
 * is honest rather than silent:
 *
 *   INVITATION — Auth first, then the profile. The profile references the Auth
 *   identity by foreign key, so it cannot go first. If the Auth server accepts the
 *   invitation and the profile write then fails, an identity exists with no
 *   profile: it holds no role, `is_staff()` is false for it, `requireStaff()` turns
 *   it away, and the sign-in action ends its session — it can do nothing. The
 *   screen says so (`profile_failed`), and the repair is the same form again with
 *   the same address: an unconfirmed identity is re-sent the invitation and given
 *   its profile (`invited`); a confirmed one is found by address and given its
 *   profile without a new e-mail (`attached`). Nothing is ever created twice —
 *   `create_account_profile()` answers `exists` for an identity that has one.
 *
 *   DEACTIVATION — the database first, then the ban. The database refusal is the
 *   one every admin request and every policy consults, and it is in force the
 *   moment the transition commits, whatever token the browser holds; the same
 *   transaction removes the person's Auth sessions, so no refresh token of theirs
 *   survives it (measured — a ban alone would only hold them). The ban is the
 *   second lock: it makes the Auth server refuse the already-issued access token
 *   for the rest of its lifetime and refuse a new sign-in (see `./auth-admin.ts`).
 *   If the ban fails, the person still has no access to anything — every request
 *   is refused by the database — and the screen says exactly that
 *   (`DEACTIVATED_SESSIONS_OPEN_CODE`); deactivating again repeats the ban without
 *   touching the row (`unchanged` + the Auth step).
 *
 *   REACTIVATION — the database first, then the unban, for the safe direction: an
 *   account that is active in the database but still banned cannot log in, which
 *   is the failure that keeps somebody out rather than lets somebody in. The screen
 *   says so (`REACTIVATED_LOGIN_LOCKED_CODE`); reactivating again repeats the unban.
 */

type AccountRow = {
  user_id: string
  name: string
  email: string
  role: string
  disabled_at: string | null
  invited_at: string | null
  email_confirmed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Every account, as the Owner administers them, through the caller's JWT.
 * `list_accounts()` raises for anybody but an active owner, so this throws for a
 * caller the page has not already refused.
 */
export const readAccountDirectory = cache(async (): Promise<Account[]> => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('list_accounts')

  if (error !== null) {
    throw new Error(`Could not read the accounts: ${error.message}`)
  }

  const rows = (Array.isArray(data) ? data : []) as AccountRow[]

  return rows.flatMap((row) =>
    isAccountRole(row.role)
      ? [
          {
            userId: row.user_id,
            name: row.name,
            email: row.email.toLowerCase(),
            role: row.role,
            disabledAt: row.disabled_at,
            invitedAt: row.invited_at,
            emailConfirmedAt: row.email_confirmed_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        ]
      : [],
  )
})

export type InviteResult = { readonly status: InviteStatus }

type ProfileCreation = 'created' | 'exists' | 'no_auth_user' | 'invalid' | 'forbidden' | 'failed'

async function createProfile(
  supabase: SupabaseClient,
  identity: AuthIdentity,
  submission: InviteSubmission,
): Promise<ProfileCreation> {
  const { data, error } = await supabase.rpc('create_account_profile', {
    p_user_id: identity.userId,
    p_name: submission.name,
    p_role: submission.role,
  })

  if (error !== null) {
    if (error.code === '42501') return 'forbidden'
    console.error(`Creating an account profile failed: ${error.code ?? 'unknown'}`)
    // The identity exists at the Auth server (an invitation was accepted or an
    // existing address was found) and has no profile — the partial state the
    // module note above describes, repaired by inviting the address again.
    reportOperationalEvent('accounts:profile-failed', {
      detail: error.message,
      tags: { code: error.code ?? 'unknown' },
      context: { account_id: identity.userId },
    })
    return 'failed'
  }

  const status = (data as { status?: unknown } | null)?.status
  if (status === 'created' || status === 'exists' || status === 'invalid') return status

  if (status === 'no_auth_user') {
    // The Auth server answered `invited` a moment ago and the database cannot see
    // the identity: not a person's mistake, and not repairable from the screen.
    reportOperationalEvent('accounts:profile-failed', {
      tags: { code: 'no_auth_user' },
      context: { account_id: identity.userId },
    })
    return 'no_auth_user'
  }

  reportOperationalEvent('accounts:profile-failed', {
    tags: { code: 'unreadable_reply' },
    context: { account_id: identity.userId },
  })
  return 'failed'
}

/**
 * Invite an account: the Auth identity and its invitation e-mail, then the profile.
 *
 * `directory` is the list the screen was rendered from, re-read by the action: an
 * address that already has an account is answered from it — `exists`, or, for an
 * account that was invited and has not yet accepted, a fresh invitation e-mail
 * (`reinvited`, the existing name and role kept) — before the Auth server is asked
 * for anything.
 */
export async function inviteAccount(
  supabase: SupabaseClient,
  auth: AuthAdmin,
  submission: InviteSubmission,
  directory: readonly Account[],
): Promise<InviteResult> {
  const existing = directory.find((account) => account.email === submission.email)

  if (existing !== undefined) {
    if (accountStatusOf(existing) !== 'invited') return { status: 'exists' }

    // Invited, not yet accepted: the Auth server re-sends to an unconfirmed identity.
    const resend = await auth.inviteByEmail(existing.email, existing.name)
    if (resend.status === 'invited') return { status: 'reinvited' }
    if (resend.status === 'invalid_email') return { status: 'invalid_email' }
    // `email_exists` here means the person accepted between the read and the
    // re-send — the account is simply an account now.
    return { status: resend.status === 'email_exists' ? 'exists' : 'auth_failed' }
  }

  const invite = await auth.inviteByEmail(submission.email, submission.name)

  if (invite.status === 'invalid_email') return { status: 'invalid_email' }
  if (invite.status === 'failed') return { status: 'auth_failed' }

  // Either the Auth server created (or re-used an unconfirmed) identity and
  // accepted the e-mail, or a confirmed identity already holds the address with no
  // profile behind it — the repair path: find it, give it its profile, send nothing.
  let identity: AuthIdentity
  let delivered: boolean

  if (invite.status === 'invited') {
    identity = invite.identity
    delivered = true
  } else {
    const found = await auth.findByEmail(submission.email)
    if (found === null) return { status: 'auth_failed' }
    identity = found
    delivered = false
  }

  switch (await createProfile(supabase, identity, submission)) {
    case 'created':
      return { status: delivered ? 'invited' : 'attached' }
    case 'exists':
      // A concurrent invitation of the same address won; the directory read was
      // stale by a moment. The account exists, which is what the person wanted.
      return { status: delivered ? 'reinvited' : 'exists' }
    case 'no_auth_user':
      return { status: 'auth_failed' }
    case 'forbidden':
      return { status: 'forbidden' }
    default:
      return { status: 'profile_failed' }
  }
}

export type TransitionResult = {
  readonly status: TransitionStatus
  readonly updatedAt: string | null
}

function transitionFailure(
  transition: 'set_account_role' | 'set_account_active',
  error: { code?: string; message: string },
): TransitionResult {
  if (error.code === '42501') return { status: 'forbidden', updatedAt: null }
  console.error(`An account transition failed: ${error.code ?? 'unknown'}`)
  reportOperationalEvent('accounts:transition-failed', {
    detail: error.message,
    tags: { code: error.code ?? 'unknown', transition },
  })
  return { status: 'failed', updatedAt: null }
}

/** Staff <-> Owner, through `set_account_role()` with the caller's JWT. */
export async function changeAccountRole(
  supabase: SupabaseClient,
  request: { readonly userId: string; readonly role: AccountRole; readonly expectedUpdatedAt: string },
): Promise<TransitionResult> {
  const { data, error } = await supabase.rpc('set_account_role', {
    p_user_id: request.userId,
    p_role: request.role,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error !== null) return transitionFailure('set_account_role', error)

  return parseTransitionResult(data)
}

export type ActiveStateResult = TransitionResult & {
  /** The Auth-side ban or unban — taken when the row reached the requested state. */
  readonly authStep: AuthStepStatus
}

/**
 * Deactivate or reactivate, through `set_account_active()` with the caller's JWT,
 * then the Auth-side ban or unban. `unchanged` — the row already in the requested
 * state — still performs the Auth step, so a deactivation whose ban failed is
 * repaired by deactivating again.
 */
export async function setAccountActive(
  supabase: SupabaseClient,
  auth: AuthAdmin,
  request: { readonly userId: string; readonly active: boolean; readonly expectedUpdatedAt: string },
): Promise<ActiveStateResult> {
  const { data, error } = await supabase.rpc('set_account_active', {
    p_user_id: request.userId,
    p_active: request.active,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error !== null) return { ...transitionFailure('set_account_active', error), authStep: 'skipped' }

  const result = parseTransitionResult(data)

  if (result.status !== 'updated' && result.status !== 'unchanged') {
    return { ...result, authStep: 'skipped' }
  }

  const authStep = await auth.setBanned(request.userId, !request.active)

  return { ...result, authStep }
}
