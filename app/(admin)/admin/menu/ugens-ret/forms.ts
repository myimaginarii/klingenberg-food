import { z } from 'zod'

import { formatOreForInput, parseKronerToOre } from '@/lib/menu/pricing'
import {
  WEEKLY_SOLD_OUT_TARGETS,
  type WeeklySoldOutTarget,
  type WeeklySpecialValues,
} from '@/lib/menu/weekly'
import { WEEKDAY_KEYS, type WeekdayKey } from '@/lib/time/calendar'
import { formatIsoWeekToken, parseIsoWeekToken, type IsoWeek } from '@/lib/time/iso-week'

/**
 * The four vocabularies this screen submits, in one place — design 1ag.
 *
 * Four, and deliberately **disjoint**. The menu administration keeps its availability,
 * deletion, reorder and Tapas field names apart so that a form carrying one operation's
 * names cannot reach another operation's action; the same rule applies here, and it
 * matters more, because all four of these act on the *same row*:
 *
 *   * {@link WEEK_FORM} — 1ag's first card. Ordinary draft change.
 *   * {@link SATURDAY_FORM} — 1ag's second card. Ordinary draft change.
 *   * {@link WEEKLY_AVAILABILITY_FORM} — either card's Udsolgt switch. **Immediate** (§6).
 *   * {@link COPY_FORM} — "Kopiér sidste uge". Seeds a draft, never publishes (§6).
 *
 * A submission carrying `udsolgt` cannot reach a content editor, one carrying `navn`
 * cannot reach the availability action, and neither can reach the copy — because no
 * parser here reads a name it was not given, and every schema below is a
 * `strictObject`.
 *
 * WHAT NONE OF THEM HAS A FIELD FOR
 *
 * There is no field for a sold-out **date** (§7b: the server decides "today, in
 * Copenhagen"), no field for the *source* of a copy (§6: the server reads the live row),
 * no field for `image_id` (phase 10 owns the image library) and no field for anything on
 * another table. The negative tests in the E2E suite forge each of those and assert the
 * row is untouched; they pass because these shapes do not have the fields, not because
 * something strips them.
 *
 * The one thing every form carries is `version`: the `updated_at` the screen was
 * rendered from, which is the whole of optimistic concurrency (§6). A wrong one causes
 * a refusal, never a wrong write.
 */

// ---------------------------------------------------------------------------
// 1ag's first card — Ugens ret
// ---------------------------------------------------------------------------

export const WEEK_FORM = {
  version: 'version',
  /** One `2026-W36` token, from the dropdown 1ag draws as "Ugenummer". */
  week: 'uge',
  /** One checkbox per serving day; the value is the schedule's own weekday key. */
  day: 'dag',
  name: 'navn',
  description: 'beskrivelse',
  priceSmall: 'pris_lille',
  priceLarge: 'pris_stor',
} as const

// ---------------------------------------------------------------------------
// 1ag's second card — Lørdagsmenu denne uge
// ---------------------------------------------------------------------------

export const SATURDAY_FORM = {
  version: 'version',
  /** '1' when there is a Saturday menu this week. Absent is off, as a checkbox is. */
  enabled: 'loerdag_til',
  name: 'loerdag_navn',
  description: 'loerdag_beskrivelse',
  price: 'loerdag_pris',
  deadline: 'loerdag_frist',
} as const

// ---------------------------------------------------------------------------
// Both cards' Udsolgt switch — the immediate path (§6)
// ---------------------------------------------------------------------------

export const WEEKLY_AVAILABILITY_FORM = {
  version: 'version',
  /** 'week' or 'saturday'. Which card, never which column. */
  target: 'del',
  /** '1' = mark Udsolgt i dag, '0' = return to Tilgængelig. */
  soldOut: 'udsolgt',
} as const

// ---------------------------------------------------------------------------
// "Kopiér sidste uge" (§6, decision 4)
// ---------------------------------------------------------------------------

export const COPY_FORM = {
  version: 'version',
  /** '1' only when a person has answered the overwrite confirmation. */
  confirm: 'bekraeft',
} as const

// ---------------------------------------------------------------------------
// Errors and echoes
// ---------------------------------------------------------------------------

/** The query parameter a refused save carries its codes in. */
export const WEEKLY_ERROR_FIELD = 'fejl'

export type WeeklyErrorField =
  | 'uge'
  | 'navn'
  | 'beskrivelse'
  | 'pris_lille'
  | 'pris_stor'
  | 'loerdag_navn'
  | 'loerdag_beskrivelse'
  | 'loerdag_pris'
  | 'loerdag_frist'

export type WeeklyErrorCode =
  | 'uge:required'
  | 'uge:invalid'
  | 'navn:too_long'
  | 'beskrivelse:too_long'
  | 'pris_lille:not_a_number'
  | 'pris_lille:too_many_decimals'
  | 'pris_lille:out_of_range'
  | 'pris_stor:not_a_number'
  | 'pris_stor:too_many_decimals'
  | 'pris_stor:out_of_range'
  | 'loerdag_navn:required'
  | 'loerdag_navn:too_long'
  | 'loerdag_beskrivelse:too_long'
  | 'loerdag_pris:not_a_number'
  | 'loerdag_pris:too_many_decimals'
  | 'loerdag_pris:out_of_range'
  | 'loerdag_frist:too_long'

/** The sentence each refusal shows, beneath its own field. */
export const WEEKLY_ERROR_MESSAGES: Record<WeeklyErrorCode, string> = {
  'uge:required': 'Vælg et ugenummer.',
  'uge:invalid': 'Vælg et ugenummer fra listen.',
  'navn:too_long': 'Navnet må højst være 200 tegn.',
  'beskrivelse:too_long': 'Beskrivelsen må højst være 600 tegn.',
  'pris_lille:not_a_number': 'Prisen skal være et tal, fx 89 eller 89,50.',
  'pris_lille:too_many_decimals': 'Prisen kan højst have to decimaler, fx 89,50.',
  'pris_lille:out_of_range': 'Prisen skal være mellem 0 og 10.000 kr.',
  'pris_stor:not_a_number': 'Prisen skal være et tal, fx 89 eller 89,50.',
  'pris_stor:too_many_decimals': 'Prisen kan højst have to decimaler, fx 89,50.',
  'pris_stor:out_of_range': 'Prisen skal være mellem 0 og 10.000 kr.',
  'loerdag_navn:required': 'Lørdagsmenuen skal have et navn, når den er slået til.',
  'loerdag_navn:too_long': 'Navnet må højst være 200 tegn.',
  'loerdag_beskrivelse:too_long': 'Beskrivelsen må højst være 600 tegn.',
  'loerdag_pris:not_a_number': 'Prisen skal være et tal, fx 89 eller 89,50.',
  'loerdag_pris:too_many_decimals': 'Prisen kan højst have to decimaler, fx 89,50.',
  'loerdag_pris:out_of_range': 'Prisen skal være mellem 0 og 10.000 kr.',
  'loerdag_frist:too_long': 'Bestillingsfristen må højst være 120 tegn.',
}

const ERROR_CODES = Object.keys(WEEKLY_ERROR_MESSAGES) as WeeklyErrorCode[]

/** The field an error belongs to, so the form can bind it with `aria-describedby`. */
export function weeklyErrorField(code: WeeklyErrorCode): WeeklyErrorField {
  return code.split(':')[0] as WeeklyErrorField
}

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeWeeklyErrors(values: readonly string[]): WeeklyErrorCode[] {
  return values.filter((value): value is WeeklyErrorCode =>
    (ERROR_CODES as string[]).includes(value),
  )
}

// ---------------------------------------------------------------------------
// Reading the two content forms
// ---------------------------------------------------------------------------

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

function textList(source: FormData | URLSearchParams, name: string): string[] {
  return source.getAll(name).filter((value): value is string => typeof value === 'string')
}

/** Exactly what the person typed, before any rule has been applied to it. */
export type WeekFormValues = {
  readonly week: string
  readonly days: readonly string[]
  readonly name: string
  readonly description: string
  readonly priceSmall: string
  readonly priceLarge: string
}

export type SaturdayFormValues = {
  readonly enabled: boolean
  readonly name: string
  readonly description: string
  readonly price: string
  readonly deadline: string
}

export function readWeekForm(source: FormData | URLSearchParams): WeekFormValues {
  return {
    week: text(source, WEEK_FORM.week),
    days: textList(source, WEEK_FORM.day),
    name: text(source, WEEK_FORM.name),
    description: text(source, WEEK_FORM.description),
    priceSmall: text(source, WEEK_FORM.priceSmall),
    priceLarge: text(source, WEEK_FORM.priceLarge),
  }
}

export function readSaturdayForm(source: FormData | URLSearchParams): SaturdayFormValues {
  return {
    enabled: text(source, SATURDAY_FORM.enabled) === '1',
    name: text(source, SATURDAY_FORM.name),
    description: text(source, SATURDAY_FORM.description),
    price: text(source, SATURDAY_FORM.price),
    deadline: text(source, SATURDAY_FORM.deadline),
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

export type WeekSubmission = {
  readonly week: IsoWeek
  readonly days: readonly WeekdayKey[]
  readonly name: string | null
  readonly description: string | null
  readonly price_small_ore: number | null
  readonly price_large_ore: number | null
}

export type WeekFormResult =
  | { readonly ok: true; readonly values: WeekSubmission }
  | { readonly ok: false; readonly errors: readonly WeeklyErrorCode[] }

/**
 * Read 1ag's first card.
 *
 * Every field is checked rather than only the first that fails, so somebody correcting
 * a form sees everything wrong with it at once. The week token is the one required
 * value: `weekly_special` may carry a null week, but a *submitted* form always has the
 * dropdown in it, so an absent or unparseable token is a refusal rather than a silent
 * clearing of the week.
 *
 * The serving days are filtered against the schedule's own weekday vocabulary — the
 * same seven keys `opening_hours.schedule` is keyed by and the same seven the column's
 * CHECK allows — so an unknown value contributes nothing rather than earning a message
 * nobody could act on. There is no valid path by which a person could produce one: the
 * checkboxes are rendered from that vocabulary.
 */
export function toWeekSubmission(form: WeekFormValues): WeekFormResult {
  const errors: WeeklyErrorCode[] = []

  const week = parseIsoWeekToken(form.week)
  if (form.week.trim().length === 0) errors.push('uge:required')
  else if (week === null) errors.push('uge:invalid')

  const name = optional(form.name)
  if (name !== null && name.length > 200) errors.push('navn:too_long')

  const description = optional(form.description)
  if (description !== null && description.length > 600) errors.push('beskrivelse:too_long')

  const small = parseKronerToOre(form.priceSmall)
  if (!small.ok) errors.push(`pris_lille:${small.error}` as WeeklyErrorCode)

  const large = parseKronerToOre(form.priceLarge)
  if (!large.ok) errors.push(`pris_stor:${large.error}` as WeeklyErrorCode)

  if (errors.length > 0 || week === null || !small.ok || !large.ok) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    values: {
      week,
      days: WEEKDAY_KEYS.filter((weekday) => form.days.includes(weekday)),
      name,
      description,
      price_small_ore: small.priceOre,
      price_large_ore: large.priceOre,
    },
  }
}

export type SaturdaySubmission = Pick<
  WeeklySpecialValues,
  'sat_enabled' | 'sat_name' | 'sat_description' | 'sat_price_ore' | 'sat_deadline'
>

export type SaturdayFormResult =
  | { readonly ok: true; readonly values: SaturdaySubmission }
  | { readonly ok: false; readonly errors: readonly WeeklyErrorCode[] }

/**
 * Read 1ag's second card.
 *
 * The one conditional rule on this screen, and it comes straight from the approved
 * frame: turning the Saturday menu **on** promises a guest a dish, so it must have a
 * name. Turning it **off** promises the opposite — "Ingen lørdagsmenu denne uge" — and
 * the frame is explicit that the text is kept: *"Teksten bevares til næste gang."* So a
 * disabled menu is validated but not required, and nothing is blanked.
 *
 * That is what makes "no Saturday menu" a real state rather than an empty one. The
 * schema already provides `sat_enabled` for it (§4), so the public card is never faked
 * by putting placeholder words into a food field.
 */
export function toSaturdaySubmission(form: SaturdayFormValues): SaturdayFormResult {
  const errors: WeeklyErrorCode[] = []

  const name = optional(form.name)
  if (form.enabled && name === null) errors.push('loerdag_navn:required')
  else if (name !== null && name.length > 200) errors.push('loerdag_navn:too_long')

  const description = optional(form.description)
  if (description !== null && description.length > 600) {
    errors.push('loerdag_beskrivelse:too_long')
  }

  const price = parseKronerToOre(form.price)
  if (!price.ok) errors.push(`loerdag_pris:${price.error}` as WeeklyErrorCode)

  const deadline = optional(form.deadline)
  if (deadline !== null && deadline.length > 120) errors.push('loerdag_frist:too_long')

  if (errors.length > 0 || !price.ok) return { ok: false, errors }

  return {
    ok: true,
    values: {
      sat_enabled: form.enabled,
      sat_name: name,
      sat_description: description,
      sat_price_ore: price.priceOre,
      sat_deadline: deadline,
    },
  }
}

// ---------------------------------------------------------------------------
// Round-tripping a refusal
// ---------------------------------------------------------------------------

/**
 * The query string a refused save comes back with: the codes, and what was typed.
 *
 * Menu content, not personal data, and re-parsed by `readWeekForm` / `readSaturdayForm`
 * on the way back in — so the URL is a convenience for the person, never a source of
 * authority. React escapes the values when it renders them into the fields.
 */
export function encodeWeekEcho(
  form: WeekFormValues,
  errors: readonly WeeklyErrorCode[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const code of errors) parameters.append(WEEKLY_ERROR_FIELD, code)

  parameters.set(WEEK_FORM.week, form.week)
  for (const day of form.days) parameters.append(WEEK_FORM.day, day)
  parameters.set(WEEK_FORM.name, form.name)
  parameters.set(WEEK_FORM.description, form.description)
  parameters.set(WEEK_FORM.priceSmall, form.priceSmall)
  parameters.set(WEEK_FORM.priceLarge, form.priceLarge)

  return parameters
}

export function encodeSaturdayEcho(
  form: SaturdayFormValues,
  errors: readonly WeeklyErrorCode[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const code of errors) parameters.append(WEEKLY_ERROR_FIELD, code)

  if (form.enabled) parameters.set(SATURDAY_FORM.enabled, '1')
  parameters.set(SATURDAY_FORM.name, form.name)
  parameters.set(SATURDAY_FORM.description, form.description)
  parameters.set(SATURDAY_FORM.price, form.price)
  parameters.set(SATURDAY_FORM.deadline, form.deadline)

  return parameters
}

// ---------------------------------------------------------------------------
// Stored values as the forms show them
// ---------------------------------------------------------------------------

/**
 * The row as 1ag's first card displays it.
 *
 * `formatOreForInput` is the same conversion the dish editor uses, so a price cannot be
 * formatted one way and parsed another. A row with no week yet shows an empty token,
 * which the form's dropdown resolves to this week (see `WeekNumberField`).
 */
export function weekFormValues(values: WeeklySpecialValues): WeekFormValues {
  return {
    week:
      values.iso_year === null || values.iso_week === null
        ? ''
        : formatIsoWeekToken({ year: values.iso_year, week: values.iso_week }),
    days: values.days,
    name: values.name ?? '',
    description: values.description ?? '',
    priceSmall: formatOreForInput(values.price_small_ore),
    priceLarge: formatOreForInput(values.price_large_ore),
  }
}

/** The row as 1ag's second card displays it. */
export function saturdayFormValues(values: WeeklySpecialValues): SaturdayFormValues {
  return {
    enabled: values.sat_enabled,
    name: values.sat_name ?? '',
    description: values.sat_description ?? '',
    price: formatOreForInput(values.sat_price_ore),
    deadline: values.sat_deadline ?? '',
  }
}

// ---------------------------------------------------------------------------
// The two operations that are not content edits
// ---------------------------------------------------------------------------

/**
 * Parse an availability submission, or return `null`.
 *
 * `null` is the answer for anything malformed — a target that is neither literal, a
 * version that is not a timestamp, an `udsolgt` that is neither `'0'` nor `'1'`. The
 * action turns that into one refusal message; it never guesses at what was meant.
 *
 * There is deliberately no date here. §7b's "today, in Copenhagen" is the server's to
 * determine and the database's to verify.
 */
export type WeeklyAvailabilityRequest = {
  readonly target: WeeklySoldOutTarget
  readonly soldOut: boolean
  readonly expectedUpdatedAt: string
}

const availabilitySchema = z.strictObject({
  target: z.enum(WEEKLY_SOLD_OUT_TARGETS),
  soldOut: z.enum(['0', '1']),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export function readWeeklyAvailabilityForm(
  formData: FormData,
): WeeklyAvailabilityRequest | null {
  const parsed = availabilitySchema.safeParse({
    target: text(formData, WEEKLY_AVAILABILITY_FORM.target),
    soldOut: text(formData, WEEKLY_AVAILABILITY_FORM.soldOut),
    expectedUpdatedAt: text(formData, WEEKLY_AVAILABILITY_FORM.version),
  })

  if (!parsed.success) return null

  return {
    target: parsed.data.target,
    soldOut: parsed.data.soldOut === '1',
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
  }
}

/**
 * Parse a "Kopiér sidste uge" submission, or return `null`.
 *
 * Two values, and neither of them says anything about *what* is copied: the version the
 * screen was rendered from, and whether a person has answered the overwrite question.
 * The source, its fields and the destination week are all the server's (§6).
 */
export type CopyRequest = {
  readonly expectedUpdatedAt: string
  readonly confirmOverwrite: boolean
}

const copySchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})

export function readCopyForm(formData: FormData): CopyRequest | null {
  const parsed = copySchema.safeParse({
    expectedUpdatedAt: text(formData, COPY_FORM.version),
  })

  if (!parsed.success) return null

  return {
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    // An explicit opt-in, and only from the confirmation's own form. Absent is "ask me".
    confirmOverwrite: text(formData, COPY_FORM.confirm) === '1',
  }
}
