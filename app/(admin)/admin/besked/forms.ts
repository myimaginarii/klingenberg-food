import { z } from 'zod'

import {
  ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  type AnnouncementValues,
} from '@/lib/announcements/lifecycle'
import {
  isAnnouncementExpiryChoice,
  isExpiryDate,
  isExpiryTime,
  type AnnouncementExpiryChoice,
  type AnnouncementExpiryFields,
  type AnnouncementExpirySuggestion,
  announcementExpiryFields,
  announcementExpiryInstant,
  instantForChoice,
} from '@/lib/announcements/expiry-editor'
import { parseExpiryInstant } from '@/lib/announcements/expiry'
import {
  isAllowedExternalUrl,
  isAnnouncementPageRoute,
  type AnnouncementPageRoute,
} from '@/lib/announcements/link'

/**
 * The three vocabularies this screen submits, in one place — design 1ad.
 *
 * Three, and deliberately disjoint, for the reason the menu, weekly and monthly screens
 * keep theirs apart: a form carrying one operation's names must not be able to reach
 * another operation's action. It matters here for the same reason it did on the weekly
 * and monthly screens — all three act on the *same singleton row*.
 *
 *   * {@link ANNOUNCEMENT_FORM} — 1ad's card. An ordinary draft change (§6).
 *   * {@link ANNOUNCEMENT_PUBLISH_FORM} — Offentliggør. It carries **no fields at all**:
 *     the action re-reads what is pending on the server and publishes that.
 *   * {@link ANNOUNCEMENT_VISIBILITY_FORM} — "Vis besked" off, "Fjern beskeden nu" and
 *     the Fortryd that follows either. **Immediate** (§6).
 *
 * A submission carrying `vis` cannot reach the content editor, and one carrying `besked`
 * cannot reach the visibility action — because no parser here reads a name it was not
 * given, and the visibility schema below is a `strictObject` that requires its own field.
 *
 * WHAT NONE OF THEM HAS A FIELD FOR
 *
 * The visibility form carries a state to move to and nothing else. There is no field for
 * `source` (phase 8 writes `'opening_hours'`; this screen never does), none for
 * `previous` or `replaced_at` (replacing an active announcement is phase 8), none for a
 * message, a link or an expiry on the immediate path, none for an entity name or a row id
 * (the singleton locates itself through the registry), and none for anything on another
 * table. The security tests forge each of those and assert the row is untouched; they
 * pass because these shapes do not have the fields, not because something strips them.
 *
 * The one thing every form carries is `version`: the `updated_at` the screen was
 * rendered from, which is the whole of optimistic concurrency (§6). A wrong one causes a
 * refusal, never a wrong write.
 *
 * THE EXPIRY IS TWO CONTROLS AND ONE ANSWER
 *
 * 1ad draws a date field, a time field and a row of suggestion chips. The chips are
 * radio buttons in this same form, so choosing one is not a separate operation, needs no
 * JavaScript, and cannot bypass anything: the server computes the chosen suggestion's
 * instant from the **published opening hours** and its own clock, and then applies the
 * same "must be in the future" rule it applies to a date somebody typed. A submission
 * that names a chip the screen did not offer is refused, not guessed at.
 */

// ---------------------------------------------------------------------------
// 1ad's card
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_FORM = {
  version: 'version',
  message: 'besked',
  /** `ingen`, one of the six routes, or `adresse`. Never a free path (§8). */
  linkChoice: 'link',
  linkUrl: 'adresse',
  linkLabel: 'linktekst',
  /** Which of 1ad's chips, or `custom` for the two fields as typed. */
  expiryChoice: 'udloeb',
  expiryDate: 'udloeb_dato',
  expiryTime: 'udloeb_tid',
} as const

// ---------------------------------------------------------------------------
// Offentliggør
// ---------------------------------------------------------------------------

/**
 * No fields.
 *
 * The publish action takes nothing from the browser at all: it reads `pending_changes`
 * through the caller's own JWT, narrows it to this screen's one entity, and publishes
 * what it found (§8, and the same shape the Månedens burger screen uses). Declared as an
 * empty object rather than left out, so the absence is visible in the file that lists
 * what this screen submits.
 */
export const ANNOUNCEMENT_PUBLISH_FORM = {} as const

// ---------------------------------------------------------------------------
// "Vis besked" / "Fjern beskeden nu" — the immediate path (§6)
// ---------------------------------------------------------------------------

/**
 * Two fields: which state to move to, and the version token.
 *
 * 1ad draws two controls for this one operation — the switch at the top of the screen
 * and the button in the footer — and they submit the *same* names to the *same* action,
 * because they are the same decision. Nothing about which control was pressed is sent,
 * because nothing about it could change the answer.
 *
 * Fortryd is a third form with the same two names and `vis` inverted, so the undo is a
 * second write down the identical code path rather than an endpoint of its own (§6).
 */
export const ANNOUNCEMENT_VISIBILITY_FORM = {
  version: 'version',
  /** '1' = show the published announcement, '0' = take it down now. */
  visible: 'vis',
} as const

/** What the immediate path was asked to do, or `null` for anything malformed. */
export type AnnouncementVisibilityRequest = {
  readonly visible: boolean
  readonly expectedUpdatedAt: string
}

/**
 * `strictObject`, so a submission that carries a message, a link or an expiry alongside
 * its intent is refused rather than partly honoured. A `vis` that is neither `'0'` nor
 * `'1'`, or a version that is not a timestamp, is `null` — one refusal message, and never
 * a guess at what was meant.
 */
const visibilitySchema = z.strictObject({
  visible: z.enum(['0', '1']),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export function readAnnouncementVisibilityForm(
  formData: FormData,
): AnnouncementVisibilityRequest | null {
  const parsed = visibilitySchema.safeParse({
    visible: text(formData, ANNOUNCEMENT_VISIBILITY_FORM.visible),
    expectedUpdatedAt: text(formData, ANNOUNCEMENT_VISIBILITY_FORM.version),
  })

  if (!parsed.success) return null

  return {
    visible: parsed.data.visible === '1',
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
  }
}

/** The value the link select carries when there is no link. */
export const NO_LINK_CHOICE = 'ingen'

/** The value the link select carries for an external address. */
export const EXTERNAL_LINK_CHOICE = 'adresse'

// ---------------------------------------------------------------------------
// Errors and echoes
// ---------------------------------------------------------------------------

/** The query parameter a refused save carries its codes in. */
export const ANNOUNCEMENT_ERROR_FIELD = 'fejl'

export type AnnouncementErrorField = 'besked' | 'link' | 'adresse' | 'linktekst' | 'udloeb'

export type AnnouncementErrorCode =
  | 'besked:tom'
  | 'besked:for_lang'
  | 'link:ukendt'
  | 'adresse:mangler'
  | 'adresse:ugyldig'
  | 'linktekst:mangler'
  | 'linktekst:for_lang'
  | 'udloeb:mangler'
  | 'udloeb:ugyldig'
  | 'udloeb:fortid'

/** The sentence each refusal shows, beneath its own field. */
export const ANNOUNCEMENT_ERROR_MESSAGES: Record<AnnouncementErrorCode, string> = {
  'besked:tom': 'Skriv beskeden — en tom besked kan ikke gemmes.',
  'besked:for_lang': `Beskeden må højst være ${ANNOUNCEMENT_MESSAGE_MAX_LENGTH} tegn.`,
  'link:ukendt': 'Vælg en af siderne på listen, eller vælg “Anden adresse”.',
  'adresse:mangler': 'Skriv adressen, eller vælg en side på listen i stedet.',
  // §8: only https is accepted. The sentence names the rule rather than the failure, so
  // a person pasting an http:// address is told what to paste instead.
  'adresse:ugyldig': 'Adressen skal begynde med https:// og pege på et rigtigt websted.',
  'linktekst:mangler': 'Skriv, hvad der skal stå på linket.',
  'linktekst:for_lang': 'Teksten på linket må højst være 60 tegn.',
  'udloeb:mangler': 'Vælg både en dato og et klokkeslæt.',
  'udloeb:ugyldig': 'Datoen og klokkeslættet skal være rigtige.',
  // 1ac's own rule and 1ad's own sentence, word for word.
  'udloeb:fortid':
    'Vælg et tidspunkt ude i fremtiden — beskeden kan ikke offentliggøres uden.',
}

const ERROR_CODES = Object.keys(ANNOUNCEMENT_ERROR_MESSAGES) as AnnouncementErrorCode[]

/** The field an error belongs to, so the form can bind it with `aria-describedby`. */
export function announcementErrorField(code: AnnouncementErrorCode): AnnouncementErrorField {
  return code.split(':')[0] as AnnouncementErrorField
}

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeAnnouncementErrors(
  values: readonly string[],
): AnnouncementErrorCode[] {
  return values.filter((value): value is AnnouncementErrorCode =>
    (ERROR_CODES as string[]).includes(value),
  )
}

// ---------------------------------------------------------------------------
// Reading the form
// ---------------------------------------------------------------------------

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/** Exactly what the person typed and chose, before any rule has been applied to it. */
export type AnnouncementFormValues = {
  readonly message: string
  /** `ingen`, a route, or `adresse`. Whatever arrived — validated later. */
  readonly linkChoice: string
  readonly linkUrl: string
  readonly linkLabel: string
  readonly expiryChoice: AnnouncementExpiryChoice
  readonly expiryDate: string
  readonly expiryTime: string
}

export function readAnnouncementForm(
  source: FormData | URLSearchParams,
): AnnouncementFormValues {
  const choice = text(source, ANNOUNCEMENT_FORM.expiryChoice)

  return {
    message: text(source, ANNOUNCEMENT_FORM.message),
    linkChoice: text(source, ANNOUNCEMENT_FORM.linkChoice) || NO_LINK_CHOICE,
    linkUrl: text(source, ANNOUNCEMENT_FORM.linkUrl),
    linkLabel: text(source, ANNOUNCEMENT_FORM.linkLabel),
    // An absent or unrecognised radio is "the fields as typed", which is the only
    // reading that cannot silently substitute a value nobody chose.
    expiryChoice: isAnnouncementExpiryChoice(choice) ? choice : 'custom',
    expiryDate: text(source, ANNOUNCEMENT_FORM.expiryDate),
    expiryTime: text(source, ANNOUNCEMENT_FORM.expiryTime),
  }
}

// ---------------------------------------------------------------------------
// Turning what was submitted into values
// ---------------------------------------------------------------------------

/** Blank is absent — the rule every schema in this repository follows. */
function optional(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export type AnnouncementFormResult =
  | { readonly ok: true; readonly values: AnnouncementValues }
  | { readonly ok: false; readonly errors: readonly AnnouncementErrorCode[] }

/** The link half of a submission, or the codes that refuse it. */
function readLink(
  form: AnnouncementFormValues,
): { ok: true; values: Pick<AnnouncementValues, 'link_type' | 'link_page' | 'link_url' | 'link_label'> } | {
  ok: false
  errors: AnnouncementErrorCode[]
} {
  const label = optional(form.linkLabel)
  const errors: AnnouncementErrorCode[] = []

  if (label !== null && label.length > 60) errors.push('linktekst:for_lang')

  if (form.linkChoice === NO_LINK_CHOICE) {
    // No link at all. The label goes with it: keeping a label for a link that no longer
    // exists would leave a value the bar cannot use and the next editor cannot see.
    return errors.length > 0
      ? { ok: false, errors }
      : {
          ok: true,
          values: { link_type: 'none', link_page: null, link_url: null, link_label: null },
        }
  }

  if (form.linkChoice === EXTERNAL_LINK_CHOICE) {
    const url = optional(form.linkUrl)

    if (url === null) errors.push('adresse:mangler')
    else if (!isAllowedExternalUrl(url)) errors.push('adresse:ugyldig')

    // An external address has no name of its own — unlike one of our six pages, whose
    // label falls back to the words the navigation already uses (`resolveAnnouncementLink`).
    // So this is the one link that cannot be rendered without a label.
    if (label === null) errors.push('linktekst:mangler')

    if (errors.length > 0) return { ok: false, errors }

    return {
      ok: true,
      values: { link_type: 'url', link_page: null, link_url: url, link_label: label },
    }
  }

  // The remaining case is one of our own six routes, chosen from the select. A value
  // that is not one of them is refused rather than normalised: §8's open-redirect rule
  // is "an enum of our own routes", and an enum with a fallback is not an enum.
  if (!isAnnouncementPageRoute(form.linkChoice)) {
    errors.push('link:ukendt')
    return { ok: false, errors }
  }

  if (errors.length > 0) return { ok: false, errors }

  const page: AnnouncementPageRoute = form.linkChoice

  return {
    ok: true,
    values: { link_type: 'page', link_page: page, link_url: null, link_label: label },
  }
}

/** The expiry half of a submission, or the codes that refuse it. */
function readExpiry(
  form: AnnouncementFormValues,
  suggestions: readonly AnnouncementExpirySuggestion[],
  now: Date,
): { ok: true; expiresAt: string } | { ok: false; errors: AnnouncementErrorCode[] } {
  if (form.expiryChoice !== 'custom') {
    const instant = instantForChoice(form.expiryChoice, suggestions)

    // The chip was not on offer — the opening hours moved, or the request was made up.
    // Either way the server has no value to substitute, and inventing one would be the
    // suggestion deciding the expiry rather than the person.
    if (instant === null) return { ok: false, errors: ['udloeb:mangler'] }
    if (instant.getTime() <= now.getTime()) return { ok: false, errors: ['udloeb:fortid'] }

    return { ok: true, expiresAt: instant.toISOString() }
  }

  const date = optional(form.expiryDate)
  const time = optional(form.expiryTime)

  if (date === null || time === null) return { ok: false, errors: ['udloeb:mangler'] }
  if (!isExpiryDate(date) || !isExpiryTime(time)) {
    return { ok: false, errors: ['udloeb:ugyldig'] }
  }

  const instant = announcementExpiryInstant(date, time)
  if (Number.isNaN(instant.getTime())) return { ok: false, errors: ['udloeb:ugyldig'] }

  // 1ac: "Udløb er påkrævet" — and 1ad: "Vælg et tidspunkt ude i fremtiden". The rule is
  // applied here so a person is told, and again by `publish_announcement()` so a request
  // that never rendered a form meets the same answer.
  if (instant.getTime() <= now.getTime()) return { ok: false, errors: ['udloeb:fortid'] }

  return { ok: true, expiresAt: instant.toISOString() }
}

/**
 * Read 1ad's card.
 *
 * Every part is checked rather than only the first that fails, so somebody correcting a
 * form sees everything wrong with it at once.
 *
 * **Everything here is required**, which is the opposite of the Månedens burger editor
 * and for a reason 1ac states: this bar is an operational message with a mandatory
 * expiry, not a content slot that can sit empty. A blank message is refused, and so is a
 * missing or already-past expiry. There is no "save it half-finished" state, because the
 * only thing a half-finished announcement can do is fail at publish.
 */
export function toAnnouncementSubmission(
  form: AnnouncementFormValues,
  suggestions: readonly AnnouncementExpirySuggestion[],
  now: Date,
): AnnouncementFormResult {
  const errors: AnnouncementErrorCode[] = []

  const message = optional(form.message)
  if (message === null) errors.push('besked:tom')
  else if (message.length > ANNOUNCEMENT_MESSAGE_MAX_LENGTH) errors.push('besked:for_lang')

  const link = readLink(form)
  if (!link.ok) errors.push(...link.errors)

  const expiry = readExpiry(form, suggestions, now)
  if (!expiry.ok) errors.push(...expiry.errors)

  if (!link.ok || !expiry.ok || message === null || errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    values: { message, ...link.values, expires_at: expiry.expiresAt },
  }
}

// ---------------------------------------------------------------------------
// Round-tripping a refusal
// ---------------------------------------------------------------------------

/**
 * The query string a refused save comes back with: the codes, and what was submitted.
 *
 * Operational content, not personal data, and re-parsed by `readAnnouncementForm` on the
 * way back in — so the URL is a convenience for the person, never a source of authority.
 * React escapes the values when it renders them into the fields.
 */
export function encodeAnnouncementEcho(
  form: AnnouncementFormValues,
  errors: readonly AnnouncementErrorCode[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const code of errors) parameters.append(ANNOUNCEMENT_ERROR_FIELD, code)

  parameters.set(ANNOUNCEMENT_FORM.message, form.message)
  parameters.set(ANNOUNCEMENT_FORM.linkChoice, form.linkChoice)
  parameters.set(ANNOUNCEMENT_FORM.linkUrl, form.linkUrl)
  parameters.set(ANNOUNCEMENT_FORM.linkLabel, form.linkLabel)
  parameters.set(ANNOUNCEMENT_FORM.expiryChoice, form.expiryChoice)
  parameters.set(ANNOUNCEMENT_FORM.expiryDate, form.expiryDate)
  parameters.set(ANNOUNCEMENT_FORM.expiryTime, form.expiryTime)

  return parameters
}

// ---------------------------------------------------------------------------
// Stored values as the form shows them
// ---------------------------------------------------------------------------

/**
 * The row as 1ad's card displays it.
 *
 * The expiry instant is read back as the two civil fields it was typed as, through the
 * same Copenhagen conversion that produced it — so an expiry saved as "søndag 20:00"
 * reads back as "søndag 20:00" on both sides of a daylight-saving change, rather than as
 * the hour the server's own timezone would print.
 */
export function announcementFormValues(
  values: AnnouncementValues,
  expiryChoice: AnnouncementExpiryChoice,
): AnnouncementFormValues {
  const instant = parseExpiryInstant(values.expires_at)
  const fields: AnnouncementExpiryFields | null =
    instant === null ? null : announcementExpiryFields(instant)

  return {
    message: values.message ?? '',
    linkChoice:
      values.link_type === 'page' && values.link_page !== null
        ? values.link_page
        : values.link_type === 'url'
          ? EXTERNAL_LINK_CHOICE
          : NO_LINK_CHOICE,
    linkUrl: values.link_url ?? '',
    linkLabel: values.link_label ?? '',
    expiryChoice,
    expiryDate: fields?.date ?? '',
    expiryTime: fields?.time ?? '',
  }
}
