import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  caughtMailFor,
  confirmLocalAuthUser,
  deleteLocalAuthUser,
  findLocalAuthUser,
  inviteLinkOf,
  restoreSeededIdentities,
} from '../support/local-auth-admin'
import { NAMES, launch, localStack, sql } from './support.mjs'

/**
 * The Owner bootstrap against the real local Auth server — technical plan §5
 * (decision 11), §8, §10c; phase 14A.
 *
 * The production guard is exercised as production (the local stack refused, a
 * reserved address refused), then the same code in its harness mode through
 * every state `lib/owner-state.mjs` names: the seeded Owner makes it inert (E);
 * the application is then made Owner-less by hand — the command never does that
 * — and the first Owner is invited (A: the Danish invitation lands in the mail
 * catcher with a one-time link and no password, the profile is created, the
 * audit row written, nothing secret printed); a second run refuses; the profile
 * is removed and the two partial states are repaired (B: re-sent, C: attached
 * without an e-mail); a non-Owner profile (D) and a banned identity refuse. The
 * seeded identities are restored exactly at the end.
 */

const RUN = Date.now().toString(36)
const OWNER = `bootstrap-${RUN}@example.test`
const OWNER_NAME = 'Harness Ejer'

let stack
let service
let ownerId

const profiles = () =>
  sql(stack.dbContainer, "select coalesce(json_agg(json_build_object('user_id', user_id, 'name', name, 'role', role, 'disabled_at', disabled_at) order by name), '[]')::text from public.profiles;").then(JSON.parse)

const bootstrapAudit = () =>
  sql(stack.dbContainer, "select coalesce(json_agg(json_build_object('entity_id', entity_id, 'actor_id', actor_id, 'after', \"after\")), '[]')::text from public.audit_log where action = 'bootstrap';").then(JSON.parse)

/** The states the command must never produce, manufactured as the superuser with triggers quiet. */
const replica = (text) => sql(stack.dbContainer, `set session_replication_role = replica; ${text}`)

function harness(args = [], env = {}) {
  return launch('bootstrap-owner.mjs', ['--local-harness', '--email', OWNER, '--name', OWNER_NAME, ...args], {
    [NAMES.bootstrapConfirmHost]: stack.apiHost,
    ...env,
  })
}

beforeAll(async () => {
  stack = await localStack()
  service = createClient(stack.apiUrl, stack.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  await deleteLocalAuthUser(OWNER)
  await restoreSeededIdentities()
})

afterAll(async () => {
  // The seeded Owner first (so the harness Owner is not the last active one), then the harness identity.
  await replica('delete from public.profiles;')
  await restoreSeededIdentities()
  await deleteLocalAuthUser(OWNER)
  await sql(stack.dbContainer, "delete from public.audit_log where action = 'bootstrap';")
})

describe('the production guard', () => {
  it('refuses the local stack in production mode, credentials notwithstanding', async () => {
    const run = await launch('bootstrap-owner.mjs', ['--email', 'hans@klingenberg-food.net', '--name', 'Hans'], { [NAMES.bootstrapConfirmHost]: stack.apiHost })
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/refused — The target .* is the local stack/)
  })

  it('the harness refuses a missing confirmation, a wrong one, and an address outside @example.test', async () => {
    expect((await harness([], { [NAMES.bootstrapConfirmHost]: undefined })).code).toBe(1)
    const wrong = await harness([], { [NAMES.bootstrapConfirmHost]: 'localhost' })
    expect(wrong.code).toBe(1)
    expect(wrong.output).toMatch(/must match exactly/)
    const real = await launch('bootstrap-owner.mjs', ['--local-harness', '--email', 'hans@klingenberg-food.net', '--name', 'Hans'], { [NAMES.bootstrapConfirmHost]: stack.apiHost })
    expect(real.code).toBe(1)
    expect(real.output).toMatch(/@example.test addresses only/)
  })

  it('needs both the address and the name', async () => {
    const run = await launch('bootstrap-owner.mjs', ['--local-harness', '--email', OWNER], { [NAMES.bootstrapConfirmHost]: stack.apiHost })
    expect(run.code).toBe(2)
    expect(run.output).toMatch(/usage/)
  })
})

describe('the bootstrap', () => {
  it('E — is inert while the seeded Owner exists', async () => {
    const run = await harness()
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/state E: an Owner already exists \(1 Owner profile, 1 active\)/)
    expect(await findLocalAuthUser(OWNER)).toBeNull()
  })

  it('a dry run against an Owner-less application changes nothing', async () => {
    await replica('delete from public.profiles;')
    expect(await profiles()).toEqual([])

    const run = await harness(['--dry-run'])
    expect(run.code).toBe(0)
    expect(run.output).toContain('state A: no identity and no profile')
    expect(run.output).toMatch(/dry run — would send the invitation/)
    expect(await profiles()).toEqual([])
    expect(await findLocalAuthUser(OWNER)).toBeNull()
  })

  it('A — invites the first Owner, creates the profile, prints nothing secret', async () => {
    const run = await harness()
    expect(run.output).toContain(`invitation: sent to ${OWNER}`)
    expect(run.output).toContain('profile: created (role owner, active)')
    expect(run.output).toContain('bootstrap complete')
    expect(run.code).toBe(0)

    expect(run.output).not.toContain(stack.serviceRoleKey)
    // No token, no link, no credential value — "chooses a password" is the next step, not a value.
    expect(run.output).not.toMatch(/token_hash|bekraeft\?|password[:=]|adgangskode[:=]|eyJ[A-Za-z0-9_-]{20,}/i)

    const identity = await findLocalAuthUser(OWNER)
    expect(identity).not.toBeNull()
    expect(identity.emailConfirmedAt).toBeNull()
    ownerId = identity.id

    expect(await profiles()).toEqual([{ user_id: ownerId, name: OWNER_NAME, role: 'owner', disabled_at: null }])

    const audit = await bootstrapAudit()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entity_id: ownerId, actor_id: null, after: { name: OWNER_NAME, role: 'owner', invitation: 'invite' } })

    // The Danish invitation, with the one-time link and no password.
    const mail = await caughtMailFor(OWNER)
    expect(mail.length).toBeGreaterThanOrEqual(1)
    expect(mail[0].subject).toBe('Du er inviteret til administrationen af Klingenberg Food')
    expect(inviteLinkOf(mail[0])).toMatchObject({ type: 'invite' })
    expect(mail[0].html).not.toMatch(/adgangskode:\s*\S/i)
  })

  it('E — a second run refuses, and the identity is left alone', async () => {
    const before = (await caughtMailFor(OWNER)).length
    const run = await harness()
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/state E: an Owner already exists/)
    expect((await caughtMailFor(OWNER)).length).toBe(before)
    expect(await profiles()).toHaveLength(1)
  })

  it('B — an invitation without its profile is repaired: re-sent, profile created', async () => {
    await replica(`delete from public.profiles where user_id = '${ownerId}';`)
    const before = (await caughtMailFor(OWNER)).length

    const run = await harness()
    expect(run.output).toContain('state B:')
    expect(run.output).toContain(`invitation: re-sent to ${OWNER}`)
    expect(run.output).toContain('profile: created')
    expect(run.code).toBe(0)

    expect((await findLocalAuthUser(OWNER)).id).toBe(ownerId)
    expect(await profiles()).toEqual([{ user_id: ownerId, name: OWNER_NAME, role: 'owner', disabled_at: null }])
    expect((await caughtMailFor(OWNER)).length).toBe(before + 1)
  })

  it('C — a confirmed identity without its profile is attached, and nothing is sent', async () => {
    await replica(`delete from public.profiles where user_id = '${ownerId}';`)
    await confirmLocalAuthUser(OWNER)
    const before = (await caughtMailFor(OWNER)).length

    const run = await harness()
    expect(run.output).toContain('state C:')
    expect(run.output).toContain('invitation: none')
    expect(run.output).toContain('profile: created')
    expect(run.output).toMatch(/next: the Owner signs in/)
    expect(run.code).toBe(0)

    expect(await profiles()).toEqual([{ user_id: ownerId, name: OWNER_NAME, role: 'owner', disabled_at: null }])
    expect((await caughtMailFor(OWNER)).length).toBe(before)
  })

  it('D — a non-Owner profile behind the address is never promoted', async () => {
    await replica(`update public.profiles set role = 'staff' where user_id = '${ownerId}';`)
    const run = await harness()
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/state D: .* has a staff profile in an Owner-less database/)
    expect(await profiles()).toEqual([{ user_id: ownerId, name: OWNER_NAME, role: 'staff', disabled_at: null }])
  })

  it('a banned identity without a profile is ambiguous — refused, ban kept', async () => {
    await replica(`delete from public.profiles where user_id = '${ownerId}';`)
    const { error } = await service.auth.admin.updateUserById(ownerId, { ban_duration: '876000h' })
    expect(error).toBeNull()

    const run = await harness()
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/state banned:/)
    expect(await profiles()).toEqual([])
    expect((await findLocalAuthUser(OWNER)).bannedUntil).not.toBeNull()

    await service.auth.admin.updateUserById(ownerId, { ban_duration: 'none' })
  })

  it('profiles without any Owner are not a fresh application — refused', async () => {
    await restoreSeededIdentities()
    await replica("delete from public.profiles where role = 'owner';")
    const run = await harness()
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/state foreign-profiles:/)
  })
})
