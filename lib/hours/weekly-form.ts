import { weeklyScheduleSchema } from '@/lib/schemas/opening-hours'
import { WEEKDAY_KEYS, type WeekdayKey } from '@/lib/time/calendar'

import { isClockTime } from './clock-choices'
import { formatWeekdayName } from './format'
import type { WeeklySchedule } from './types'

/**
 * The weekly opening-hours editor's domain — design 1t, technical plan §4, §5, §7.
 *
 * Everything the Åbningstider screen has to *decide* lives here, as pure functions with
 * no React, no Supabase and no clock: what the seven rows show, what somebody typed
 * means, which day a refusal belongs to, whether the result differs from what is
 * published, and which days are waiting. The screen renders answers; it computes none.
 *
 * WHAT THIS MODULE IS **NOT**
 *
 * It is not a second opening-hours engine, and it does not restate one rule of phase 2.
 * `lib/hours/engine.ts`, `./schedule.ts` and `./format.ts` decide whether the restaurant
 * is open, when it opens next and how a day is worded, and this module calls the last of
 * those for its weekday names and touches neither of the others. Nothing here converts a
 * civil time into an instant, consults a timezone, or knows that overrides exist —
 * one-off dates are phase 8B and appear nowhere in this file.
 *
 * THE VALIDATION AUTHORITY IS STILL THE SCHEMA
 *
 * `weeklyScheduleSchema` (`lib/schemas/opening-hours.ts`) is the single statement of what
 * a schedule may be, and it says the same thing the `is_valid_opening_schedule()` CHECK
 * says in the database: exactly seven weekday keys, each either `{closed:true}` or a pair
 * of `HH:MM` times with `from` before `to`. This module does not replace it and does not
 * relax it — {@link toWeeklySchedule} runs it as the last gate before returning, so a
 * document this module calls valid is one the schema, the draft parser and the column
 * CHECK all accept.
 *
 * What it adds is *which day the problem is on*. The schema's message ("Der skal være
 * åbent i mindst et minut …") is true of a document; a person editing seven rows needs to
 * be told it is Wednesday's. So the per-day checks below run first, produce a code naming
 * the weekday and the field, and the schema then confirms the result. The rules are the
 * same rules; only the sentence is more specific.
 *
 * QUARTER-HOUR TIMES ARE A CONTROL, NOT A BUSINESS RULE
 *
 * 1t's note reads *"Tider vælges i kvarter-spring"* — the frame draws two dropdowns, and
 * {@link quarterHourChoices} is the list they offer. It is deliberately **not** enforced
 * on the way in: the column, the CHECK, the schema and the phase-2 engine all accept any
 * `HH:MM`, and a server that refused `15:20` would be inventing a restriction the rest of
 * the system does not have — and would make an existing off-grid value unsaveable. So a
 * stored time that is not on the grid is *added* to the choices instead
 * ({@link timeChoicesFor}), and nothing is ever silently moved to the nearest quarter.
 */

// ---------------------------------------------------------------------------
// What the seven rows hold
// ---------------------------------------------------------------------------

/** One weekday row of 1t's card, exactly as the form carries it. */
export type WeekdayFormValues = {
  /** 1t's switch. Off is a closed day; the two times are then not asked for. */
  readonly open: boolean
  /** `HH:MM`, or `''` for "not chosen" — which is what a closed day holds. */
  readonly from: string
  readonly to: string
}

/** All seven rows. The keys are the schedule document's own, Monday first. */
export type WeeklyFormValues = Readonly<Record<WeekdayKey, WeekdayFormValues>>

/** A closed day has no times, because the stored document has none — see below. */
const CLOSED_ROW: WeekdayFormValues = { open: false, from: '', to: '' }

/**
 * The stored schedule as 1t's seven rows show it.
 *
 * **A closed day comes back with empty times, and that is the schema's decision rather
 * than this module's.** `is_valid_opening_schedule()` accepts a closed day only as the
 * exact document `{"closed": true}` — `spec = '{"closed": true}'::jsonb`, an equality
 * test, not a subset one — so there is nowhere for a remembered `from`/`to` to live. The
 * model does not preserve the times of a day that is closed, so neither does the editor,
 * and no retention semantics are invented here to make it look as though it does.
 *
 * What that costs is one re-entry when a closed day is reopened, and the empty select is
 * what makes the cost visible: reopening a day and saving without choosing is refused by
 * name ({@link toWeeklySchedule}) rather than quietly publishing a time nobody picked.
 */
export function weeklyFormValues(schedule: WeeklySchedule): WeeklyFormValues {
  const rows = {} as Record<WeekdayKey, WeekdayFormValues>

  for (const weekday of WEEKDAY_KEYS) {
    const day = schedule[weekday]

    rows[weekday] =
      day === undefined || 'closed' in day
        ? CLOSED_ROW
        : { open: true, from: day.from, to: day.to }
  }

  return rows
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/** What can be wrong with one weekday row. */
export type WeekdayProblem =
  /** The day is open and no opening time was chosen. */
  | 'fra_mangler'
  /** The day is open and no closing time was chosen. */
  | 'til_mangler'
  | 'fra_ugyldig'
  | 'til_ugyldig'
  /**
   * Closing is at or before opening.
   *
   * This is also the rule that refuses an opening across midnight ("22:00–02:00"). The
   * engine relies on it — `openDay()` in `./schedule.ts` states in as many words that
   * "opening hours never cross midnight" — so an editor that accepted one would produce
   * a document the phase-2 engine throws on. It is one rule with two readings, not two
   * rules, and it is therefore one code.
   */
  | 'ikke_efter'

export type WeekdayErrorCode = `${WeekdayKey}:${WeekdayProblem}`

/**
 * The schema refused a document every per-day check accepted.
 *
 * Unreachable while the two agree, and kept because "unreachable" is a claim about today.
 * If the schema ever gains a rule the rows do not know about, this is what a person sees
 * instead of a save that silently does nothing.
 */
export const SCHEDULE_ERROR_CODE = 'skema:ugyldig'

export type WeeklyHoursErrorCode = WeekdayErrorCode | typeof SCHEDULE_ERROR_CODE

/** Which of a row's two time fields a refusal belongs to, for `aria-describedby`. */
export type WeekdayErrorField = 'fra' | 'til'

const PROBLEM_FIELD: Record<WeekdayProblem, WeekdayErrorField> = {
  fra_mangler: 'fra',
  fra_ugyldig: 'fra',
  til_mangler: 'til',
  til_ugyldig: 'til',
  // Reported on the closing time, because that is the field a person moves to fix it.
  ikke_efter: 'til',
}

const PROBLEM_SENTENCES: Record<WeekdayProblem, (day: string) => string> = {
  fra_mangler: (day) => `Vælg, hvornår I åbner om ${day}en.`,
  til_mangler: (day) => `Vælg, hvornår I lukker om ${day}en.`,
  fra_ugyldig: (day) => `Åbningstidspunktet om ${day}en skal skrives som TT:MM.`,
  til_ugyldig: (day) => `Lukketidspunktet om ${day}en skal skrives som TT:MM.`,
  ikke_efter: (day) =>
    `Om ${day}en skal lukketiden ligge efter åbningstiden. Åbningstider kan ikke gå over midnat.`,
}

const PROBLEMS = Object.keys(PROBLEM_SENTENCES) as WeekdayProblem[]

/**
 * Every sentence this editor can show, one per weekday and problem.
 *
 * Composed rather than written out thirty-five times. Seven days times five problems is
 * the same sentence with a different noun in it, and a table typed by hand would be
 * thirty-five chances to write "onsdagen" where "torsdagen" belongs. The weekday names
 * come from `./format.ts`, which is where every Danish weekday in this system comes from,
 * so the editor and the public hours table cannot spell a day differently.
 */
export const WEEKLY_HOURS_ERROR_MESSAGES: Readonly<Record<WeeklyHoursErrorCode, string>> =
  Object.fromEntries([
    ...WEEKDAY_KEYS.flatMap((weekday) =>
      PROBLEMS.map((problem) => [
        `${weekday}:${problem}`,
        PROBLEM_SENTENCES[problem](formatWeekdayName(weekday, 'long')),
      ]),
    ),
    [
      SCHEDULE_ERROR_CODE,
      'Åbningstiderne kunne ikke gemmes, fordi de ikke har den rigtige form. Ret dagene og prøv igen.',
    ],
  ]) as Record<WeeklyHoursErrorCode, string>

const ERROR_CODES = Object.keys(WEEKLY_HOURS_ERROR_MESSAGES) as WeeklyHoursErrorCode[]

/** True when `value` is a code this module defined. Everything else is not a refusal. */
export function isWeeklyHoursErrorCode(value: unknown): value is WeeklyHoursErrorCode {
  return typeof value === 'string' && (ERROR_CODES as string[]).includes(value)
}

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeWeeklyHoursErrors(
  values: readonly string[],
): WeeklyHoursErrorCode[] {
  return values.filter(isWeeklyHoursErrorCode)
}

/** The weekday a refusal belongs to, or `null` for the whole-document one. */
export function weeklyHoursErrorDay(code: WeeklyHoursErrorCode): WeekdayKey | null {
  if (code === SCHEDULE_ERROR_CODE) return null

  return code.split(':')[0] as WeekdayKey
}

/**
 * Which of a row's two time fields a refusal is bound to, or `null` for the
 * whole-document one, which belongs to no field and is shown as a notice instead.
 */
export function weeklyHoursErrorField(code: WeeklyHoursErrorCode): WeekdayErrorField | null {
  if (code === SCHEDULE_ERROR_CODE) return null

  return PROBLEM_FIELD[code.split(':')[1] as WeekdayProblem]
}

// ---------------------------------------------------------------------------
// What the two dropdowns offer
// ---------------------------------------------------------------------------

/**
 * The quarter-hour grid, the wall-clock test and the off-grid rule now live in
 * `./clock-choices.ts`, because 1t's *"Tider vælges i kvarter-spring"* is one sentence
 * about all four of the screen's time dropdowns — the seven weekday rows here, and the two
 * fields of the one-off override card (phase 8B). They are re-exported under exactly the
 * names this module has always used, so nothing that imports them had to change and the
 * two editors share a *control* without sharing a *rule*: what a day's times must satisfy
 * is decided below and, for an override, in `./override-form.ts`.
 */
export { isClockTime, quarterHourChoices, timeChoicesFor } from './clock-choices'

// ---------------------------------------------------------------------------
// Turning seven rows into a schedule
// ---------------------------------------------------------------------------

export type WeeklyHoursFormResult =
  | { readonly ok: true; readonly schedule: WeeklySchedule }
  | { readonly ok: false; readonly errors: readonly WeeklyHoursErrorCode[] }

/**
 * Read 1t's card.
 *
 * Every day is checked rather than only the first that fails, so somebody correcting the
 * week sees everything wrong with it at once — which matters more here than on a
 * single-item editor, because seven rows are submitted together.
 *
 * The result object is built by iterating {@link WEEKDAY_KEYS}, so it has **exactly** the
 * seven keys the document allows and no others, whatever the caller's `form` object
 * happens to contain. That is the structural half of "no arbitrary extra keys"; the
 * strict schema below, `openingHoursDraft.input` in `saveEntityDraft`, and the column
 * CHECK are the other three.
 */
export function toWeeklySchedule(form: WeeklyFormValues): WeeklyHoursFormResult {
  const errors: WeeklyHoursErrorCode[] = []
  const schedule: Record<string, unknown> = {}

  for (const weekday of WEEKDAY_KEYS) {
    const row = form[weekday]

    if (!row.open) {
      // The one document shape a closed day may have (§4). Nothing else is written, so
      // there is no place for a leftover time to survive a save.
      schedule[weekday] = { closed: true }
      continue
    }

    const problems: WeekdayProblem[] = []

    if (row.from.trim().length === 0) problems.push('fra_mangler')
    else if (!isClockTime(row.from)) problems.push('fra_ugyldig')

    if (row.to.trim().length === 0) problems.push('til_mangler')
    else if (!isClockTime(row.to)) problems.push('til_ugyldig')

    // Only when both times are readable: an ordering complaint about a value nobody
    // could parse would be a second message about the same mistake.
    if (problems.length === 0 && row.from >= row.to) problems.push('ikke_efter')

    for (const problem of problems) errors.push(`${weekday}:${problem}`)

    if (problems.length === 0) schedule[weekday] = { from: row.from, to: row.to }
  }

  if (errors.length > 0) return { ok: false, errors }

  // The last gate, and the authoritative one. If this ever refuses a document the rows
  // accepted, the rows are behind the schema — and the person is told rather than
  // meeting a constraint violation at publish.
  const parsed = weeklyScheduleSchema.safeParse(schedule)
  if (!parsed.success) return { ok: false, errors: [SCHEDULE_ERROR_CODE] }

  return { ok: true, schedule: parsed.data as WeeklySchedule }
}

// ---------------------------------------------------------------------------
// What is different from what is published
// ---------------------------------------------------------------------------

function sameDay(a: WeeklySchedule, b: WeeklySchedule, weekday: WeekdayKey): boolean {
  const left = a[weekday]
  const right = b[weekday]

  if (left === undefined || right === undefined) return left === right
  if ('closed' in left || 'closed' in right) return 'closed' in left && 'closed' in right

  return left.from === right.from && left.to === right.to
}

/** The days on which the two schedules disagree, Monday first. */
export function changedWeekdays(
  next: WeeklySchedule,
  live: WeeklySchedule,
): WeekdayKey[] {
  return WEEKDAY_KEYS.filter((weekday) => !sameDay(next, live, weekday))
}

/** True when the two documents say the same thing about all seven days. */
export function schedulesEqual(next: WeeklySchedule, live: WeeklySchedule): boolean {
  return changedWeekdays(next, live).length === 0
}

/**
 * What one Gem should write — technical plan §4, §6.
 *
 * §4: a draft holds *only the changed fields*. `opening_hours` has exactly one editable
 * field, so "changed" is a question about the whole document: a week edited back to what
 * the hjemmeside already says is no longer a pending change, and the draft has to leave
 * rather than sit there putting a Kladde badge on a screen with nothing waiting and
 * offering an Offentliggør that would publish nothing.
 *
 * `clear` is how a partial editor says "take this one out again" (`lib/drafts/overlay.ts`
 * — the mechanism phase 5E added for a dish moved back to its published position), and it
 * is used here rather than `mode: 'replace'` for the reason that file spells out: this is
 * the only editor on the row *today*, and `replace` is a claim about tomorrow as well.
 */
export function weeklyHoursDraftWrite(
  next: WeeklySchedule,
  live: WeeklySchedule,
): {
  readonly values: { readonly schedule?: WeeklySchedule }
  readonly clear: readonly string[]
} {
  return schedulesEqual(next, live)
    ? { values: {}, clear: ['schedule'] }
    : { values: { schedule: next }, clear: [] }
}

// ---------------------------------------------------------------------------
// Saying what is waiting
// ---------------------------------------------------------------------------

/** "onsdag", "onsdag og torsdag", "onsdag, torsdag og fredag". */
function joinDanish(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? ''

  return `${words.slice(0, -1).join(', ')} og ${words[words.length - 1]}`
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** What is waiting, in the two lengths the screen needs it in. */
export type WeeklyHoursPending = {
  /** The Kladde badge on the card: "Kladde — onsdag". Short, because a badge is. */
  readonly badge: string
  /** 1aa's pending band, as a whole sentence. */
  readonly sentence: string
}

/**
 * What is waiting — or `null` when nothing is.
 *
 * It names **which days** rather than saying "Ændringer", for the same reason the menu and
 * monthly bands name their fields: a band that cannot say what is pending is a band a
 * person has to open the editor to understand. Both strings are derived from the two
 * documents, so neither can claim a change the database does not hold.
 *
 * Two lengths rather than one string used twice. The band has a line to itself and can
 * afford a sentence; the badge sits beside a heading and cannot, and a badge carrying a
 * full sentence is a badge that wraps to three lines on a phone.
 *
 * A draft that differs from the published schedule on no day at all still produces both —
 * it exists, it will be published, and saying "nothing is waiting" while the dashboard
 * counts one pending change would be the screen contradicting the dashboard.
 * {@link weeklyHoursDraftWrite} makes that state rare rather than impossible: a draft
 * written before the published values moved can reach it.
 */
export function describeWeeklyHoursPending(
  draft: WeeklySchedule | null,
  live: WeeklySchedule,
): WeeklyHoursPending | null {
  if (draft === null) return null

  const changed = changedWeekdays(draft, live)

  if (changed.length === 0) {
    return {
      badge: 'Kladde',
      sentence:
        'En kladde venter på at blive offentliggjort. Den er magen til de tider, der allerede står på hjemmesiden.',
    }
  }

  const days = joinDanish(changed.map((weekday) => formatWeekdayName(weekday, 'long')))

  return {
    badge: `Kladde — ${days}`,
    sentence: `${capitalise(days)} venter på at blive offentliggjort.`,
  }
}

/**
 * One row's state in words — 1aa's "status = ikon + tekst, aldrig farve alene".
 *
 * The switch's colour and its knob position both say whether a day is open; the word is
 * the third carrier, and the one that survives being read aloud or seen without colour.
 * 1t writes "Lukket" beside a grey switch and writes nothing beside a green one, because
 * the two dropdowns that appear there already say the day is open.
 */
export const WEEKDAY_STATE_LABELS = { open: 'Åbent', closed: 'Lukket' } as const
