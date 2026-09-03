import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { changeAccountRole, inviteAccount, setAccountActive } from '@/lib/accounts/admin'
import { createAuthAdmin } from '@/lib/accounts/auth-admin'
import type { Account } from '@/lib/accounts/model'

import {
  caughtMailFor,
  confirmLocalAuthUser,
  deleteLocalAuthUser,
  findLocalAuthUser,
  inviteLinkOf,
  listLocalAccountAudit,
  listLocalProfiles,
  restoreSeededIdentities,
} from '../support/local-auth-admin'

/**
 * The user administration against the real local stack — technical plan §5
 * ("Accounts", decision 11), §8, §10c; phase 11C (brief §30).
 *
 * pgTAP `028` owns the database authority boundary; the unit suites own the pure
 * rules. What only this suite can honestly cover is the Auth server itself, driven
 * through the same two modules the Server Actions use — `createAuthAdmin()` over the
 * service role, and the orchestration in `lib/accounts/admin.ts` over an Owner's
 * REST client — with no fake admin screen and no test-only route:
 *
 *   * an invitation creates the identity, the Auth server accepts the Danish
 *     e-mail (the local mail catcher receives it, with the `/admin/bekraeft`
 *     token link and no password), and the profile is created behind it;
 *   * the duplicate: the same address again is `exists`; an unconfirmed one is
 *     re-sent (`reinvited`);
 *   * the partial failure and its repair: an identity with no profile is given
 *     one by the same form (`invited` while unconfirmed — a second e-mail; `attached`
 *     once confirmed — no e-mail);
 *   * accepting the invitation: the token from the e-mail establishes a session,
 *     the person sets a password and signs in;
 *   * deactivation: the database refuses the old token at once (RLS), the person's
 *     Auth sessions are gone (the transition revoked them), the Auth server refuses
 *     the old access token and a new sign-in (the ban);
 *   * reactivation: a fresh sign-in works, the role is kept, and the old refresh
 *     token stays dead — measured, because a ban alone would have let it resume;
 *   * a Staff REST session cannot call any of it.
 *
 * Everything it creates it removes; the seeded identities are restored exactly.
 *
 * Prerequisites, as for pgTAP: `npm run db:start` (with the invite template loaded —
 * `supabase/config.toml`) and the seeded local identities.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const RUN = Date.now().toString(36)
const INVITEE = `integration-${RUN}@example.test`
const ORPHAN = `integration-orphan-${RUN}@example.test`
const INVITEE_PASSWORD = 'IntegrationPass12345'

let ownerRest: SupabaseClient
let staffRest: SupabaseClient
let auth: ReturnType<typeof createAuthAdmin>

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`)
  return client
}

/** The directory the way the page reads it, through the Owner's REST session. */
async function directory(): Promise<Account[]> {
  const { data, error } = await ownerRest.rpc('list_accounts')
  if (error) throw error
  return (data as Record<string, string | null>[]).map((row) => ({
    userId: row.user_id as string,
    name: row.name as string,
    email: (row.email as string).toLowerCase(),
    role: row.role as Account['role'],
    disabledAt: row.disabled_at ?? null,
    invitedAt: row.invited_at ?? null,
    emailConfirmedAt: row.email_confirmed_at ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }))
}

async function accountOf(email: string): Promise<Account> {
  const account = (await directory()).find((row) => row.email === email)
  if (account === undefined) throw new Error(`${email} is not in the directory`)
  return account
}

beforeAll(async () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('The account integration tests need the local Supabase stack (.env.local).')
  }

  // A previous interrupted run must not leave identities behind.
  await deleteLocalAuthUser(INVITEE)
  await deleteLocalAuthUser(ORPHAN)

  auth = createAuthAdmin()
  ownerRest = await signedIn('owner@example.test', 'LocalOwner12345')
  staffRest = await signedIn('staff@example.test', 'LocalStaff12345')
})

afterAll(async () => {
  await deleteLocalAuthUser(INVITEE)
  await deleteLocalAuthUser(ORPHAN)
  await restoreSeededIdentities()
  await ownerRest?.auth.signOut({ scope: 'local' })
  await staffRest?.auth.signOut({ scope: 'local' })

  const left = (await listLocalProfiles()).map((profile) => profile.name).sort()
  expect(left).toEqual(['Lokal Ejer', 'Lokal Medarbejder'])
})

describe('the invitation', () => {
  it('creates the identity, the Auth server accepts the Danish e-mail, and the profile follows', async () => {
    const result = await inviteAccount(
      ownerRest,
      auth,
      { name: 'Integrationsperson', email: INVITEE, role: 'staff' },
      await directory(),
    )
    expect(result.status).toBe('invited')

    const identity = await findLocalAuthUser(INVITEE)
    expect(identity).not.toBeNull()
    expect(identity!.emailConfirmedAt).toBeNull()

    const account = await accountOf(INVITEE)
    expect(account).toMatchObject({ name: 'Integrationsperson', role: 'staff', disabledAt: null, emailConfirmedAt: null })
    expect(account.invitedAt).not.toBeNull()

    const mail = await caughtMailFor(INVITEE)
    expect(mail).toHaveLength(1)
    expect(mail[0]!.subject).toBe('Du er inviteret til administrationen af Klingenberg Food')
    expect(mail[0]!.html).toContain('Vælg adgangskode og log ind')
    expect(inviteLinkOf(mail[0]!)).toMatchObject({ type: 'invite' })
    // No password, no token in the clear beyond the one-time hash the route consumes.
    expect(mail[0]!.html.toLowerCase()).not.toMatch(/adgangskoden er|password:|IntegrationPass/i)
    expect(mail[0]!.html).not.toContain('/auth/v1/verify')

    const audit = await listLocalAccountAudit(identity!.id)
    expect(audit.map((row) => row.action)).toEqual(['invite'])
    expect(audit[0]!.actorId).toBe((await accountOf('owner@example.test')).userId)
  })

  it('re-sends to an account that has not accepted yet, keeping its name and role', async () => {
    const result = await inviteAccount(
      ownerRest,
      auth,
      { name: 'Et Andet Navn', email: INVITEE.toUpperCase(), role: 'owner' },
      await directory(),
    )
    expect(result.status).toBe('reinvited')

    expect(await accountOf(INVITEE)).toMatchObject({ name: 'Integrationsperson', role: 'staff' })
    expect(await caughtMailFor(INVITEE)).toHaveLength(2)
    expect((await listLocalAccountAudit((await findLocalAuthUser(INVITEE))!.id)).length).toBe(1)
  })

  it('refuses the seeded address as a duplicate, without asking the Auth server', async () => {
    const result = await inviteAccount(
      ownerRest,
      auth,
      { name: 'Dublet', email: 'staff@example.test', role: 'owner' },
      await directory(),
    )
    expect(result.status).toBe('exists')
    expect(await accountOf('staff@example.test')).toMatchObject({ name: 'Lokal Medarbejder', role: 'staff' })
    expect(await caughtMailFor('staff@example.test')).toHaveLength(0)
  })

  it('refuses an address the Auth server refuses, creating nothing', async () => {
    const result = await inviteAccount(
      ownerRest,
      auth,
      { name: 'Ugyldig', email: 'not-an-address', role: 'staff' },
      await directory(),
    )
    expect(result.status).toBe('invalid_email')
  })

  it('repairs an identity with no profile — the partial failure — from the same form', async () => {
    // Stage the partial failure: an unconfirmed identity exists, no profile behind it.
    const staged = await auth.inviteByEmail(ORPHAN, 'Forældreløs')
    expect(staged.status).toBe('invited')
    expect((await directory()).some((row) => row.email === ORPHAN)).toBe(false)

    // The form again, while unconfirmed: a second e-mail, and the profile.
    const repaired = await inviteAccount(
      ownerRest,
      auth,
      { name: 'Forældreløs', email: ORPHAN, role: 'staff' },
      await directory(),
    )
    expect(repaired.status).toBe('invited')
    expect(await accountOf(ORPHAN)).toMatchObject({ name: 'Forældreløs', role: 'staff' })
    expect(await caughtMailFor(ORPHAN)).toHaveLength(2)
  })

  it('attaches a confirmed identity with no profile without sending any e-mail', async () => {
    // Stage: a confirmed identity that lost its profile (the service role, as a
    // migration or an operator could).
    await deleteLocalAuthUser(ORPHAN)
    const staged = await auth.inviteByEmail(ORPHAN, 'Forældreløs')
    expect(staged.status).toBe('invited')
    const identity = await findLocalAuthUser(ORPHAN)
    const mailsBefore = (await caughtMailFor(ORPHAN)).length

    // Confirm it the way accepting the invitation would, without a profile —
    // through the test-only door, never a second service client.
    await confirmLocalAuthUser(ORPHAN)

    const attached = await inviteAccount(
      ownerRest,
      auth,
      { name: 'Forældreløs', email: ORPHAN, role: 'owner' },
      await directory(),
    )
    expect(attached.status).toBe('attached')
    expect(await accountOf(ORPHAN)).toMatchObject({ role: 'owner', userId: identity!.id })
    expect((await caughtMailFor(ORPHAN)).length).toBe(mailsBefore)

    // And once it has a profile, the same address is simply a duplicate.
    const again = await inviteAccount(
      ownerRest,
      auth,
      { name: 'Forældreløs', email: ORPHAN, role: 'staff' },
      await directory(),
    )
    expect(again.status).toBe('exists')
  })
})

describe('accepting the invitation', () => {
  let inviteeAccess: string
  let inviteeRefresh: string

  it('the token in the e-mail establishes a session, the person sets a password and signs in', async () => {
    const [latest] = await caughtMailFor(INVITEE)
    const link = inviteLinkOf(latest!)
    expect(link).not.toBeNull()

    // What /admin/bekraeft does server-side, on a client that holds no session.
    const accepting = anonClient()
    const verified = await accepting.auth.verifyOtp({ type: 'invite', token_hash: link!.tokenHash })
    expect(verified.error).toBeNull()
    expect(verified.data.user?.email).toBe(INVITEE)

    // What /admin/ny-adgangskode does: the person's own password.
    const updated = await accepting.auth.updateUser({ password: INVITEE_PASSWORD })
    expect(updated.error).toBeNull()
    await accepting.auth.signOut({ scope: 'local' })

    expect((await findLocalAuthUser(INVITEE))!.emailConfirmedAt).not.toBeNull()
    expect(await accountOf(INVITEE)).toMatchObject({ role: 'staff', disabledAt: null })
    expect((await accountOf(INVITEE)).emailConfirmedAt).not.toBeNull()

    const signedInInvitee = await signedIn(INVITEE, INVITEE_PASSWORD)
    const session = await signedInInvitee.auth.getSession()
    inviteeAccess = session.data.session!.access_token
    inviteeRefresh = session.data.session!.refresh_token

    // A staff member: reads their own profile, and cannot list the accounts.
    const own = await signedInInvitee.from('profiles').select('name').eq('user_id', (await accountOf(INVITEE)).userId)
    expect(own.data).toEqual([{ name: 'Integrationsperson' }])
    const listing = await signedInInvitee.rpc('list_accounts')
    expect(listing.error?.code).toBe('42501')
  })

  it('a used invitation token is dead', async () => {
    const [latest] = await caughtMailFor(INVITEE)
    const link = inviteLinkOf(latest!)
    const again = await anonClient().auth.verifyOtp({ type: 'invite', token_hash: link!.tokenHash })
    expect(again.error).not.toBeNull()
  })

  it('a role change is in force for the old token at once', async () => {
    const account = await accountOf(INVITEE)
    const promoted = await changeAccountRole(ownerRest, {
      userId: account.userId,
      role: 'owner',
      expectedUpdatedAt: account.updatedAt,
    })
    expect(promoted.status).toBe('updated')

    const asInvitee = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${inviteeAccess}` } },
    })
    const listing = await asInvitee.rpc('list_accounts')
    expect(listing.error).toBeNull()
    expect((listing.data as unknown[]).length).toBeGreaterThanOrEqual(3)

    const stale = await changeAccountRole(ownerRest, {
      userId: account.userId,
      role: 'staff',
      expectedUpdatedAt: account.updatedAt,
    })
    expect(stale.status).toBe('stale')

    const current = await accountOf(INVITEE)
    const demoted = await changeAccountRole(ownerRest, {
      userId: current.userId,
      role: 'staff',
      expectedUpdatedAt: current.updatedAt,
    })
    expect(demoted.status).toBe('updated')

    const refused = await asInvitee.rpc('list_accounts')
    expect(refused.error?.code).toBe('42501')
  })

  it('deactivation refuses the old token in the database and at the Auth server, and ends the sessions', async () => {
    const account = await accountOf(INVITEE)
    const result = await setAccountActive(ownerRest, auth, {
      userId: account.userId,
      active: false,
      expectedUpdatedAt: account.updatedAt,
    })
    expect(result).toMatchObject({ status: 'updated', authStep: 'done' })
    expect((await findLocalAuthUser(INVITEE))!.bannedUntil).not.toBeNull()

    // The database: the old JWT is cryptographically fine and authorises nothing.
    const asInvitee = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${inviteeAccess}` } },
    })
    const write = await asInvitee.from('dishes').update({ draft: { name: 'x' } }).not('id', 'is', null).select('id')
    expect(write.error).toBeNull()
    expect(write.data).toEqual([])
    const audit = await asInvitee.rpc('log_audit', { p_action: 'publish', p_entity: 'dishes' })
    expect(audit.error?.code).toBe('42501')

    // The Auth server: the old access token is refused (the ban), the refresh token
    // is GONE (the transition revoked the sessions), and a new sign-in is refused.
    // The Auth server answers 403 session_not_found for a token whose session row is
    // gone (measured; the ban would answer user_banned for a token whose session
    // still existed), and auth-js surfaces that as "no session" — which is exactly
    // what `getSessionUser()` turns into a redirect to the login screen.
    const user = await asInvitee.auth.getUser(inviteeAccess)
    expect(user.data.user).toBeNull()
    expect(user.error).not.toBeNull()
    // "Not found", not "banned": the session row is gone, not merely held.
    const refreshed = await anonClient().auth.refreshSession({ refresh_token: inviteeRefresh })
    expect(refreshed.error?.code).toBe('refresh_token_not_found')
    const signIn = await anonClient().auth.signInWithPassword({ email: INVITEE, password: INVITEE_PASSWORD })
    expect(signIn.error?.code).toBe('user_banned')

    // Deactivating again repeats the ban and changes nothing.
    const current = await accountOf(INVITEE)
    const again = await setAccountActive(ownerRest, auth, {
      userId: current.userId,
      active: false,
      expectedUpdatedAt: current.updatedAt,
    })
    expect(again).toMatchObject({ status: 'unchanged', authStep: 'done' })

    const history = await listLocalAccountAudit(account.userId)
    expect(history.map((row) => row.action)).toEqual(['invite', 'role', 'role', 'deactivate'])
  })

  it('reactivation restores sign-in with the existing role; the old refresh token stays dead', async () => {
    const account = await accountOf(INVITEE)
    const result = await setAccountActive(ownerRest, auth, {
      userId: account.userId,
      active: true,
      expectedUpdatedAt: account.updatedAt,
    })
    expect(result).toMatchObject({ status: 'updated', authStep: 'done' })
    expect((await findLocalAuthUser(INVITEE))!.bannedUntil).toBeNull()
    expect(await accountOf(INVITEE)).toMatchObject({ role: 'staff', disabledAt: null })

    // Measured: a ban alone would have let this refresh token resume the session
    // once lifted; the revocation inside the transition is what keeps it dead.
    const refreshed = await anonClient().auth.refreshSession({ refresh_token: inviteeRefresh })
    expect(refreshed.error?.code).toBe('refresh_token_not_found')

    const fresh = await signedIn(INVITEE, INVITEE_PASSWORD)
    const own = await fresh.from('profiles').select('role')
    expect(own.data).toEqual([{ role: 'staff' }])
    await fresh.auth.signOut({ scope: 'local' })
  })
})

describe('a Staff session', () => {
  it('cannot invite, change a role, deactivate or list', async () => {
    const account = await accountOf(INVITEE)

    const invite = await staffRest.rpc('create_account_profile', {
      p_user_id: account.userId,
      p_name: 'x',
      p_role: 'owner',
    })
    expect(invite.error?.code).toBe('42501')

    const role = await changeAccountRole(staffRest, {
      userId: account.userId,
      role: 'owner',
      expectedUpdatedAt: account.updatedAt,
    })
    expect(role.status).toBe('forbidden')

    const active = await setAccountActive(staffRest, auth, {
      userId: account.userId,
      active: false,
      expectedUpdatedAt: account.updatedAt,
    })
    expect(active).toMatchObject({ status: 'forbidden', authStep: 'skipped' })
    expect((await findLocalAuthUser(INVITEE))!.bannedUntil).toBeNull()

    const listing = await staffRest.rpc('list_accounts')
    expect(listing.error?.code).toBe('42501')

    const direct = await staffRest.from('profiles').update({ role: 'owner' }).eq('user_id', account.userId).select('user_id')
    expect(direct.data).toEqual([])
  })

  it('an Owner session cannot move the columns directly either', async () => {
    const account = await accountOf(INVITEE)
    const role = await ownerRest.from('profiles').update({ role: 'owner' }).eq('user_id', account.userId).select('user_id')
    expect(role.error?.code).toBe('42501')
    const state = await ownerRest.from('profiles').update({ disabled_at: new Date().toISOString() }).eq('user_id', account.userId).select('user_id')
    expect(state.error?.code).toBe('42501')
    const removal = await ownerRest.from('profiles').delete().eq('user_id', account.userId).select('user_id')
    expect(removal.error?.code).toBe('42501')
  })
})
