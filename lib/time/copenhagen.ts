import {
  type IsoDate,
  type IsoTime,
  type WeekdayKey,
  parseIsoDate,
  parseIsoTime,
  weekdayOf,
} from './calendar'

/**
 * The Copenhagen timezone boundary — technical plan §7.
 *
 * This is the **only** module in the repository that names a timezone, and the only
 * one that converts between an instant (`Date`) and a Copenhagen wall-clock reading.
 * Everything above it — the opening-hours engine, the sold-out rule, the Danish
 * formatters — works in civil values from `./calendar` or in instants, and never in
 * the host machine's local time.
 *
 * That is a deliberate constraint, not a stylistic one. `Date#getHours()`,
 * `Date#getDate()` and `new Date(y, m, d)` all read the machine's timezone, so a
 * single use anywhere above this line would make the site correct on a Copenhagen
 * laptop and wrong on a UTC server. Nothing outside this file uses them; the local-time
 * accessors do not appear above it at all.
 *
 * Conversion is done with `Intl.DateTimeFormat`, which carries the IANA rules for every
 * historic and future transition. No date library is needed for this, and none is used
 * (§1, adjustment 4).
 */

/** The business timezone. Stated once; imported everywhere else. */
export const COPENHAGEN_TIME_ZONE = 'Europe/Copenhagen'

const MS_PER_DAY = 86_400_000

/**
 * `hourCycle: 'h23'` rather than `hour12: false`: under `hour12: false` some ICU
 * builds render local midnight as hour "24", which would silently shift the date by a
 * day. `en-US` is a formatting locale only — the parts are read numerically and never
 * shown to anyone; the Danish presentation strings live in `lib/hours/format.ts`.
 */
const wallClockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: COPENHAGEN_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** A Copenhagen wall-clock reading of an instant. */
export type CopenhagenWallClock = {
  date: IsoDate
  time: IsoTime
  weekday: WeekdayKey
}

/**
 * Guard an instant at the edge of a pure function.
 *
 * An `Invalid Date` compares false against everything, so an unguarded one does not
 * throw — it quietly answers "no" to every question. On this site that would mean a
 * sold-out dish silently reappearing on the public menu, so every entry point that
 * takes a `now` checks it.
 */
export function assertValidInstant(instant: Date): void {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError(`Expected a valid instant (Date). Received: ${String(instant)}`)
  }
}

/**
 * The Copenhagen wall clock of an instant, expressed as epoch milliseconds *as if that
 * wall clock were UTC*.
 *
 * This is the pivot the whole module turns on: a wall clock is a civil value, and
 * reading it into the offset-free UTC number line is what makes it comparable and
 * subtractable. The result is never presented as an instant.
 */
function wallClockMsOf(instantMs: number): number {
  const parts = wallClockParts.formatToParts(new Date(instantMs))
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)
    /* v8 ignore next -- every requested field is present in the parts by construction. */
    if (part === undefined) throw new TypeError(`Intl did not supply the ${type} part.`)
    return Number(part.value)
  }

  return Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'))
}

/**
 * Copenhagen's UTC offset at a given instant, in milliseconds.
 * `+1h` during CET (winter), `+2h` during CEST (summer).
 */
export function copenhagenUtcOffsetMs(instant: Date): number {
  assertValidInstant(instant)
  const instantMs = instant.getTime()
  return wallClockMsOf(instantMs) - instantMs
}

/** Read an instant as a Copenhagen date, time of day and weekday. */
export function copenhagenWallClock(instant: Date): CopenhagenWallClock {
  assertValidInstant(instant)

  // The wall clock was encoded into the UTC number line by `wallClockMsOf`, so reading
  // it back out with `toISOString()` is the matching decode — not a UTC assumption.
  const wallClock = new Date(wallClockMsOf(instant.getTime())).toISOString()
  const date: IsoDate = wallClock.slice(0, 10)
  const time: IsoTime = wallClock.slice(11, 16)

  return { date, time, weekday: weekdayOf(date) }
}

/** The Copenhagen calendar date an instant falls on. */
export function copenhagenDateOf(instant: Date): IsoDate {
  return copenhagenWallClock(instant).date
}

/**
 * The instant at which a given Copenhagen wall clock occurs.
 *
 * A wall clock does not always identify exactly one instant, and both exceptions are
 * real days in Denmark:
 *
 * - **The gap** (last Sunday in March, 02:00 → 03:00). 02:30 never happens. The rule
 *   here is to move forward by the length of the gap, so 02:30 resolves to the instant
 *   whose wall clock reads 03:30. This is the convention `Temporal` calls
 *   `disambiguation: 'compatible'`, and it is what a person means by "half past two"
 *   on a day when half past two was skipped.
 * - **The repeat** (last Sunday in October, 03:00 → 02:00). 02:30 happens twice. The
 *   rule here is to take the **first** occurrence, so the clock never appears to run
 *   backwards across a sequence of wall-clock times.
 *
 * Neither case can arise from the restaurant's own data — the schema stores opening
 * times as `HH:MM` and the doors open in the afternoon — but a rule that is only
 * correct for the times we expect is not a rule. Both are pinned by tests.
 *
 * The two probe offsets are taken a day either side of the target, which brackets any
 * single transition, so the candidate set always contains the right answer.
 */
export function copenhagenInstantOf(date: IsoDate, time: IsoTime): Date {
  const { year, month, day } = parseIsoDate(date)
  const { hour, minute } = parseIsoTime(time)

  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute)

  const offsets = [
    copenhagenUtcOffsetMs(new Date(wallClockMs - MS_PER_DAY)),
    copenhagenUtcOffsetMs(new Date(wallClockMs + MS_PER_DAY)),
  ]

  const candidates = [...new Set(offsets.map((offset) => wallClockMs - offset))].sort(
    (a, b) => a - b,
  )

  // A candidate is real when reading it back gives the wall clock we started from.
  // An ambiguous wall clock produces two; a skipped wall clock produces none, and the
  // latest candidate is then the instant just past the end of the gap.
  const earliestReal = candidates.find((candidate) => wallClockMsOf(candidate) === wallClockMs)
  const latest = candidates[candidates.length - 1]

  /* v8 ignore next -- `candidates` always holds at least one entry. */
  if (latest === undefined) throw new TypeError(`No candidate instant for ${date} ${time}.`)

  return new Date(earliestReal ?? latest)
}
