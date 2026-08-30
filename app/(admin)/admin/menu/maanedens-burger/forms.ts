import { z } from 'zod'

import type { MonthlyBurgerValues } from '@/lib/menu/monthly'
import { isOrderedWindow } from '@/lib/menu/monthly'
import { formatOreForInput, parseKronerToOre } from '@/lib/menu/pricing'
import { isIsoDate, type IsoDate } from '@/lib/time/calendar'

/**
 * The four vocabularies this screen submits, in one place — design 1ah.
 *
 * Four, and deliberately **disjoint**. The menu administration keeps its availability,
 * deletion, reorder and Tapas field names apart so that a form carrying one operation's
 * names cannot reach another operation's action; the same rule applies here, and it
 * matters for the same reason it did on the weekly screen — all four act on the *same
 * singleton row*:
 *
 *   * {@link MONTHLY_FORM} — 1ah's card. An ordinary draft change (§6).
 *   * {@link MONTHLY_AVAILABILITY_FORM} — the Udsolgt switch. **Immediate** (§6).
 *   * {@link MONTHLY_PUBLISH_FORM} — Offentliggør, and the one confirmation §7d asks
 *     for. It carries no content at all.
 *   * {@link MONTHLY_CLEAR_FORM} — "Ryd felterne". A draft change (§6) whose whole
 *     submission is one version token.
 *
 * A submission carrying `udsolgt` cannot reach the content editor, one carrying `navn`
 * cannot reach the availability action, and neither can reach the publish — because no
 * parser here reads a name it was not given, and every schema below is a
 * `strictObject`.
 *
 * WHAT NONE OF THEM HAS A FIELD FOR
 *
 * There is no field for a sold-out **date** (§7b: the server decides "today, in
 * Copenhagen"), no field for `image_id` (phase 10 owns the image library), no field for
 * an entity name or a row id (the singleton locates itself through the registry), and no
 * field for anything on another table. The negative tests forge each of those and assert
 * the row is untouched; they pass because these shapes do not have the fields, not
 * because something strips them.
 *
 * The one thing every form carries is `version`: the `updated_at` the screen was
 * rendered from, which is the whole of optimistic concurrency (§6). A wrong one causes a
 * refusal, never a wrong write.
 */

// ---------------------------------------------------------------------------
// 1ah's card
// ---------------------------------------------------------------------------

export const MONTHLY_FORM = {
  version: 'version',
  name: 'navn',
  description: 'beskrivelse',
  price: 'pris',
  startsOn: 'start',
  endsOn: 'slut',
  /** '1' when the dedicated Forside section may appear. Absent is off, as a checkbox is. */
  showOnHomepage: 'forside',
} as const

// ---------------------------------------------------------------------------
// The Udsolgt switch — the immediate path (§6)
// ---------------------------------------------------------------------------

export const MONTHLY_AVAILABILITY_FORM = {
  version: 'version',
  /** '1' = mark Udsolgt i dag, '0' = return to Tilgængelig. */
  soldOut: 'udsolgt',
} as const

// ---------------------------------------------------------------------------
// Offentliggør, and §7d's expired-window confirmation
// ---------------------------------------------------------------------------

export const MONTHLY_PUBLISH_FORM = {
  /** '1' only when a person has answered the expired-period question. */
  confirm: 'bekraeft',
} as const

// ---------------------------------------------------------------------------
// "Ryd felterne" — 1ah's footer control (§6: an ordinary draft change)
// ---------------------------------------------------------------------------

/**
 * One field, and it is the version token.
 *
 * The operation carries no content at all: *which* fields it clears is
 * `clear-actions.ts`'s to decide, from a list written out in the server's own source. A
 * form that named them would be a form that could be edited to name others.
 */
export const MONTHLY_CLEAR_FORM = {
  version: 'version',
} as const

// ---------------------------------------------------------------------------
// Errors and echoes
// ---------------------------------------------------------------------------

/** The query parameter a refused save carries its codes in. */
export const MONTHLY_ERROR_FIELD = 'fejl'

export type MonthlyErrorField = 'navn' | 'beskrivelse' | 'pris' | 'start' | 'slut'

export type MonthlyErrorCode =
  | 'navn:too_long'
  | 'beskrivelse:too_long'
  | 'pris:not_a_number'
  | 'pris:too_many_decimals'
  | 'pris:out_of_range'
  | 'start:invalid'
  | 'slut:invalid'
  | 'slut:before_start'

/** The sentence each refusal shows, beneath its own field. */
export const MONTHLY_ERROR_MESSAGES: Record<MonthlyErrorCode, string> = {
  'navn:too_long': 'Navnet må højst være 200 tegn.',
  'beskrivelse:too_long': 'Beskrivelsen må højst være 600 tegn.',
  'pris:not_a_number': 'Prisen skal være et tal, fx 89 eller 89,50.',
  'pris:too_many_decimals': 'Prisen kan højst have to decimaler, fx 89,50.',
  'pris:out_of_range': 'Prisen skal være mellem 0 og 10.000 kr.',
  'start:invalid': 'Startdatoen skal være en rigtig dato.',
  'slut:invalid': 'Slutdatoen skal være en rigtig dato.',
  // The one cross-field rule, and the same one the column CHECK states (§4). It is
  // reported on the end date because that is the field a person moves to fix it.
  'slut:before_start': 'Slutdatoen skal være samme dag som eller efter startdatoen.',
}

const ERROR_CODES = Object.keys(MONTHLY_ERROR_MESSAGES) as MonthlyErrorCode[]

/** The field an error belongs to, so the form can bind it with `aria-describedby`. */
export function monthlyErrorField(code: MonthlyErrorCode): MonthlyErrorField {
  return code.split(':')[0] as MonthlyErrorField
}

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeMonthlyErrors(values: readonly string[]): MonthlyErrorCode[] {
  return values.filter((value): value is MonthlyErrorCode =>
    (ERROR_CODES as string[]).includes(value),
  )
}

// ---------------------------------------------------------------------------
// Reading the content form
// ---------------------------------------------------------------------------

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/** Exactly what the person typed, before any rule has been applied to it. */
export type MonthlyFormValues = {
  readonly name: string
  readonly description: string
  readonly price: string
  readonly startsOn: string
  readonly endsOn: string
  readonly showOnHomepage: boolean
}

export function readMonthlyForm(source: FormData | URLSearchParams): MonthlyFormValues {
  return {
    name: text(source, MONTHLY_FORM.name),
    description: text(source, MONTHLY_FORM.description),
    price: text(source, MONTHLY_FORM.price),
    startsOn: text(source, MONTHLY_FORM.startsOn),
    endsOn: text(source, MONTHLY_FORM.endsOn),
    showOnHomepage: text(source, MONTHLY_FORM.showOnHomepage) === '1',
  }
}

// ---------------------------------------------------------------------------
// Turning what was typed into values
// ---------------------------------------------------------------------------

/** Blank is absent — the rule every schema in this repository follows. */
function optional(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** The editable fields 1ah owns, ready for the delta. `image_id` is not among them. */
export type MonthlySubmission = Omit<MonthlyBurgerValues, 'image_id'>

export type MonthlyFormResult =
  | { readonly ok: true; readonly values: MonthlySubmission }
  | { readonly ok: false; readonly errors: readonly MonthlyErrorCode[] }

/**
 * Read 1ah's card.
 *
 * Every field is checked rather than only the first that fails, so somebody correcting a
 * form sees everything wrong with it at once.
 *
 * **Nothing here is required.** 1ah draws a card that is normally empty — the seeded
 * state, and the one the restaurant is in until it writes its first burger — and every
 * column behind it is nullable (§4). An editor that demanded a name would make "clear
 * the burger at the end of the month" impossible, which is the ordinary way this
 * singleton is reused. What an empty name means is said elsewhere and honestly: the
 * public menu renders "ikke oplyst endnu", the Forside renders nothing at all, and the
 * computed state says so before anybody publishes (`lib/menu/monthly.ts`).
 *
 * **Both dates are optional and independent**, and there is no calendar-month rule. §7d
 * describes a window, not a month; 1ah's own defaults happen to be the first and last of
 * a month, and nothing in the plan turns that into a constraint. A burger that runs from
 * the 15th to the 14th is a burger that runs from the 15th to the 14th.
 *
 * The one cross-field rule is `starts_on <= ends_on`, which is the same rule the column
 * CHECK states — checked here so a person is told, rather than meeting a constraint
 * violation at publish (§4, `monthly_burger_window_check`).
 */
export function toMonthlySubmission(form: MonthlyFormValues): MonthlyFormResult {
  const errors: MonthlyErrorCode[] = []

  const name = optional(form.name)
  if (name !== null && name.length > 200) errors.push('navn:too_long')

  const description = optional(form.description)
  if (description !== null && description.length > 600) errors.push('beskrivelse:too_long')

  const price = parseKronerToOre(form.price)
  if (!price.ok) errors.push(`pris:${price.error}` as MonthlyErrorCode)

  const startsRaw = optional(form.startsOn)
  const endsRaw = optional(form.endsOn)

  const startsOn: IsoDate | null = startsRaw !== null && isIsoDate(startsRaw) ? startsRaw : null
  const endsOn: IsoDate | null = endsRaw !== null && isIsoDate(endsRaw) ? endsRaw : null

  if (startsRaw !== null && startsOn === null) errors.push('start:invalid')
  if (endsRaw !== null && endsOn === null) errors.push('slut:invalid')

  // Only when both parsed: a message about an ordering that involves a date nobody could
  // read would be a second message about the same mistake.
  if (
    startsOn !== null &&
    endsOn !== null &&
    !isOrderedWindow(startsOn, endsOn)
  ) {
    errors.push('slut:before_start')
  }

  if (errors.length > 0 || !price.ok) return { ok: false, errors }

  return {
    ok: true,
    values: {
      name,
      description,
      price_ore: price.priceOre,
      starts_on: startsOn,
      ends_on: endsOn,
      show_on_homepage: form.showOnHomepage,
    },
  }
}

// ---------------------------------------------------------------------------
// Round-tripping a refusal
// ---------------------------------------------------------------------------

/**
 * The query string a refused save comes back with: the codes, and what was typed.
 *
 * Menu content, not personal data, and re-parsed by `readMonthlyForm` on the way back
 * in — so the URL is a convenience for the person, never a source of authority. React
 * escapes the values when it renders them into the fields.
 */
export function encodeMonthlyEcho(
  form: MonthlyFormValues,
  errors: readonly MonthlyErrorCode[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const code of errors) parameters.append(MONTHLY_ERROR_FIELD, code)

  parameters.set(MONTHLY_FORM.name, form.name)
  parameters.set(MONTHLY_FORM.description, form.description)
  parameters.set(MONTHLY_FORM.price, form.price)
  parameters.set(MONTHLY_FORM.startsOn, form.startsOn)
  parameters.set(MONTHLY_FORM.endsOn, form.endsOn)
  if (form.showOnHomepage) parameters.set(MONTHLY_FORM.showOnHomepage, '1')

  return parameters
}

// ---------------------------------------------------------------------------
// Stored values as the form shows them
// ---------------------------------------------------------------------------

/**
 * The row as 1ah's card displays it.
 *
 * `formatOreForInput` is the same conversion the dish editor and the weekly editor use,
 * so a price cannot be formatted one way and parsed another (phase 5's rule, unchanged).
 * The dates go into `<input type="date">` in exactly the `YYYY-MM-DD` the column stores,
 * with no conversion at all — which is the whole reason the wire format is the domain
 * format (`lib/time/calendar.ts`).
 */
export function monthlyFormValues(values: MonthlyBurgerValues): MonthlyFormValues {
  return {
    name: values.name ?? '',
    description: values.description ?? '',
    price: formatOreForInput(values.price_ore),
    startsOn: values.starts_on ?? '',
    endsOn: values.ends_on ?? '',
    showOnHomepage: values.show_on_homepage,
  }
}

// ---------------------------------------------------------------------------
// The two operations that are not content edits
// ---------------------------------------------------------------------------

/**
 * Parse an availability submission, or return `null`.
 *
 * `null` is the answer for anything malformed — a version that is not a timestamp, an
 * `udsolgt` that is neither `'0'` nor `'1'`. The action turns that into one refusal
 * message; it never guesses at what was meant.
 *
 * There is deliberately no date here. §7b's "today, in Copenhagen" is the server's to
 * determine and the database's to verify.
 */
export type MonthlyAvailabilityRequest = {
  readonly soldOut: boolean
  readonly expectedUpdatedAt: string
}

const availabilitySchema = z.strictObject({
  soldOut: z.enum(['0', '1']),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export function readMonthlyAvailabilityForm(
  formData: FormData,
): MonthlyAvailabilityRequest | null {
  const parsed = availabilitySchema.safeParse({
    soldOut: text(formData, MONTHLY_AVAILABILITY_FORM.soldOut),
    expectedUpdatedAt: text(formData, MONTHLY_AVAILABILITY_FORM.version),
  })

  if (!parsed.success) return null

  return {
    soldOut: parsed.data.soldOut === '1',
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
  }
}

/**
 * Whether a publish carries §7d's expired-period confirmation.
 *
 * One boolean, and it says nothing about *what* is published: the action re-reads what
 * is pending on the server and publishes that. An absent field is "ask me", which is the
 * only safe default for a question a person has not been shown yet.
 */
export function readMonthlyPublishConfirmation(formData: FormData): boolean {
  return text(formData, MONTHLY_PUBLISH_FORM.confirm) === '1'
}
