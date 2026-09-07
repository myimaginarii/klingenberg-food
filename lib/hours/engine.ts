import { type IsoDate, addDays } from '@/lib/time/calendar'
import { copenhagenDateOf, copenhagenInstantOf } from '@/lib/time/copenhagen'

import { type OverrideIndex, indexPublishedOverrides, resolveDayOpening } from './schedule'
import type { DayOpening, OpeningHoursOverride, OpeningInterval, WeeklySchedule } from './types'

/**
 * The opening-hours engine — technical plan §7, §7b.
 *
 * Pure, and deliberately ignorant of everything around it: it takes a schedule, the
 * overrides and an instant, and returns values. It performs no query, reads no
 * environment variable, touches no React and mutates nothing it is given. That is what
 * lets one implementation serve the browser's "Åbent nu" badge, the
 * helper text, the footer hours and the sold-out reset — with no chance of the four
 * disagreeing (§7b).
 *
 * Two rules hold everywhere and are asserted by the tests:
 *
 * - **Opening is inclusive, closing is exclusive.** At 15:00 sharp the restaurant is
 *   open; at 20:00 sharp it is shut. "Åbent nu · til kl. 20:00" means exactly that.
 * - **An opening never crosses midnight** (`from < to`, enforced by the database and
 *   re-checked in `./schedule.ts`). Only *today's* interval can contain *now*, which
 *   is why "is it open?" needs to look at one day and not two.
 */

/**
 * How far forward a search for the next opening will look, in calendar days.
 *
 * Fixed by the plan (§7b). A restaurant with no opening day inside two months is not
 * a scheduling problem to be solved by scanning further — it is a situation the site
 * must show plainly ("Nulstilles ikke automatisk — I har ingen åbningsdage planlagt"),
 * so the search stops and says so.
 */
export const MAX_OPENING_SEARCH_DAYS = 60

/** Open now, or not — plus the context the badge and the hours table need. */
export type OpenState = {
  /** The Copenhagen date `now` falls on, and the hours that apply to it. */
  today: DayOpening
  /** The next opening beginning strictly after `now`, or null past the search cap. */
  nextOpening: OpeningInterval | null
} & (
  | {
      isOpen: true
      /** The instant the current service ends. */
      closesAt: Date
    }
  | {
      isOpen: false
      closesAt: null
    }
)

/** The effective hours for one Copenhagen calendar date. */
export function getDayOpening(
  date: IsoDate,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
): DayOpening {
  return resolveDayOpening(date, schedule, indexPublishedOverrides(overrides))
}

/**
 * Is the restaurant open at `now`, and when does it open next?
 *
 * `nextOpening` is resolved whether or not the restaurant is currently open, so a
 * caller never has to make a second call to answer "and when do they open again?".
 */
export function getOpenState(
  now: Date,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
): OpenState {
  const index = indexPublishedOverrides(overrides)
  const today = resolveDayOpening(copenhagenDateOf(now), schedule, index)
  const nextOpening = firstOpeningAfter(now, schedule, index, MAX_OPENING_SEARCH_DAYS)

  const current = toOpeningInterval(today)
  const isOpen =
    current !== null &&
    current.opensAt.getTime() <= now.getTime() &&
    now.getTime() < current.closesAt.getTime()

  return isOpen
    ? { today, isOpen: true, closesAt: current.closesAt, nextOpening }
    : { today, isOpen: false, closesAt: null, nextOpening }
}

/**
 * The first opening on or after `startDate`, within the search window.
 *
 * This is the primitive the sold-out reset is built on (§7b): "scan forward from
 * `sold_out_on + 1 day` for the first open day". The start date is included, because
 * that caller has already advanced past the date the item was marked.
 */
export function findFirstOpeningFrom(
  startDate: IsoDate,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
  maxDays: number = MAX_OPENING_SEARCH_DAYS,
): OpeningInterval | null {
  const index = indexPublishedOverrides(overrides)

  for (const opening of openingsFrom(startDate, schedule, index, maxDays)) {
    return opening
  }

  return null
}

/** The next opening that begins strictly after `now`, within the search window. */
export function findNextOpening(
  now: Date,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
  maxDays: number = MAX_OPENING_SEARCH_DAYS,
): OpeningInterval | null {
  return firstOpeningAfter(now, schedule, indexPublishedOverrides(overrides), maxDays)
}

function firstOpeningAfter(
  now: Date,
  schedule: WeeklySchedule,
  overrides: OverrideIndex,
  maxDays: number,
): OpeningInterval | null {
  // The scan starts today rather than tomorrow: the doors may not have opened yet.
  for (const opening of openingsFrom(copenhagenDateOf(now), schedule, overrides, maxDays)) {
    if (opening.opensAt.getTime() > now.getTime()) return opening
  }

  return null
}

/**
 * Every opening from `startDate` forward, one day at a time, up to the window.
 *
 * A generator so the single traversal of the schedule serves both "the first opening
 * from this date" and "the first opening after this instant" without either duplicating
 * the walk or paying for days it does not need.
 */
function* openingsFrom(
  startDate: IsoDate,
  schedule: WeeklySchedule,
  overrides: OverrideIndex,
  maxDays: number,
): Generator<OpeningInterval> {
  if (!Number.isInteger(maxDays) || maxDays < 1) {
    throw new RangeError(`The opening search window must be at least one day. Received: ${maxDays}`)
  }

  for (let offset = 0; offset < maxDays; offset += 1) {
    const day = resolveDayOpening(addDays(startDate, offset), schedule, overrides)
    const interval = toOpeningInterval(day)
    if (interval !== null) yield interval
  }
}

/**
 * Resolve a day's civil hours to absolute instants, or null when it is closed.
 *
 * This is the only place the engine crosses from civil time into instants, so the
 * Copenhagen conversion happens exactly once per open day.
 */
function toOpeningInterval(day: DayOpening): OpeningInterval | null {
  if (!day.isOpen) return null

  return {
    date: day.date,
    weekday: day.weekday,
    from: day.from,
    to: day.to,
    source: day.source,
    opensAt: copenhagenInstantOf(day.date, day.from),
    closesAt: copenhagenInstantOf(day.date, day.to),
  }
}
