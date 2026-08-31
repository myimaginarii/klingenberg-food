import type { IsoTime } from '@/lib/time/calendar'

/**
 * The wall-clock choices an opening-hours control offers — design 1t; technical plan §7.
 *
 * 1t draws four time dropdowns and says of them, once, that *"Tider vælges i
 * kvarter-spring"*. Both of the screen's cards obey that sentence — the seven weekday rows
 * of the recurring schedule (phase 8A) and the two fields of a one-off override (phase 8B)
 * — so the grid, the "is this a time at all?" test and the rule for a stored value that is
 * *not* on the grid live here, once, rather than in each editor.
 *
 * This module is a **control primitive, not a business rule**, and the distinction is the
 * whole reason it is separate:
 *
 *   * the quarter-hour grid is what a `<select>` offers, and nothing more. The column, the
 *     CHECK, the Zod schemas and the phase-2 engine all accept any `HH:MM`, so a server
 *     that refused `15:20` would invent a restriction the rest of the system does not have
 *     — and would make an existing off-grid value unsaveable;
 *   * which times are *valid together* — a closing after its opening, a closed day with no
 *     times at all — belongs to whichever editor is asking, because the two editors word
 *     the refusal differently ("om onsdagen", "den dag") and bind it to different fields.
 *
 * Sharing this and not that is what keeps the recurring editor and the one-off editor from
 * becoming one editor with a mode flag. They share a dropdown; they share no rule.
 */

const MINUTES_PER_QUARTER = 15
const QUARTERS_PER_DAY = (24 * 60) / MINUTES_PER_QUARTER

/**
 * `00:00`, `00:15`, … `23:45` — 1t's "kvarter-spring", as a select's options.
 *
 * Built once, at module load, and handed out frozen: the recurring editor renders fourteen
 * of these selects on every request, and ninety-six strings that never change are not worth
 * recomputing fourteen times a page. Callers that need the grid *plus* a stored off-grid
 * value get a fresh array from {@link timeChoicesFor}.
 */
const QUARTER_HOURS: readonly IsoTime[] = Object.freeze(
  Array.from({ length: QUARTERS_PER_DAY }, (_, index) => {
    const minutes = index * MINUTES_PER_QUARTER

    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }),
)

export function quarterHourChoices(): readonly IsoTime[] {
  return QUARTER_HOURS
}

const CLOCK_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

/** Is this a wall-clock time the schemas and the column would accept? */
export function isClockTime(value: string): value is IsoTime {
  return CLOCK_TIME.test(value)
}

/**
 * The quarter-hour grid, plus `current` when it is a valid time that is not on it.
 *
 * A select can only submit what it offers, so a select built from the grid alone would
 * turn an existing `15:20` into `00:00` the moment somebody saved an unrelated field. The
 * stored value is therefore always offered, in its place in the day, and the grid is a
 * convenience rather than a filter. A blank or malformed `current` adds nothing.
 */
export function timeChoicesFor(current: string): readonly IsoTime[] {
  if (!isClockTime(current) || QUARTER_HOURS.includes(current)) return QUARTER_HOURS

  return [...QUARTER_HOURS, current].sort()
}
