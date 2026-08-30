import {
  addDays,
  differenceInDays,
  formatIsoDate,
  parseIsoDate,
  weekdayOf,
  WEEKDAY_KEYS,
  type IsoDate,
} from './calendar'
import { copenhagenDateOf } from './copenhagen'

/**
 * ISO-8601 week numbering — technical plan §4 (`weekly_special.iso_year`, `iso_week`),
 * design 1ag ("Ugenummer") and 1af ("Uge 00").
 *
 * `weekly_special` stores the week a dish belongs to as a **pair**: `iso_year` and
 * `iso_week`. The pair is not a date and is not derivable from one number — the last
 * days of December frequently belong to week 1 of the following year, and the first
 * days of January frequently belong to week 52 or 53 of the previous one. Storing
 * either half alone would make "uge 1" ambiguous exactly once a year, which is the one
 * week of the year the kitchen cannot afford it to be.
 *
 * WHY THIS IS NOT `toLocaleString`, `getWeek` OR A DATE LIBRARY
 *
 * There is no ISO-week accessor on `Date`, and every browser-side substitute is either
 * locale-dependent or absent: `Intl.DateTimeFormat`'s `week` field is not
 * interoperable, US week numbering starts on Sunday and counts differently, and
 * `Temporal.PlainDate#weekOfYear` is not available in this runtime. §1 (adjustment 4)
 * rules out a date library, so the rule is implemented here, from the standard's own
 * definition, and pinned by tests.
 *
 * THE DEFINITION, IN THREE SENTENCES
 *
 *   * Weeks begin on **Monday**.
 *   * Week 1 is the week containing the year's **first Thursday** — equivalently, the
 *     week containing **4 January**.
 *   * A date's ISO year is therefore the calendar year of **its own Thursday**, which
 *     is what makes 31 December 2029 belong to week 1 of 2030.
 *
 * A year has **53 weeks** when its 1 January falls on a Thursday, or when it is a leap
 * year whose 1 January falls on a Wednesday; otherwise 52. That is derived below rather
 * than tabulated, so it cannot fall out of date.
 *
 * EVERYTHING CIVIL, NOTHING LOCAL
 *
 * The whole module works in `IsoDate` values from `./calendar`, which carry no
 * timezone. The single entry point that needs an instant, {@link currentIsoWeek}, goes
 * through `copenhagenDateOf` — the one boundary module allowed to name a timezone (§7).
 * `Date#getDay()`, `getFullYear()` and friends do not appear here at all, so this file
 * cannot pick up the host machine's clock by accident.
 */

/** A week in ISO-8601 numbering. Both halves, always together. */
export type IsoWeek = {
  readonly year: number
  readonly week: number
}

/** The database CHECK on `weekly_special.iso_year`: `between 2000 and 2999` (§4). */
export const MIN_ISO_YEAR = 2000
export const MAX_ISO_YEAR = 2999

/** Monday-first index of a weekday: `mon` is 0, `sun` is 6. */
function weekdayIndex(date: IsoDate): number {
  return WEEKDAY_KEYS.indexOf(weekdayOf(date))
}

/** The Thursday of the ISO week a date falls in. Its calendar year is the ISO year. */
function thursdayOfWeek(date: IsoDate): IsoDate {
  return addDays(date, 3 - weekdayIndex(date))
}

/** The Monday on which ISO week 1 of a calendar year begins. */
function firstMondayOfIsoYear(year: number): IsoDate {
  // 4 January is in week 1 by definition, whichever weekday it happens to be.
  const january4 = formatIsoDate({ year, month: 1, day: 4 })

  return addDays(january4, -weekdayIndex(january4))
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < MIN_ISO_YEAR || year > MAX_ISO_YEAR) {
    throw new TypeError(
      `Expected an ISO year between ${String(MIN_ISO_YEAR)} and ${String(MAX_ISO_YEAR)}. Received: ${String(year)}`,
    )
  }
}

/**
 * How many ISO weeks a year has: 52, or 53.
 *
 * Derived from the definition rather than from a table: a year is 53 weeks long exactly
 * when it contains 53 Thursdays, which happens when 1 January is itself a Thursday, or
 * when a leap year's 1 January is a Wednesday and 31 December is therefore the extra
 * Thursday.
 */
export function isoWeeksInYear(year: number): number {
  assertYear(year)

  const january1 = weekdayOf(formatIsoDate({ year, month: 1, day: 1 }))
  const december31 = weekdayOf(formatIsoDate({ year, month: 12, day: 31 }))

  return january1 === 'thu' || december31 === 'thu' ? 53 : 52
}

/** Does this year actually have a week with this number? */
export function isValidIsoWeek(candidate: IsoWeek): boolean {
  if (!Number.isInteger(candidate.year) || !Number.isInteger(candidate.week)) return false
  if (candidate.year < MIN_ISO_YEAR || candidate.year > MAX_ISO_YEAR) return false
  if (candidate.week < 1) return false

  return candidate.week <= isoWeeksInYear(candidate.year)
}

/** The Monday of the ISO week a date falls in. */
function mondayOfWeekContaining(date: IsoDate): IsoDate {
  return addDays(date, -weekdayIndex(date))
}

/**
 * The ISO week a civil date belongs to.
 *
 * Two different days of the same week answer the two halves: the **Thursday** decides
 * the ISO *year*, because it is the day the standard's rule is written in terms of, and
 * the **Monday** decides the *number*, because counting weeks means counting from one
 * week-start to another. Measuring Monday-to-Thursday instead would divide a distance
 * that is not a whole number of weeks.
 */
export function isoWeekOf(date: IsoDate): IsoWeek {
  const year = parseIsoDate(thursdayOfWeek(date)).year
  const monday = mondayOfWeekContaining(date)
  const week1Monday = firstMondayOfIsoYear(year)

  return { year, week: differenceInDays(week1Monday, monday) / 7 + 1 }
}

/**
 * The Monday an ISO week begins on.
 *
 * The inverse of {@link isoWeekOf}, and the arithmetic every other question in this
 * module is answered through — "the week after this one" is "the Monday seven days
 * later", which needs no special case for December.
 */
export function mondayOfIsoWeek(week: IsoWeek): IsoDate {
  if (!isValidIsoWeek(week)) {
    throw new TypeError(
      `Expected an ISO week that exists. Received: ${String(week.year)}-W${String(week.week)}`,
    )
  }

  return addDays(firstMondayOfIsoYear(week.year), (week.week - 1) * 7)
}

/**
 * Move a number of weeks forwards (or, with a negative count, backwards).
 *
 * Year boundaries are not a case this handles; they are a case it cannot have. The move
 * happens on the calendar, between two Mondays, and the ISO year of the result is read
 * back from the result — so week 52 of a 52-week year advances to week 1 of the next
 * year, and week 52 of a **53**-week year advances to week 53 of the same one, without
 * either rule being written down.
 */
export function addIsoWeeks(week: IsoWeek, count: number): IsoWeek {
  if (!Number.isInteger(count)) {
    throw new TypeError(`Expected a whole number of weeks. Received: ${String(count)}`)
  }

  return isoWeekOf(addDays(mondayOfIsoWeek(week), count * 7))
}

/** The week after this one. What "Kopiér sidste uge" advances to (§6, decision 4). */
export function nextIsoWeek(week: IsoWeek): IsoWeek {
  return addIsoWeeks(week, 1)
}

/**
 * This week, in Copenhagen.
 *
 * The only function here that takes an instant, and it converts it through the one
 * module allowed to know about timezones. A server in UTC and a laptop in Copenhagen
 * therefore answer the same thing, including in the hour either side of midnight —
 * which is the hour the kitchen is most likely to be preparing next week.
 */
export function currentIsoWeek(now: Date): IsoWeek {
  return isoWeekOf(copenhagenDateOf(now))
}

/** Are these the same week? Both halves, never just the number. */
export function isSameIsoWeek(a: IsoWeek | null, b: IsoWeek | null): boolean {
  if (a === null || b === null) return a === b

  return a.year === b.year && a.week === b.week
}

/** Chronological order: negative when `a` is the earlier week. */
export function compareIsoWeeks(a: IsoWeek, b: IsoWeek): number {
  return a.year - b.year || a.week - b.week
}

/**
 * The pair as one opaque token, for a `<select>` value and a form field: `2026-W36`.
 *
 * One value rather than two controls, because the approved frame draws exactly one
 * dropdown (1ag, "Ugenummer") and because a week number without its year is ambiguous
 * for the two weeks of the year it matters most. The token is parsed back by
 * {@link parseIsoWeekToken}, which is where a submitted value stops being a string.
 */
export function formatIsoWeekToken(week: IsoWeek): string {
  return `${String(week.year)}-W${String(week.week).padStart(2, '0')}`
}

const TOKEN_PATTERN = /^(\d{4})-W(\d{2})$/

/** Read a `2026-W36` token, or `null` for anything that is not one that exists. */
export function parseIsoWeekToken(value: unknown): IsoWeek | null {
  if (typeof value !== 'string') return null

  const match = TOKEN_PATTERN.exec(value)
  if (match === null) return null

  const candidate: IsoWeek = { year: Number(match[1]), week: Number(match[2]) }

  return isValidIsoWeek(candidate) ? candidate : null
}
