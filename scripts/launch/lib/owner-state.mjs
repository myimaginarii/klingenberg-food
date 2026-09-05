/**
 * What the bootstrap finds, and what it may do about it — technical plan §5
 * ("Accounts", decision 11); phase 14A.
 *
 * The bootstrap has one job: put the FIRST Owner into an application that has
 * none. Everything after that belongs to `/admin/brugere`. So the decision is a
 * pure classification over three facts read before anything is written — every
 * profile, the Auth identity holding the Owner's address (if any), and whether
 * the Auth directory holds repository test fixtures — and it names one of three
 * repairs or a refusal:
 *
 *   A  no identity, no profile              → invite, then create the profile
 *   B  unconfirmed identity, no profile     → invite again (the Auth server re-sends
 *                                             to an unconfirmed identity, §0ab),
 *                                             then create the profile
 *   C  confirmed identity, no profile       → create the profile, send nothing:
 *                                             the person already chose a password
 *   D  a profile that is not Owner          → refuse: the bootstrap never changes a role
 *   E  any Owner profile, active or disabled → refuse: the bootstrap is inert
 *
 * B and C are the partial states a first run can leave behind (the Auth server
 * accepted the invitation and the profile write failed); both are repaired by
 * running the same command again with the same address. A banned identity, a
 * database with profiles but no Owner, and a directory holding `@example.test`
 * identities are each refused as ambiguous — none of them is a state the first
 * production run produces, and the bootstrap never deletes an identity to
 * start over.
 */

/**
 * @typedef {{ userId: string, role: string, disabledAt: string | null }} ProfileRow
 * @typedef {{ userId: string, email: string, emailConfirmedAt: string | null, bannedUntil: string | null }} Identity
 * @typedef {'invite' | 'reinvite' | 'attach' | 'refuse'} OwnerAction
 */

/**
 * @param {{
 *   profiles: readonly ProfileRow[],
 *   identity: Identity | null,
 *   testIdentities: number,
 *   harness: boolean,
 * }} facts
 * @returns {{ state: string, action: OwnerAction, summary: string }}
 */
export function classifyOwnerState({ profiles, identity, testIdentities, harness }) {
  if (!harness && testIdentities > 0) {
    return {
      state: 'test-stack',
      action: 'refuse',
      summary:
        `the Auth directory holds ${testIdentities} @example.test identit${testIdentities === 1 ? 'y' : 'ies'} — ` +
        'this is a development stack that ran the local seeder, not a production project',
    }
  }

  const owners = profiles.filter((p) => p.role === 'owner')
  if (owners.length > 0) {
    const active = owners.filter((p) => p.disabledAt === null).length
    return {
      state: 'E',
      action: 'refuse',
      summary:
        `an Owner already exists (${owners.length} Owner profile${owners.length === 1 ? '' : 's'}, ${active} active). ` +
        'The bootstrap is inert once an Owner exists; /admin/brugere owns every account from here',
    }
  }

  const own = identity === null ? null : (profiles.find((p) => p.userId === identity.userId) ?? null)

  if (own !== null) {
    return {
      state: 'D',
      action: 'refuse',
      summary:
        `the identity holding this address already has a ${own.role} profile in an Owner-less database. ` +
        'The bootstrap never changes a role; this state was not produced by it and must be resolved by hand',
    }
  }

  if (profiles.length > 0) {
    return {
      state: 'foreign-profiles',
      action: 'refuse',
      summary:
        `${profiles.length} profile${profiles.length === 1 ? '' : 's'} exist and none is an Owner. ` +
        'That is not a fresh application and not a state the bootstrap produces; resolve it by hand',
    }
  }

  if (identity === null) {
    return { state: 'A', action: 'invite', summary: 'no identity and no profile — a fresh application' }
  }

  if (identity.bannedUntil !== null) {
    return {
      state: 'banned',
      action: 'refuse',
      summary: 'the identity holding this address is banned and has no profile; the bootstrap does not lift bans',
    }
  }

  if (identity.emailConfirmedAt === null) {
    return {
      state: 'B',
      action: 'reinvite',
      summary: 'an unconfirmed identity holds this address and has no profile — the invitation is re-sent and the profile created',
    }
  }

  return {
    state: 'C',
    action: 'attach',
    summary: 'a confirmed identity holds this address and has no profile — the profile is created; nothing is sent',
  }
}
