import {
  decodeWeeklyHoursErrors,
  type WeeklyFormValues,
  type WeeklyHoursErrorCode,
} from '@/lib/hours/weekly-form'
import { WEEKDAY_KEYS, type WeekdayKey } from '@/lib/time/calendar'

/**
 * The one vocabulary this screen submits — design 1t; technical plan §8.
 *
 * **One**, and that is the whole point. Every other section screen in this administration
 * keeps two, three or four disjoint field vocabularies apart, because those screens carry
 * operations that act on the same row by different rules — an immediate Udsolgt beside an
 * ordinary draft edit, a publish confirmation beside a content form. The weekly opening
 * hours have exactly one operation that changes them, Gem, plus a publish that carries no
 * content at all, so there is one form and nothing to keep apart.
 *
 * WHAT THIS SHAPE HAS NO FIELD FOR
 *
 * There is no field for an entity name, a table name or a row id: `opening_hours` is a
 * singleton and the server locates it through the publishing registry
 * (`lib/publishing/locate.ts`), so the browser never names what it is writing. There is no
 * field for a **date**, a "kun denne dag", an exception or an override — one-off dates
 * belong to the lower card (`./override-forms.ts`, phase 8B) and this form cannot express
 * one. There is no field for a message, a link or an expiry: the generated opening-hours
 * announcement rides on the one-off card's own publish (phase 8C-3B), and nothing
 * submitted here can reach `public.announcement`. And there is no field for a weekday key:
 * the seven names are built from `WEEKDAY_KEYS` on both sides, so a submission carrying
 * `aaben-xyz` is a submission nothing reads.
 *
 * The one thing the form carries besides the seven rows is `version`: the `updated_at` the
 * screen was rendered from, which is the whole of optimistic concurrency (§6). A wrong one
 * causes a refusal, never a wrong write.
 */

export const OPENING_HOURS_FORM = {
  version: 'version',
} as const

/**
 * The three field names one weekday row submits under.
 *
 * Built from the weekday key rather than written out seven times, so the name a `<select>`
 * renders with and the name the action reads are the same expression. `aaben-*` is a
 * checkbox: present with `'1'` means the day is open, and absent means closed — which is
 * what an unchecked checkbox sends, so "closed" needs no value of its own.
 */
export function weekdayFieldNames(weekday: WeekdayKey): {
  readonly open: string
  readonly from: string
  readonly to: string
} {
  return { open: `aaben-${weekday}`, from: `fra-${weekday}`, to: `til-${weekday}` }
}

// ---------------------------------------------------------------------------
// Errors and echoes
// ---------------------------------------------------------------------------

/** The query parameter a refused save carries its codes in. */
export const OPENING_HOURS_ERROR_FIELD = 'fejl'

// ---------------------------------------------------------------------------
// Reading the form
// ---------------------------------------------------------------------------

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Exactly what was submitted, before any rule has been applied to it.
 *
 * The loop is over `WEEKDAY_KEYS`, so the result has exactly the seven rows the document
 * allows however many fields the submission actually contained. A form carrying
 * `aaben-holiday`, `fra-2026-09-14` or `schedule` contributes nothing, because nothing
 * reads a name that is not one of the twenty-one this builds.
 */
export function readOpeningHoursForm(source: FormData | URLSearchParams): WeeklyFormValues {
  const rows = {} as Record<WeekdayKey, WeeklyFormValues[WeekdayKey]>

  for (const weekday of WEEKDAY_KEYS) {
    const names = weekdayFieldNames(weekday)

    rows[weekday] = {
      open: text(source, names.open) === '1',
      from: text(source, names.from),
      to: text(source, names.to),
    }
  }

  return rows
}

// ---------------------------------------------------------------------------
// Round-tripping a refusal
// ---------------------------------------------------------------------------

/**
 * The query string a refused save comes back with: the codes, and what was submitted.
 *
 * Opening hours, not personal data, and re-parsed by {@link readOpeningHoursForm} on the
 * way back in — so the URL is a convenience for the person, never a source of authority.
 * React escapes the values when it renders them into the controls, and a time that is not
 * one of the offered options simply selects nothing.
 */
export function encodeOpeningHoursEcho(
  form: WeeklyFormValues,
  errors: readonly WeeklyHoursErrorCode[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const code of errors) parameters.append(OPENING_HOURS_ERROR_FIELD, code)

  for (const weekday of WEEKDAY_KEYS) {
    const names = weekdayFieldNames(weekday)
    const row = form[weekday]

    if (row.open) parameters.set(names.open, '1')
    parameters.set(names.from, row.from)
    parameters.set(names.to, row.to)
  }

  return parameters
}

/** Only codes the domain module defined. Anything else in the URL contributes nothing. */
export { decodeWeeklyHoursErrors }
