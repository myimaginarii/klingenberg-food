import { siteContactDraft } from '@/lib/schemas/contact'

/**
 * The Kontaktoplysninger editor's rules — design 1v; technical plan §4, §5, §6;
 * phase 11B.
 *
 * Pure. What the screen shows, what a submission means, what a save writes into the
 * draft, and the sentences the screen says — with no database, no React and no
 * knowledge of a browser.
 *
 * THE FIELDS ARE 1v's, AND ONLY 1v's. The frame draws the primary number, the extra
 * number, the address, the e-mail and Facebook, with a helper sentence under each;
 * `site_contact` also carries `venue_name` and `map_attribution` (§4), which no
 * approved frame draws an editor for — the venue name is a confirmed business fact
 * the seed carries, and the map credit is a launch-time configuration for the licensed
 * asset (§7g). Both stay out of the form and out of the vocabulary, so a submission has
 * no field to reach them through; they are recorded in technical plan §0aa.
 *
 * VALIDATION IS THE SCHEMA'S. Each field is parsed with its own primitive from
 * `siteContactDraft` — the phone grammar, the https-only URL, the e-mail — so the
 * sentence bound to a field is the schema's own Danish, and `saveEntityDraft`'s strict
 * re-parse is the same rule stated a second time rather than a different one.
 *
 * THE LIFECYCLE IS THE ROW'S OWN. `site_contact` has carried a `draft` column, an
 * Owner-only RLS policy and `publish_site_contact()` since phase 1 (§4, §6), and 1v
 * draws Offentliggør "nedtonet, indtil der faktisk er noget at offentliggøre" — the
 * shape of a draft waiting, not of an immediate save. So Gem writes the draft, the
 * band offers Offentliggør while something waits, and the hjemmeside changes on the
 * first request after that, through the `contact` tag. No second model is invented.
 */

export const CONTACT_FIELD_KEYS = [
  'primary_phone',
  'secondary_phone',
  'address_line1',
  'postal_code',
  'city',
  'email',
  'facebook_url',
] as const

export type ContactFieldKey = (typeof CONTACT_FIELD_KEYS)[number]

/** The seven editable facts, normalised: every key present, blank is `null`. */
export type ContactValues = Readonly<Record<ContactFieldKey, string | null>>

/** 1v's labels and helper sentences, per field, in the frame's order. */
export const CONTACT_FIELDS: readonly {
  readonly key: ContactFieldKey
  readonly label: string
  readonly hint: string
  readonly autoComplete: string
}[] = [
  {
    key: 'primary_phone',
    label: 'Primært telefonnummer',
    hint: 'Bruges af alle Ring-knapper og står størst på Find os.',
    autoComplete: 'tel',
  },
  {
    key: 'secondary_phone',
    label: 'Ekstra telefonnummer (valgfrit)',
    hint: 'Vises kun på Find os og i footeren — aldrig som Ring-knap. Står feltet tomt, vises det slet ikke.',
    autoComplete: 'tel',
  },
  {
    key: 'address_line1',
    label: 'Adresse',
    hint: 'Vejnavn og nummer. Kort og Vis vej opdateres automatisk.',
    autoComplete: 'street-address',
  },
  {
    key: 'postal_code',
    label: 'Postnummer',
    hint: '',
    autoComplete: 'postal-code',
  },
  {
    key: 'city',
    label: 'By',
    hint: '',
    autoComplete: 'address-level2',
  },
  {
    key: 'email',
    label: 'E-mail (valgfrit)',
    hint: 'Står feltet tomt, viser hjemmesiden ingen e-mailadresse.',
    autoComplete: 'email',
  },
  {
    key: 'facebook_url',
    label: 'Facebook',
    hint: 'Hele adressen, fx https://www.facebook.com/…. Står feltet tomt, forsvinder hele Følg os-afsnittet fra hjemmesiden — ingen døde ikoner, ingen tom plads.',
    autoComplete: 'url',
  },
]

/** 1v's one negative statement, said where a person would look for the field. */
export const CONTACT_NO_INSTAGRAM_NOTE = 'Klingenberg Food har ikke Instagram — feltet findes ikke.'

/** 1v's explanation of the greyed Offentliggør. */
export const CONTACT_NOTHING_PENDING_NOTE =
  'Offentliggør er nedtonet, indtil der faktisk er noget at offentliggøre.'

/** The one-line form every helper and every guest sees: "+45 63 90 83 00". */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** The row — live or merged — reduced to the seven editable facts. */
export function contactValuesOf(row: Record<string, unknown>): ContactValues {
  return {
    primary_phone: text(row.primary_phone),
    secondary_phone: text(row.secondary_phone),
    address_line1: text(row.address_line1),
    postal_code: text(row.postal_code),
    city: text(row.city),
    email: text(row.email),
    facebook_url: text(row.facebook_url),
  }
}

// ---------------------------------------------------------------------------
// What was typed, checked field by field
// ---------------------------------------------------------------------------

/** What the person typed, one string per field, before any rule has been applied. */
export type ContactFormValues = Readonly<Record<ContactFieldKey, string>>

export type ContactIssue = { readonly field: ContactFieldKey; readonly message: string }

export type ContactSubmission =
  | { readonly ok: true; readonly values: ContactValues }
  | { readonly ok: false; readonly issues: readonly ContactIssue[] }

/**
 * Every field through its own schema primitive, all of them rather than the first
 * that fails, so a person sees everything wrong at once with the schema's own
 * sentence beneath the field it belongs to.
 */
export function toContactSubmission(form: ContactFormValues): ContactSubmission {
  const issues: ContactIssue[] = []
  const values: Record<string, string | null> = {}

  for (const key of CONTACT_FIELD_KEYS) {
    // Blank is absent — the rule every schema here follows. The text primitives do
    // that themselves; the e-mail and URL primitives accept a value or `null`, so the
    // blank is turned into `null` before the schema sees it, exactly as the phase-4
    // editor did.
    const typed = form[key].trim()
    const parsed = siteContactDraft.input.shape[key].safeParse(typed.length === 0 ? null : typed)

    if (!parsed.success) {
      issues.push({ field: key, message: parsed.error.issues[0]?.message ?? 'Ret feltet.' })
      continue
    }

    values[key] = parsed.data ?? null
  }

  if (issues.length > 0) return { ok: false, issues }

  return { ok: true, values: values as ContactValues }
}

/** The stored values as the form's fields show them. */
export function contactFormValues(values: ContactValues): ContactFormValues {
  const form: Record<string, string> = {}
  for (const key of CONTACT_FIELD_KEYS) form[key] = values[key] ?? ''
  return form as ContactFormValues
}

// ---------------------------------------------------------------------------
// The delta — what a save writes, and what it takes back out (§4)
// ---------------------------------------------------------------------------

export type ContactDraftWrite = {
  readonly values: Partial<ContactValues>
  readonly clear: readonly ContactFieldKey[]
}

/**
 * Measured against the **live** row, never against what the form was rendered with,
 * so a field edited back to what the hjemmeside already says stops being a pending
 * change — and a draft holds only the changed fields (§4).
 */
export function contactDraftWrite(submitted: ContactValues, live: ContactValues): ContactDraftWrite {
  const values: Partial<Record<ContactFieldKey, string | null>> = {}
  const clear: ContactFieldKey[] = []

  for (const key of CONTACT_FIELD_KEYS) {
    if (submitted[key] === live[key]) clear.push(key)
    else values[key] = submitted[key]
  }

  return { values, clear }
}

// ---------------------------------------------------------------------------
// The sentences the screen says
// ---------------------------------------------------------------------------

const FIELD_LABEL: Record<ContactFieldKey, string> = Object.fromEntries(
  CONTACT_FIELDS.map((field) => [field.key, field.label]),
) as Record<ContactFieldKey, string>

/** The label a pending field is named by in the band — without 1v's "(valgfrit)". */
function pendingName(key: ContactFieldKey): string {
  return FIELD_LABEL[key].replace(/\s*\(valgfrit\)$/, '')
}

/**
 * The pending band's sentence: which fields are waiting, in 1v's order. Derived from
 * the stored draft's own keys, so the band cannot claim a change the database does
 * not hold.
 */
export function describeContactPending(changedFields: readonly string[]): string | null {
  const changed = new Set(changedFields)
  const named = CONTACT_FIELD_KEYS.filter((key) => changed.has(key)).map(pendingName)

  if (named.length === 0) return null
  if (named.length === 1) return `${named[0]} afventer offentliggørelse.`

  const last = named[named.length - 1]
  return `${named.slice(0, -1).join(', ')} og ${last} afventer offentliggørelse.`
}

/** Which fields carry the Kladde mark, from the same keys. */
export function pendingContactFields(changedFields: readonly string[]): ReadonlySet<ContactFieldKey> {
  const changed = new Set(changedFields)
  return new Set(CONTACT_FIELD_KEYS.filter((key) => changed.has(key)))
}

/** 1aa's sentence beside a changed field, restated for this screen. */
export const CONTACT_PENDING_FIELD_NOTE = 'Ændret — vises først på hjemmesiden, når du offentliggør.'

/** What Gem does, said beside the button. */
export const CONTACT_SAVE_NOTE =
  'Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør — så står de nye oplysninger på alle sider med det samme.'
