import {
  CONTACT_FIELD_KEYS,
  type ContactFieldKey,
  type ContactFormValues,
  type ContactIssue,
} from '@/lib/contact/editor'

/**
 * The Kontaktoplysninger form's vocabulary — design 1v; technical plan §8.
 *
 * One form, seven fields, and the version token. The field names are the columns'
 * own names in database casing — the same names `siteContactDraft` knows — so the
 * form, the strict schema and the SQL publish function speak one vocabulary and a
 * submission has no field for `venue_name`, `map_attribution`, `is_singleton`,
 * `draft` or anything a request must not say (the schema refuses them in any case).
 *
 * Offentliggør carries **nothing**: `./publish-actions.ts` re-reads what is pending.
 */

export const CONTACT_FORM = {
  version: 'version',
  ...(Object.fromEntries(CONTACT_FIELD_KEYS.map((key) => [key, key])) as Record<
    ContactFieldKey,
    ContactFieldKey
  >),
} as const

/** The query parameter a refused save carries its issues in: `<field>:<message>`. */
export const CONTACT_ERROR_FIELD = 'fejl'

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/** Exactly what the person typed, one string per field. */
export function readContactForm(source: FormData | URLSearchParams): ContactFormValues {
  const form: Record<string, string> = {}
  for (const key of CONTACT_FIELD_KEYS) form[key] = text(source, key)
  return form as ContactFormValues
}

/**
 * The query string a refused save comes back with: the issues, and what was typed.
 * Contact facts, not personal data of a visitor, and re-parsed on the way back in —
 * the URL is a convenience for the person, never a source of authority.
 */
export function encodeContactEcho(
  form: ContactFormValues,
  issues: readonly ContactIssue[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const issue of issues) {
    parameters.append(CONTACT_ERROR_FIELD, `${issue.field}:${issue.message}`)
  }
  for (const key of CONTACT_FIELD_KEYS) parameters.set(key, form[key])

  return parameters
}

/** The issues read back from the address — only for fields this screen has. */
export function decodeContactErrors(values: readonly string[]): ContactIssue[] {
  const issues: ContactIssue[] = []

  for (const value of values) {
    const separator = value.indexOf(':')
    if (separator <= 0) continue

    const field = value.slice(0, separator)
    const message = value.slice(separator + 1).trim()
    if (!(CONTACT_FIELD_KEYS as readonly string[]).includes(field) || message.length === 0) continue

    issues.push({ field: field as ContactFieldKey, message })
  }

  return issues
}
