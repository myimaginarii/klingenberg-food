import { z } from 'zod'

import { requiredText } from '@/lib/schemas/primitives'

/**
 * The user administration's rules — technical plan §5 ("Accounts", decision 11),
 * §8; phase 11C.
 *
 * Pure. The role vocabulary, what an invitation submission means, what an account
 * row looks like on screen, which controls a row offers and why one is withheld,
 * the confirmation sentences, and the closed set of outcomes the screen can report
 * — with no database, no Auth client, no React and no knowledge of a browser.
 *
 * THE ROLES ARE EXACTLY THE TWO THE SCHEMA STORES. `profiles.role` is
 * `'owner' | 'staff'` under a CHECK (phase 1); nothing here or anywhere else adds
 * a third, and the labels are §5's own words: Ejer and Medarbejder.
 *
 * ONE IDENTITY, TWO OWNERS OF TWO FACTS. The e-mail belongs to Supabase Auth and
 * arrives in the read model from `auth.users`; the name, the role and the active
 * state belong to `profiles`. Nothing in this module copies one into the other.
 *
 * THE LAST ACTIVE OWNER. `withheldReason` says *why* a row offers no role or
 * deactivation control — the person is the only active owner — so the screen can
 * state it in words. It is an explanation, never the enforcement: the database
 * transitions refuse the same operation under a lock (`set_account_role()`,
 * `set_account_active()`, migration 20260903120000), and the deferred constraint
 * trigger refuses it again at commit for any path that bypasses them.
 */

export const ACCOUNT_ROLES = ['owner', 'staff'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

export const ROLE_LABELS: Readonly<Record<AccountRole, string>> = {
  owner: 'Ejer',
  staff: 'Medarbejder',
}

export function isAccountRole(value: unknown): value is AccountRole {
  return value === 'owner' || value === 'staff'
}

/** The role a change would move an account to — the one it does not hold. */
export function otherRole(role: AccountRole): AccountRole {
  return role === 'owner' ? 'staff' : 'owner'
}

// ---------------------------------------------------------------------------
// The account as the Owner reads it
// ---------------------------------------------------------------------------

export type AccountStatus = 'active' | 'invited' | 'deactivated'

/** One row of the read model — `list_accounts()`, mapped. Nothing more is exposed. */
export type Account = {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly role: AccountRole
  /** Non-null once deactivated. */
  readonly disabledAt: string | null
  /** The invitation instant, when the Auth identity was created by an invitation. */
  readonly invitedAt: string | null
  /** Non-null once the person has accepted the invitation (or was created confirmed). */
  readonly emailConfirmedAt: string | null
  readonly createdAt: string
  /** The version token every account form submits back (§6). */
  readonly updatedAt: string
}

/**
 * Deactivated wins over invited: a person invited and then deactivated before
 * accepting is deactivated, and the invitation link they hold leads nowhere.
 */
export function accountStatusOf(
  account: Pick<Account, 'disabledAt' | 'emailConfirmedAt'>,
): AccountStatus {
  if (account.disabledAt !== null) return 'deactivated'
  if (account.emailConfirmedAt === null) return 'invited'
  return 'active'
}

export type AccountStatusLabel = {
  readonly status: AccountStatus
  /** The word on the pill. */
  readonly pill: string
  /** The sentence under the name — the state in words, never colour alone (1aa). */
  readonly line: string
  readonly tone: 'active' | 'invited' | 'deactivated'
}

export function describeAccountStatus(
  account: Pick<Account, 'disabledAt' | 'emailConfirmedAt' | 'invitedAt'>,
): AccountStatusLabel {
  const status = accountStatusOf(account)

  switch (status) {
    case 'deactivated':
      return {
        status,
        pill: 'Deaktiveret',
        line: 'Kan ikke logge ind. Alt, personen har lavet, står stadig i loggen.',
        tone: 'deactivated',
      }
    case 'invited':
      return {
        status,
        pill: 'Inviteret',
        line: 'Har fået en e-mail med et link, men har ikke valgt adgangskode endnu.',
        tone: 'invited',
      }
    case 'active':
      return { status, pill: 'Aktiv', line: 'Kan logge ind og bruge administrationen.', tone: 'active' }
  }
}

/** Ejer / Medarbejder, said in words beside the name. */
export function describeRole(role: AccountRole): string {
  return ROLE_LABELS[role]
}

// ---------------------------------------------------------------------------
// Which controls a row offers, and why one is withheld
// ---------------------------------------------------------------------------

export type WithheldReason = 'last_owner'

export type AccountControls = {
  /** The row is the signed-in owner's own. */
  readonly self: boolean
  /** Offer "Gør til ejer" / "Gør til medarbejder". */
  readonly canChangeRole: boolean
  /** Offer "Deaktivér". */
  readonly canDeactivate: boolean
  /** Offer "Genaktivér". */
  readonly canReactivate: boolean
  /** Why the role and deactivation controls are absent, when they are. */
  readonly withheldReason: WithheldReason | null
}

/**
 * The controls for one row, from the list the server read.
 *
 * A deactivated account offers reactivation and nothing else — its role is kept
 * and changed, if at all, once it is active again. The only active owner offers
 * neither a role change nor deactivation, and the reason is named so the screen
 * can say it. Everything else offers both.
 */
export function accountControls(
  account: Pick<Account, 'userId' | 'role' | 'disabledAt'>,
  viewerUserId: string,
  activeOwnerCount: number,
): AccountControls {
  const self = account.userId === viewerUserId

  if (account.disabledAt !== null) {
    return { self, canChangeRole: false, canDeactivate: false, canReactivate: true, withheldReason: null }
  }

  const lastOwner = account.role === 'owner' && activeOwnerCount <= 1

  return {
    self,
    canChangeRole: !lastOwner,
    canDeactivate: !lastOwner,
    canReactivate: false,
    withheldReason: lastOwner ? 'last_owner' : null,
  }
}

export function activeOwnerCount(accounts: readonly Pick<Account, 'role' | 'disabledAt'>[]): number {
  return accounts.filter((account) => account.role === 'owner' && account.disabledAt === null).length
}

/** The sentence on the row of the only active owner. */
export const LAST_OWNER_NOTE =
  'Eneste aktive ejer — kan hverken gøres til medarbejder eller deaktiveres, før en anden er ejer.'

// ---------------------------------------------------------------------------
// The invitation submission
// ---------------------------------------------------------------------------

export type InviteFieldKey = 'name' | 'email' | 'role'

export type InviteFormValues = Readonly<Record<InviteFieldKey, string>>

export type InviteIssue = { readonly field: InviteFieldKey; readonly message: string }

export type InviteSubmission = {
  readonly name: string
  readonly email: string
  readonly role: AccountRole
}

/**
 * The e-mail as the Auth system will store it: trimmed and lower-cased, shaped like
 * an address. Supabase Auth remains the authority on validity and uniqueness — this
 * exists so a person is told in Danish what is wrong, before any Auth call is made.
 */
const inviteEmail = z
  .string({ error: 'E-mailadressen skal være tekst.' })
  .trim()
  .toLowerCase()
  .min(1, { error: 'Skriv en e-mailadresse.' })
  .max(254, { error: 'E-mailadressen er for lang.' })
  .pipe(z.email({ error: 'Det ligner ikke en e-mailadresse — den skal have et @ og et domæne.' }))

export const inviteSubmissionSchema = z.strictObject({
  name: requiredText(120, 'Navnet'),
  email: inviteEmail,
  role: z.enum(ACCOUNT_ROLES, { error: 'Vælg en rolle: ejer eller medarbejder.' }),
})

export type InviteParse =
  | { readonly ok: true; readonly values: InviteSubmission }
  | { readonly ok: false; readonly issues: readonly InviteIssue[] }

/** Parse what was typed; every refusal is bound to its field. */
export function toInviteSubmission(form: InviteFormValues): InviteParse {
  const parsed = inviteSubmissionSchema.safeParse(form)

  if (parsed.success) return { ok: true, values: parsed.data }

  const issues: InviteIssue[] = []
  const seen = new Set<InviteFieldKey>()

  for (const issue of parsed.error.issues) {
    const field = issue.path[0]
    if (field !== 'name' && field !== 'email' && field !== 'role') continue
    if (seen.has(field)) continue
    seen.add(field)
    issues.push({ field, message: issue.message })
  }

  return { ok: false, issues }
}

/** The role field's options, in the order the form draws them: Medarbejder first. */
export const ROLE_OPTIONS: readonly { readonly value: AccountRole; readonly label: string }[] = [
  { value: 'staff', label: ROLE_LABELS.staff },
  { value: 'owner', label: ROLE_LABELS.owner },
]

// ---------------------------------------------------------------------------
// The confirmations
// ---------------------------------------------------------------------------

export type AccountPrompt = {
  readonly question: string
  readonly consequence: string
  readonly confirmLabel: string
  /** Error tone on the committing control. */
  readonly destructive: boolean
}

function who(account: Pick<Account, 'name' | 'email'>, self: boolean): string {
  return self ? `${account.name} (dig selv, ${account.email})` : `${account.name} (${account.email})`
}

/** Staff -> Owner, or Owner -> Staff. Both confirm: both change what a person may do. */
export function describeRoleChange(
  account: Pick<Account, 'name' | 'email' | 'role'>,
  self: boolean,
): AccountPrompt {
  const target = otherRole(account.role)

  if (target === 'owner') {
    return {
      question: `Gør ${who(account, self)} til ejer?`,
      consequence:
        'En ejer kan alt det, en medarbejder kan, og derudover rette åbningstiderne, kontaktoplysningerne, forsiden og brugerne.',
      confirmLabel: 'Gør til ejer',
      destructive: false,
    }
  }

  return {
    question: `Gør ${who(account, self)} til medarbejder?`,
    consequence: self
      ? 'Du mister med det samme adgangen til åbningstiderne, kontaktoplysningerne, forsiden og brugerne — også i denne fane.'
      : 'Personen mister med det samme adgangen til åbningstiderne, kontaktoplysningerne, forsiden og brugerne — også i en fane, der allerede er åben.',
    confirmLabel: 'Gør til medarbejder',
    destructive: true,
  }
}

export function describeDeactivation(
  account: Pick<Account, 'name' | 'email'>,
  self: boolean,
): AccountPrompt {
  return {
    question: `Deaktivér ${who(account, self)}?`,
    consequence: self
      ? 'Du bliver logget ud med det samme og kan ikke logge ind igen, før en anden ejer genaktiverer dig. Kontoen slettes ikke — dit navn står stadig ved alt, du har lavet.'
      : 'Personen bliver logget ud med det samme og kan ikke logge ind igen, før kontoen genaktiveres. Kontoen slettes ikke — navnet står stadig ved alt, personen har lavet.',
    confirmLabel: 'Deaktivér',
    destructive: true,
  }
}

export function describeReactivation(account: Pick<Account, 'name' | 'email' | 'role'>): AccountPrompt {
  return {
    question: `Genaktivér ${who(account, false)}?`,
    consequence: `Personen kan logge ind igen med sin egen adgangskode og får sin rolle tilbage: ${ROLE_LABELS[account.role].toLowerCase()}.`,
    confirmLabel: 'Genaktivér',
    destructive: false,
  }
}

// ---------------------------------------------------------------------------
// Outcomes — the closed set the screen can report
// ---------------------------------------------------------------------------

/**
 * What an invitation attempt came to. `invited` means the Auth server created the
 * identity and accepted the delivery of the invitation e-mail; `reinvited` means an
 * account that was invited and has not yet accepted was sent a fresh e-mail (its
 * name and role kept); `attached` means a confirmed Auth identity already existed
 * for the address with no profile — it was given the role, and NO e-mail was sent.
 * `exists` is the duplicate: the address already has an account (active or
 * deactivated). `profile_failed` is the partial failure the module note in
 * `./admin.ts` describes: the e-mail went out, the role did not stick, and the same
 * form again repairs it.
 */
export type InviteStatus =
  | 'invited'
  | 'reinvited'
  | 'attached'
  | 'exists'
  | 'invalid_email'
  | 'auth_failed'
  | 'profile_failed'
  | 'forbidden'

/** What a role change, a deactivation or a reactivation came to. */
export type TransitionStatus =
  | 'updated'
  | 'unchanged'
  | 'stale'
  | 'not_found'
  | 'last_owner'
  | 'forbidden'
  | 'failed'

/**
 * The Auth-side step after a deactivation or reactivation: the ban that refuses the
 * person's tokens, or its lifting. `failed` is reported honestly — the database
 * refusal is already in force either way.
 */
export type AuthStepStatus = 'done' | 'failed' | 'skipped'

export function parseTransitionResult(value: unknown): { status: TransitionStatus; updatedAt: string | null } {
  if (typeof value !== 'object' || value === null) return { status: 'failed', updatedAt: null }
  const status = (value as { status?: unknown }).status
  const updatedAt = (value as { updated_at?: unknown }).updated_at

  switch (status) {
    case 'updated':
    case 'unchanged':
    case 'stale':
    case 'not_found':
    case 'last_owner':
      return { status, updatedAt: typeof updatedAt === 'string' ? updatedAt : null }
    default:
      return { status: 'failed', updatedAt: null }
  }
}

/** The status code the screen's address carries, per outcome. */
export const INVITE_OUTCOME_CODES: Readonly<Record<InviteStatus, string>> = {
  invited: 'inviteret',
  reinvited: 'inviteret_igen',
  attached: 'tilknyttet',
  exists: 'findes',
  invalid_email: 'ugyldig_email',
  auth_failed: 'login_fejl',
  profile_failed: 'profil_fejl',
  forbidden: 'afvist',
}

export const ROLE_OUTCOME_CODES: Readonly<Record<TransitionStatus, string>> = {
  updated: 'rolle_aendret',
  unchanged: 'uaendret',
  stale: 'konflikt',
  not_found: 'findes_ikke',
  last_owner: 'sidste_ejer',
  forbidden: 'afvist',
  failed: 'fejl',
}

export const DEACTIVATE_OUTCOME_CODES: Readonly<Record<TransitionStatus, string>> = {
  updated: 'deaktiveret',
  unchanged: 'uaendret',
  stale: 'konflikt',
  not_found: 'findes_ikke',
  last_owner: 'sidste_ejer',
  forbidden: 'afvist',
  failed: 'fejl',
}

export const REACTIVATE_OUTCOME_CODES: Readonly<Record<TransitionStatus, string>> = {
  updated: 'genaktiveret',
  unchanged: 'uaendret',
  stale: 'konflikt',
  not_found: 'findes_ikke',
  last_owner: 'sidste_ejer',
  forbidden: 'afvist',
  failed: 'fejl',
}

/** The deactivation whose Auth-side step failed: the account is refused, sessions may linger until expiry. */
export const DEACTIVATED_SESSIONS_OPEN_CODE = 'deaktiveret_login_aabent'
/** The reactivation whose Auth-side step failed: the account is active in the database but cannot log in yet. */
export const REACTIVATED_LOGIN_LOCKED_CODE = 'genaktiveret_login_laast'
