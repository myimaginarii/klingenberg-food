/**
 * Civil calendar values — technical plan §7.
 *
 * A *civil* date or time is a value on a wall calendar or a wall clock. It is not an
 * instant: "2026-03-29" and "15:00" do not identify a moment until a timezone is
 * applied. Turning them into a moment is the sole job of `lib/time/copenhagen.ts`;
 * this module deliberately contains no timezone, no offset and no `Intl` call, so
 * nothing here can pick up the machine's local time by accident.
 *
 * Dates are `YYYY-MM-DD` and times are `HH:MM`, which is exactly how the database
 * stores them (`opening_hours.schedule`, `dishes.sold_out_on`,
 * `opening_hours_overrides.opens_at`). Keeping the wire format as the domain format
 * means no conversion layer has to be trusted.
 *
 * The database already validates these shapes on write. The parsers here exist for the
 * other direction: a value that reaches a pure function malformed is a programmer
 * error, and must fail loudly rather than yield a plausible wrong answer.
 */

/** A calendar date with no timezone attached: `YYYY-MM-DD`. */
export type IsoDate = string

/** A time of day with no date and no timezone attached: `HH:MM`. */
export type IsoTime = string

/** A calendar date, decomposed. `month` is 1–12. */
export type CalendarDate = {
  year: number
  month: number
  day: number
}

/** A time of day, decomposed. */
export type ClockTime = {
  hour: number
  minute: number
}

/**
 * Weekday keys, in the order the schedule document and every Danish opening-hours
 * table use them: Monday first. `opening_hours.schedule` is keyed by exactly these
 * seven strings (see the `is_valid_opening_schedule` check in the initial migration).
 */
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

/** `Date.prototype.getUTCDay()` is Sunday-first; the schedule is Monday-first. */
const WEEKDAY_BY_UTC_DAY: readonly WeekdayKey[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
]

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

const MS_PER_DAY = 86_400_000

function fail(message: string, value: unknown): never {
  throw new TypeError(`${message} Received: ${JSON.stringify(value)}`)
}

/**
 * Epoch milliseconds for a civil date at 00:00 **UTC**.
 *
 * UTC is used purely as an arithmetic space: it has no daylight saving, so adding
 * 86 400 000 ms always advances the calendar by exactly one day. No value produced
 * here is ever presented as an instant — {@link addDays} converts straight back to a
 * civil date.
 */
function toUtcMidnight({ year, month, day }: CalendarDate): number {
  const ms = Date.UTC(year, month - 1, day)
  // `Date.UTC` maps years 0–99 onto 1900–1999. Our dates are four-digit, but the
  // correction removes the trap rather than relying on the input range.
  if (year >= 0 && year < 100) {
    const corrected = new Date(ms)
    corrected.setUTCFullYear(year)
    return corrected.getTime()
  }
  return ms
}

function fromUtcMidnight(ms: number): CalendarDate {
  const date = new Date(ms)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

/**
 * Parse a `YYYY-MM-DD` date, rejecting anything that is not a real calendar date.
 *
 * The round-trip check is what catches `2026-02-30` and `2026-02-29`: `Date.UTC`
 * silently rolls those forward, so the only reliable test is whether the value
 * survives the trip unchanged.
 */
export function parseIsoDate(value: IsoDate): CalendarDate {
  if (typeof value !== 'string') fail('Expected an ISO date string (YYYY-MM-DD).', value)

  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) fail('Expected an ISO date of the form YYYY-MM-DD.', value)

  const candidate: CalendarDate = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }

  if (formatIsoDate(fromUtcMidnight(toUtcMidnight(candidate))) !== value) {
    fail('Expected an ISO date that exists in the calendar.', value)
  }

  return candidate
}

/**
 * Is this a `YYYY-MM-DD` date that exists in the calendar?
 *
 * The predicate form of {@link parseIsoDate}, for the one place a malformed value is
 * *expected* rather than a programmer error: a date field somebody typed into. Every
 * other caller in this repository holds a value the database already validated, and for
 * those a throw is the right answer — which is why this is a second, narrow export
 * rather than a softening of the parser.
 */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false

  try {
    parseIsoDate(value)
    return true
  } catch {
    return false
  }
}

/** Render a calendar date as `YYYY-MM-DD`. */
export function formatIsoDate({ year, month, day }: CalendarDate): IsoDate {
  const pad = (part: number, width: number) => String(part).padStart(width, '0')
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

/**
 * Move a civil date by whole days.
 *
 * This is calendar arithmetic, not elapsed time: the Copenhagen days that are 23 and
 * 25 hours long are still exactly one day wide here, because the offset never enters
 * the calculation.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) fail('Expected a whole number of days.', days)
  return formatIsoDate(fromUtcMidnight(toUtcMidnight(parseIsoDate(date)) + days * MS_PER_DAY))
}

/**
 * Whole days from `from` to `to`, positive when `to` is the later date.
 *
 * The counterpart to {@link addDays}, and calendar arithmetic for the same reason: the
 * two dates are read into the UTC number line, which has no daylight saving, so the
 * difference is a whole number of calendar days rather than a number of elapsed hours
 * divided by 24. Copenhagen's 23- and 25-hour days do not enter the calculation.
 *
 * Added in phase 6A for the ISO-week helper, which numbers a week by counting whole
 * weeks from the Monday that starts week 1 (`lib/time/iso-week.ts`).
 */
export function differenceInDays(from: IsoDate, to: IsoDate): number {
  return (toUtcMidnight(parseIsoDate(to)) - toUtcMidnight(parseIsoDate(from))) / MS_PER_DAY
}

/** The schedule key for a civil date. */
export function weekdayOf(date: IsoDate): WeekdayKey {
  const utcDay = new Date(toUtcMidnight(parseIsoDate(date))).getUTCDay()
  const weekday = WEEKDAY_BY_UTC_DAY[utcDay]
  /* v8 ignore next -- getUTCDay() is always 0–6; the guard exists so the index access
     is total rather than asserted away. */
  if (weekday === undefined) fail('Unreachable: no weekday for date.', date)
  return weekday
}

/**
 * Parse `HH:MM`, or the `HH:MM:SS` form Postgres produces for a `time` column.
 *
 * A non-zero second is rejected rather than truncated. Opening hours are a wall-clock
 * concept measured in minutes; a stored `15:00:30` means something upstream is wrong,
 * and silently dropping the seconds would hide it.
 */
export function parseIsoTime(value: IsoTime): ClockTime {
  if (typeof value !== 'string') fail('Expected a time string (HH:MM).', value)

  const match = ISO_TIME_PATTERN.exec(value)
  if (!match) fail('Expected a time of the form HH:MM.', value)

  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = match[3] === undefined ? 0 : Number(match[3])

  if (hour > 23) fail('Expected a time with an hour of 00–23.', value)
  if (minute > 59) fail('Expected a time with a minute of 00–59.', value)
  if (second !== 0) fail('Expected a time on a whole minute; seconds are not modelled.', value)

  return { hour, minute }
}

/** Render a time of day as `HH:MM`. */
export function formatIsoTime({ hour, minute }: ClockTime): IsoTime {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Minutes since midnight — the only ordering defined on a time of day. */
export function minutesOfDay({ hour, minute }: ClockTime): number {
  return hour * 60 + minute
}
