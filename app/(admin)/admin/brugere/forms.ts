import { z } from 'zod'

import type { InviteFieldKey, InviteFormValues, InviteIssue } from '@/lib/accounts/model'

/**
 * The user administration's form vocabulary — technical plan §8; phase 11C.
 *
 * Two forms, five field names, and nothing a request must not say. The invitation
 * form carries a name, an e-mail and a role; every account form carries the target
 * id and the version token the server rendered. There is no field for a password,
 * a token, an actor, a metadata blob or a ban — the browser proposes *which* account
 * and *what* approved change, and the server decides everything else from its own
 * session and its own rows. `tests/unit/policy/accounts-boundary.test.ts` pins the
 * vocabulary to exactly these five.
 */

export const USERS_FORM = {
  name: 'navn',
  email: 'email',
  role: 'rolle',
  /** The target account's id — a filter value, never authority. */
  user: 'bruger',
  /** The `updated_at` the confirmation was rendered from — the concurrency token (§6). */
  version: 'version',
} as const

/** The query parameter a refused invitation carries its issues in: `<field>:<message>`. */
export const USERS_ERROR_FIELD = 'fejl'

/** The form field name per invitation field, and back. */
const INVITE_FIELD_NAMES: Readonly<Record<InviteFieldKey, string>> = {
  name: USERS_FORM.name,
  email: USERS_FORM.email,
  role: USERS_FORM.role,
}

const INVITE_FIELDS_BY_NAME = new Map<string, InviteFieldKey>(
  (Object.entries(INVITE_FIELD_NAMES) as [InviteFieldKey, string][]).map(([key, name]) => [name, key]),
)

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/** Exactly what the person typed, one string per field. */
export function readInviteForm(source: FormData | URLSearchParams): InviteFormValues {
  return {
    name: text(source, USERS_FORM.name),
    email: text(source, USERS_FORM.email),
    role: text(source, USERS_FORM.role),
  }
}

/**
 * The query string a refused invitation comes back with: the issues, and what was
 * typed. A name and an address the Owner is in the middle of entering — re-parsed
 * on the way back in; the URL is a convenience for the person, never authority.
 */
export function encodeInviteEcho(form: InviteFormValues, issues: readonly InviteIssue[]): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const issue of issues) {
    parameters.append(USERS_ERROR_FIELD, `${INVITE_FIELD_NAMES[issue.field]}:${issue.message}`)
  }
  parameters.set(USERS_FORM.name, form.name)
  parameters.set(USERS_FORM.email, form.email)
  parameters.set(USERS_FORM.role, form.role)

  return parameters
}

/** The issues read back from the address — only for fields this screen has. */
export function decodeInviteErrors(values: readonly string[]): InviteIssue[] {
  const issues: InviteIssue[] = []

  for (const value of values) {
    const separator = value.indexOf(':')
    if (separator <= 0) continue

    const field = INVITE_FIELDS_BY_NAME.get(value.slice(0, separator))
    const message = value.slice(separator + 1).trim()
    if (field === undefined || message.length === 0) continue

    issues.push({ field, message })
  }

  return issues
}

/**
 * The identifying half of every account form: which account, and which version of
 * it the confirmation was rendered from. Strict, so a submission cannot carry a
 * field this vocabulary does not name.
 */
export const accountTargetSchema = z.strictObject({
  userId: z.uuid({ error: 'Ugyldig reference.' }),
  expectedUpdatedAt: z.iso.datetime({ offset: true, error: 'Ugyldigt tidsstempel.' }),
})

export type AccountTarget = z.infer<typeof accountTargetSchema>

export function readAccountTarget(formData: FormData): AccountTarget | null {
  const parsed = accountTargetSchema.safeParse({
    userId: formData.get(USERS_FORM.user),
    expectedUpdatedAt: formData.get(USERS_FORM.version),
  })

  return parsed.success ? parsed.data : null
}
