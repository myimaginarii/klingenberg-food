import { describe, expect, it } from 'vitest'

import { classifyOwnerState } from '../../../scripts/launch/lib/owner-state.mjs'

/**
 * The bootstrap's decision — technical plan §5 (decision 11); phase 14A.
 *
 * Five named states and three named refusals over the facts the command reads
 * before it writes. Nothing here touches a server; the harness suite
 * (`tests/launch/bootstrap.test.ts`) drives the real Auth server through the
 * same states.
 */

const ID = '00000000-0000-4000-8000-00000000a001'
const OTHER = '00000000-0000-4000-8000-00000000a002'
const EMAIL = 'hans@klingenberg-food.net'

const unconfirmed = { userId: ID, email: EMAIL, emailConfirmedAt: null, bannedUntil: null }
const confirmed = { ...unconfirmed, emailConfirmedAt: '2026-09-05T10:00:00Z' }

function classify(overrides) {
  return classifyOwnerState({ profiles: [], identity: null, testIdentities: 0, harness: false, ...overrides })
}

describe('the first-Owner path and its two repairs', () => {
  it('A — nothing exists: invite and create', () => {
    expect(classify({})).toMatchObject({ state: 'A', action: 'invite' })
  })

  it('B — an unconfirmed identity without a profile: re-invite and create', () => {
    expect(classify({ identity: unconfirmed })).toMatchObject({ state: 'B', action: 'reinvite' })
  })

  it('C — a confirmed identity without a profile: attach, send nothing', () => {
    expect(classify({ identity: confirmed })).toMatchObject({ state: 'C', action: 'attach' })
  })
})

describe('the refusals', () => {
  it('E — any Owner profile, active or disabled, whoever holds it', () => {
    const active = classify({ profiles: [{ userId: OTHER, role: 'owner', disabledAt: null }] })
    expect(active).toMatchObject({ state: 'E', action: 'refuse' })
    expect(active.summary).toMatch(/inert/)

    const disabled = classify({ profiles: [{ userId: OTHER, role: 'owner', disabledAt: '2026-09-01T00:00:00Z' }] })
    expect(disabled).toMatchObject({ state: 'E', action: 'refuse' })

    // Even when the Owner is the very identity being bootstrapped: a second run.
    const own = classify({ identity: confirmed, profiles: [{ userId: ID, role: 'owner', disabledAt: null }] })
    expect(own).toMatchObject({ state: 'E', action: 'refuse' })
  })

  it('D — the identity already has a non-Owner profile: never promote', () => {
    const result = classify({ identity: confirmed, profiles: [{ userId: ID, role: 'staff', disabledAt: null }] })
    expect(result).toMatchObject({ state: 'D', action: 'refuse' })
    expect(result.summary).toMatch(/never changes a role/)
  })

  it('profiles without any Owner: not a fresh application', () => {
    const result = classify({ profiles: [{ userId: OTHER, role: 'staff', disabledAt: null }] })
    expect(result).toMatchObject({ state: 'foreign-profiles', action: 'refuse' })
  })

  it('a banned identity without a profile: ambiguous', () => {
    const result = classify({ identity: { ...confirmed, bannedUntil: '2126-01-01T00:00:00Z' } })
    expect(result).toMatchObject({ state: 'banned', action: 'refuse' })
  })

  it('a directory holding @example.test identities is a development stack — in production only', () => {
    expect(classify({ testIdentities: 2 })).toMatchObject({ state: 'test-stack', action: 'refuse' })
    expect(classify({ testIdentities: 2, harness: true })).toMatchObject({ state: 'A', action: 'invite' })
  })

  it('an Owner refusal wins over every other fact', () => {
    const result = classify({
      identity: { ...confirmed, bannedUntil: '2126-01-01T00:00:00Z' },
      profiles: [{ userId: OTHER, role: 'owner', disabledAt: null }],
    })
    expect(result.state).toBe('E')
  })
})
