import { describe, expect, it } from 'vitest'

import {
  ACCOUNT_ROLES,
  accountControls,
  accountStatusOf,
  activeOwnerCount,
  DEACTIVATE_OUTCOME_CODES,
  describeAccountStatus,
  describeDeactivation,
  describeReactivation,
  describeRoleChange,
  INVITE_OUTCOME_CODES,
  inviteSubmissionSchema,
  isAccountRole,
  LAST_OWNER_NOTE,
  otherRole,
  parseTransitionResult,
  REACTIVATE_OUTCOME_CODES,
  ROLE_LABELS,
  ROLE_OPTIONS,
  ROLE_OUTCOME_CODES,
  toInviteSubmission,
  type Account,
} from '@/lib/accounts/model'

/** The user administration's pure rules — phase 11C (brief §28). */

const OWNER: Account = {
  userId: '11111111-1111-4111-8111-111111111111',
  name: 'Lokal Ejer',
  email: 'owner@example.test',
  role: 'owner',
  disabledAt: null,
  invitedAt: null,
  emailConfirmedAt: '2026-09-01T10:00:00+00:00',
  createdAt: '2026-09-01T10:00:00+00:00',
  updatedAt: '2026-09-01T10:00:00.123456+00:00',
}

const STAFF: Account = {
  ...OWNER,
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'Lokal Medarbejder',
  email: 'staff@example.test',
  role: 'staff',
}

describe('the role vocabulary', () => {
  it('is exactly owner and staff, labelled Ejer and Medarbejder', () => {
    expect([...ACCOUNT_ROLES]).toEqual(['owner', 'staff'])
    expect(ROLE_LABELS).toEqual({ owner: 'Ejer', staff: 'Medarbejder' })
    expect(ROLE_OPTIONS.map((option) => option.value)).toEqual(['staff', 'owner'])
  })

  it('recognises nothing else', () => {
    expect(isAccountRole('owner')).toBe(true)
    expect(isAccountRole('staff')).toBe(true)
    for (const other of ['admin', 'Owner', '', null, undefined, 1, 'superuser']) {
      expect(isAccountRole(other), String(other)).toBe(false)
    }
  })

  it('names the other role', () => {
    expect(otherRole('owner')).toBe('staff')
    expect(otherRole('staff')).toBe('owner')
  })
})

describe('the status view model', () => {
  it('is active for a confirmed, enabled account', () => {
    expect(accountStatusOf(OWNER)).toBe('active')
    expect(describeAccountStatus(OWNER)).toMatchObject({ pill: 'Aktiv', tone: 'active' })
  })

  it('is invited until the invitation is accepted', () => {
    const invited = { ...STAFF, emailConfirmedAt: null, invitedAt: '2026-09-03T08:00:00+00:00' }
    expect(accountStatusOf(invited)).toBe('invited')
    expect(describeAccountStatus(invited)).toMatchObject({ pill: 'Inviteret', tone: 'invited' })
    expect(describeAccountStatus(invited).line).toContain('ikke valgt adgangskode')
  })

  it('is deactivated once disabled_at is set — even for an unaccepted invitation', () => {
    const deactivated = { ...STAFF, disabledAt: '2026-09-03T09:00:00+00:00' }
    expect(accountStatusOf(deactivated)).toBe('deactivated')
    expect(accountStatusOf({ ...deactivated, emailConfirmedAt: null })).toBe('deactivated')
    expect(describeAccountStatus(deactivated)).toMatchObject({ pill: 'Deaktiveret', tone: 'deactivated' })
    expect(describeAccountStatus(deactivated).line).toContain('står stadig i loggen')
  })
})

describe('the controls a row offers', () => {
  it('withholds role and deactivation from the only active owner, and says why', () => {
    const controls = accountControls(OWNER, OWNER.userId, 1)
    expect(controls).toEqual({
      self: true,
      canChangeRole: false,
      canDeactivate: false,
      canReactivate: false,
      withheldReason: 'last_owner',
    })
    expect(LAST_OWNER_NOTE).toContain('Eneste aktive ejer')
  })

  it('offers both to an owner when another active owner exists', () => {
    expect(accountControls(OWNER, STAFF.userId, 2)).toMatchObject({
      self: false,
      canChangeRole: true,
      canDeactivate: true,
      canReactivate: false,
      withheldReason: null,
    })
  })

  it('offers both to a staff member, whatever the owner count', () => {
    expect(accountControls(STAFF, OWNER.userId, 1)).toMatchObject({ canChangeRole: true, canDeactivate: true })
  })

  it('offers only reactivation to a deactivated account', () => {
    const deactivated = { ...OWNER, disabledAt: '2026-09-03T09:00:00+00:00' }
    expect(accountControls(deactivated, STAFF.userId, 0)).toEqual({
      self: false,
      canChangeRole: false,
      canDeactivate: false,
      canReactivate: true,
      withheldReason: null,
    })
  })

  it('counts active owners only', () => {
    expect(activeOwnerCount([OWNER, STAFF, { ...OWNER, disabledAt: 'x' }])).toBe(1)
    expect(activeOwnerCount([OWNER, { ...STAFF, role: 'owner' }])).toBe(2)
    expect(activeOwnerCount([])).toBe(0)
  })
})

describe('the invitation submission', () => {
  it('accepts a name, an address and a role, normalising the address', () => {
    const parsed = toInviteSubmission({ name: '  Ny Person ', email: ' Ny.Person@Example.TEST ', role: 'staff' })
    expect(parsed).toEqual({ ok: true, values: { name: 'Ny Person', email: 'ny.person@example.test', role: 'staff' } })
  })

  it('refuses a blank name, bound to the field', () => {
    const parsed = toInviteSubmission({ name: '   ', email: 'a@example.test', role: 'staff' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.issues).toEqual([{ field: 'name', message: 'Navnet må ikke være tomt.' }])
  })

  it('refuses a name over 120 characters', () => {
    const parsed = toInviteSubmission({ name: 'x'.repeat(121), email: 'a@example.test', role: 'staff' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.issues[0]).toMatchObject({ field: 'name' })
  })

  it('refuses a missing or malformed address in Danish', () => {
    for (const email of ['', '   ', 'ikke en adresse', 'navn@', '@example.test', 'a b@example.test']) {
      const parsed = toInviteSubmission({ name: 'Ny', email, role: 'staff' })
      expect(parsed.ok, email).toBe(false)
      if (parsed.ok) throw new Error('unreachable')
      expect(parsed.issues).toHaveLength(1)
      expect(parsed.issues[0]!.field).toBe('email')
    }
    const blank = toInviteSubmission({ name: 'Ny', email: '', role: 'staff' })
    if (blank.ok) throw new Error('unreachable')
    expect(blank.issues[0]!.message).toBe('Skriv en e-mailadresse.')
    const shaped = toInviteSubmission({ name: 'Ny', email: 'ikke en adresse', role: 'staff' })
    if (shaped.ok) throw new Error('unreachable')
    expect(shaped.issues[0]!.message).toContain('ligner ikke en e-mailadresse')
  })

  it('refuses an address over 254 characters', () => {
    const parsed = toInviteSubmission({ name: 'Ny', email: `${'a'.repeat(250)}@example.test`, role: 'staff' })
    expect(parsed.ok).toBe(false)
  })

  it('refuses a role outside the vocabulary', () => {
    for (const role of ['', 'admin', 'Owner', 'ejer']) {
      const parsed = toInviteSubmission({ name: 'Ny', email: 'a@example.test', role })
      expect(parsed.ok, role).toBe(false)
      if (parsed.ok) throw new Error('unreachable')
      expect(parsed.issues).toEqual([{ field: 'role', message: 'Vælg en rolle: ejer eller medarbejder.' }])
    }
  })

  it('reports every failing field once, in field order', () => {
    const parsed = toInviteSubmission({ name: '', email: 'x', role: 'x' })
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.issues.map((issue) => issue.field)).toEqual(['name', 'email', 'role'])
  })

  it('is strict: a submission cannot carry a field the form does not name', () => {
    const smuggled = inviteSubmissionSchema.safeParse({
      name: 'Ny',
      email: 'a@example.test',
      role: 'staff',
      password: 'hunter2hunter2',
    })
    expect(smuggled.success).toBe(false)
    for (const key of ['user_id', 'disabled_at', 'ban_duration', 'actor_id', 'token']) {
      expect(
        inviteSubmissionSchema.safeParse({ name: 'Ny', email: 'a@example.test', role: 'staff', [key]: 'x' }).success,
        key,
      ).toBe(false)
    }
  })
})

describe('the confirmation wording', () => {
  it('names the person — and "dig selv" for the signed-in owner', () => {
    expect(describeRoleChange(STAFF, false).question).toBe('Gør Lokal Medarbejder (staff@example.test) til ejer?')
    expect(describeRoleChange(OWNER, true).question).toBe('Gør Lokal Ejer (dig selv, owner@example.test) til medarbejder?')
    expect(describeDeactivation(STAFF, false).question).toBe('Deaktivér Lokal Medarbejder (staff@example.test)?')
    expect(describeDeactivation(OWNER, true).question).toBe('Deaktivér Lokal Ejer (dig selv, owner@example.test)?')
    expect(describeReactivation(STAFF).question).toBe('Genaktivér Lokal Medarbejder (staff@example.test)?')
  })

  it('marks the two changes that take access away as destructive, the two that give it as not', () => {
    expect(describeRoleChange(STAFF, false)).toMatchObject({ confirmLabel: 'Gør til ejer', destructive: false })
    expect(describeRoleChange(OWNER, false)).toMatchObject({ confirmLabel: 'Gør til medarbejder', destructive: true })
    expect(describeDeactivation(STAFF, false)).toMatchObject({ confirmLabel: 'Deaktivér', destructive: true })
    expect(describeReactivation(STAFF)).toMatchObject({ confirmLabel: 'Genaktivér', destructive: false })
  })

  it('states the immediate consequence, and the session consequence for oneself', () => {
    expect(describeRoleChange(OWNER, true).consequence).toContain('også i denne fane')
    expect(describeRoleChange(OWNER, false).consequence).toContain('også i en fane, der allerede er åben')
    expect(describeDeactivation(OWNER, true).consequence).toContain('Du bliver logget ud med det samme')
    expect(describeDeactivation(STAFF, false).consequence).toContain('Kontoen slettes ikke')
  })

  it('says a reactivated account gets its existing role back', () => {
    expect(describeReactivation(STAFF).consequence).toContain('får sin rolle tilbage: medarbejder')
    expect(describeReactivation(OWNER).consequence).toContain('får sin rolle tilbage: ejer')
  })
})

describe('the transition result mapping', () => {
  it('reads the closed set of statuses and the version', () => {
    expect(parseTransitionResult({ status: 'updated', updated_at: '2026-09-03T10:00:00+00:00' })).toEqual({
      status: 'updated',
      updatedAt: '2026-09-03T10:00:00+00:00',
    })
    for (const status of ['unchanged', 'stale', 'not_found', 'last_owner']) {
      expect(parseTransitionResult({ status })).toEqual({ status, updatedAt: null })
    }
  })

  it('treats anything else as a failure, never as success', () => {
    for (const value of [null, undefined, 'updated', {}, { status: 'created' }, { status: 'ok' }, []]) {
      expect(parseTransitionResult(value)).toEqual({ status: 'failed', updatedAt: null })
    }
  })

  it('maps the last owner and the stale token to their own codes on every transition', () => {
    for (const codes of [ROLE_OUTCOME_CODES, DEACTIVATE_OUTCOME_CODES, REACTIVATE_OUTCOME_CODES]) {
      expect(codes.last_owner).toBe('sidste_ejer')
      expect(codes.stale).toBe('konflikt')
      expect(codes.forbidden).toBe('afvist')
      expect(codes.not_found).toBe('findes_ikke')
    }
    expect(ROLE_OUTCOME_CODES.updated).toBe('rolle_aendret')
    expect(DEACTIVATE_OUTCOME_CODES.updated).toBe('deaktiveret')
    expect(REACTIVATE_OUTCOME_CODES.updated).toBe('genaktiveret')
  })

  it('distinguishes every invitation outcome, including the duplicate and the partial failure', () => {
    expect(new Set(Object.values(INVITE_OUTCOME_CODES)).size).toBe(Object.keys(INVITE_OUTCOME_CODES).length)
    expect(INVITE_OUTCOME_CODES.exists).toBe('findes')
    expect(INVITE_OUTCOME_CODES.profile_failed).toBe('profil_fejl')
    expect(INVITE_OUTCOME_CODES.attached).toBe('tilknyttet')
  })
})
