'use server'

import { redirect } from 'next/navigation'

import { inviteAccount, readAccountDirectory } from '@/lib/accounts/admin'
import { createAuthAdmin } from '@/lib/accounts/auth-admin'
import { INVITE_OUTCOME_CODES, toInviteSubmission, type InviteIssue } from '@/lib/accounts/model'
import { requireOwner } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { encodeInviteEcho, readInviteForm } from './forms'
import { usersHref } from './routes'

/**
 * Invitér — technical plan §5 ("Accounts", decision 11), §8, §10c; phase 11C.
 *
 * Thin, and in a fixed order:
 *
 *   1. establish who is asking        — requireOwner()
 *   2. parse what was typed           — lib/accounts/model.ts (strict; Danish per field)
 *   3. read the server's own list     — lib/accounts/admin.ts (through the Owner's JWT)
 *   4. invite                         — lib/accounts/admin.ts: the Auth identity and
 *                                       its e-mail through the one Auth Admin door,
 *                                       then the profile through create_account_profile()
 *   5. report                         — a redirect back to the card, one code from a
 *                                       closed set, the typed values echoed on a refusal
 *
 * **`requireOwner()`, first.** §5's matrix puts "User accounts" in the Owner column
 * and only there, and this is the action a forged POST would aim at. It is the
 * first of three independent refusals: `create_account_profile()` re-checks
 * `is_owner()` explicitly, and RLS re-checks it a third time on the INSERT.
 *
 * The browser proposes a name, an address and a role. It does not name an actor, a
 * password, a token or an identity id — the Auth server returns the id for the
 * address it accepted, and the actor is the JWT's.
 */
export async function inviteUser(formData: FormData): Promise<void> {
  await requireOwner()
  await enforceRateLimit('accounts:invite', usersHref({ status: RATE_LIMIT_STATUS, focus: 'invite' }))

  const form = readInviteForm(formData)
  const submission = toInviteSubmission(form)

  if (!submission.ok) {
    redirect(usersHref({ status: 'ugyldig', focus: 'invite' }, encodeInviteEcho(form, submission.issues)))
  }

  const [supabase, directory] = await Promise.all([createSupabaseServerClient(), readAccountDirectory()])

  const result = await inviteAccount(supabase, createAuthAdmin(), submission.values, directory)
  const status = INVITE_OUTCOME_CODES[result.status]

  // A refusal that is about the address is bound to the address field, with what
  // was typed kept on screen; every other outcome comes back to the card alone.
  const boundToEmail: Partial<Record<typeof result.status, string>> = {
    exists: 'E-mailadressen har allerede en konto. Er den deaktiveret, kan du genaktivere den i listen.',
    invalid_email: 'Login-systemet afviste e-mailadressen. Tjek stavningen.',
  }
  const bound = boundToEmail[result.status]

  if (bound !== undefined) {
    const issues: InviteIssue[] = [{ field: 'email', message: bound }]
    redirect(usersHref({ status, focus: 'invite' }, encodeInviteEcho(form, issues)))
  }

  if (result.status === 'auth_failed' || result.status === 'profile_failed') {
    redirect(usersHref({ status, focus: 'invite' }, encodeInviteEcho(form, [])))
  }

  redirect(usersHref({ status, focus: 'invite' }))
}
