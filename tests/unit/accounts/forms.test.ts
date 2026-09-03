import { describe, expect, it } from 'vitest'

import {
  accountTargetSchema,
  decodeInviteErrors,
  encodeInviteEcho,
  readAccountTarget,
  readInviteForm,
  USERS_ERROR_FIELD,
  USERS_FORM,
} from '@/app/(admin)/admin/brugere/forms'
import { rowControlId, USERS_ADMIN_PATH, usersHref } from '@/app/(admin)/admin/brugere/routes'
import { USERS_MESSAGES } from '@/components/admin/users/UsersStatusNotice'
import {
  DEACTIVATE_OUTCOME_CODES,
  DEACTIVATED_SESSIONS_OPEN_CODE,
  INVITE_OUTCOME_CODES,
  REACTIVATE_OUTCOME_CODES,
  REACTIVATED_LOGIN_LOCKED_CODE,
  ROLE_OUTCOME_CODES,
} from '@/lib/accounts/model'

/** The user administration's form vocabulary and addresses — phase 11C; technical plan §8. */

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

const UID = '33333333-3333-4333-8333-333333333333'
const VERSION = '2026-09-03T10:00:00.123456+00:00'

describe('the vocabulary', () => {
  it('is exactly five fields — a name, an address, a role, a target and a version', () => {
    expect(Object.values(USERS_FORM).sort()).toEqual(['bruger', 'email', 'navn', 'rolle', 'version'])
  })

  it('has no field for a password, a token, an actor, a ban or a metadata blob', () => {
    for (const forbidden of [
      'password',
      'adgangskode',
      'token',
      'actor',
      'actor_id',
      'ban_duration',
      'user_metadata',
      'app_metadata',
      'disabled_at',
      'user_id',
    ]) {
      expect(Object.values(USERS_FORM) as string[]).not.toContain(forbidden)
    }
  })

  it('reads exactly what was typed, a missing field as the empty string', () => {
    expect(readInviteForm(form({ navn: ' Ny ', email: 'A@Example.test' }))).toEqual({
      name: ' Ny ',
      email: 'A@Example.test',
      role: '',
    })
  })
})

describe('the account target', () => {
  it('is a uuid and an offset timestamp, and nothing else', () => {
    expect(readAccountTarget(form({ bruger: UID, version: VERSION }))).toEqual({
      userId: UID,
      expectedUpdatedAt: VERSION,
    })
  })

  it('refuses a missing, malformed or forged target', () => {
    expect(readAccountTarget(form({ bruger: 'not-a-uuid', version: VERSION }))).toBeNull()
    expect(readAccountTarget(form({ bruger: UID, version: 'yesterday' }))).toBeNull()
    expect(readAccountTarget(form({ bruger: UID }))).toBeNull()
    expect(readAccountTarget(form({ version: VERSION }))).toBeNull()
    expect(readAccountTarget(form({ bruger: `${UID} or 1=1`, version: VERSION }))).toBeNull()
  })

  it('is strict: a target cannot carry an actor or any other key', () => {
    expect(accountTargetSchema.safeParse({ userId: UID, expectedUpdatedAt: VERSION, actorId: UID }).success).toBe(false)
    expect(accountTargetSchema.safeParse({ userId: UID, expectedUpdatedAt: VERSION, role: 'owner' }).success).toBe(false)
  })
})

describe('errors and echoes', () => {
  it('round-trips the issues and the typed values through the address', () => {
    const typed = readInviteForm(form({ navn: '', email: 'x', rolle: 'staff' }))
    const echo = encodeInviteEcho(typed, [
      { field: 'name', message: 'Navnet må ikke være tomt.' },
      { field: 'email', message: 'Det ligner ikke en e-mailadresse.' },
    ])

    expect(decodeInviteErrors(echo.getAll(USERS_ERROR_FIELD))).toEqual([
      { field: 'name', message: 'Navnet må ikke være tomt.' },
      { field: 'email', message: 'Det ligner ikke en e-mailadresse.' },
    ])
    expect(readInviteForm(echo)).toEqual(typed)
  })

  it('ignores an issue for a field this screen does not have, and a malformed one', () => {
    expect(decodeInviteErrors(['password:x', 'navn', ':x', 'navn:', 'rolle:Vælg en rolle.'])).toEqual([
      { field: 'role', message: 'Vælg en rolle.' },
    ])
  })
})

describe('the addresses', () => {
  it('build the screen, a status, a confirmation and a way back', () => {
    expect(usersHref()).toBe(USERS_ADMIN_PATH)
    expect(usersHref({ status: 'inviteret', focus: 'invite' })).toBe(`${USERS_ADMIN_PATH}?status=inviteret#inviter`)
    expect(usersHref({ confirmRole: UID })).toBe(`${USERS_ADMIN_PATH}?rolle=${UID}#rolle-bekraeft`)
    expect(usersHref({ confirmDeactivate: UID })).toBe(`${USERS_ADMIN_PATH}?deaktiver=${UID}#deaktiver-bekraeft`)
    expect(usersHref({ confirmReactivate: UID })).toBe(`${USERS_ADMIN_PATH}?genaktiver=${UID}#genaktiver-bekraeft`)
    expect(usersHref({ status: 'deaktiveret', focus: { userId: UID, control: 'reactivate' } })).toBe(
      `${USERS_ADMIN_PATH}?status=deaktiveret#${rowControlId(UID, 'reactivate')}`,
    )
  })

  it('carry an echo', () => {
    const extra = new URLSearchParams({ navn: 'Ny', email: 'x' })
    expect(usersHref({ status: 'ugyldig', focus: 'invite' }, extra)).toBe(
      `${USERS_ADMIN_PATH}?status=ugyldig&navn=Ny&email=x#inviter`,
    )
  })
})

describe('every outcome code has a sentence', () => {
  it('for invitations, role changes, deactivations and reactivations', () => {
    const codes = [
      ...Object.values(INVITE_OUTCOME_CODES),
      ...Object.values(ROLE_OUTCOME_CODES),
      ...Object.values(DEACTIVATE_OUTCOME_CODES),
      ...Object.values(REACTIVATE_OUTCOME_CODES),
      DEACTIVATED_SESSIONS_OPEN_CODE,
      REACTIVATED_LOGIN_LOCKED_CODE,
      'ugyldig_aendring',
    ]
    for (const code of codes) {
      expect(USERS_MESSAGES[code], code).toBeDefined()
    }
  })

  it('is honest about the partial outcomes', () => {
    expect(USERS_MESSAGES[DEACTIVATED_SESSIONS_OPEN_CODE]!.text).toContain('afvises i administrationen')
    expect(USERS_MESSAGES[REACTIVATED_LOGIN_LOCKED_CODE]!.text).toContain('kan ikke logge ind endnu')
    expect(USERS_MESSAGES.tilknyttet!.text).toContain('ikke sendt nogen e-mail')
    expect(USERS_MESSAGES.profil_fejl!.text).toContain('Send invitationen igen')
  })

  it('never claims a password was shown or sent', () => {
    for (const message of Object.values(USERS_MESSAGES)) {
      expect(message.text.toLowerCase()).not.toMatch(/adgangskoden er|her er adgangskoden|midlertidig adgangskode/)
    }
  })
})
