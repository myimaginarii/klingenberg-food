import {
  type IsoDate,
  type IsoTime,
  type WeekdayKey,
  formatIsoTime,
  minutesOfDay,
  parseIsoDate,
  parseIsoTime,
  weekdayOf,
} from '@/lib/time/calendar'

import type {
  DayOpening,
  DaySchedule,
  OpeningHoursOverride,
  OpeningSource,
  WeeklySchedule,
} from './types'

/**
 * Which hours apply on a given date — technical plan §7.
 *
 * This is the single place where the weekly schedule and the one-off overrides are
 * combined. The open/closed badge, the next-opening lookup, the footer hours and the
 * sold-out reset all reach the answer through here, so no two surfaces of the site
 * can never disagree about whether a day is open (§7b).
 *
 * Everything is civil time: a date in, a date's hours out. No instant is produced and
 * no timezone is consulted — that happens one layer up, in `./engine.ts`.
 */

/** Published overrides, keyed by date. Built once, read many times during a scan. */
export type OverrideIndex = ReadonlyMap<IsoDate, OpeningHoursOverride>

/**
 * Index the overrides that actually affect the site.
 *
 * Draft overrides are dropped here rather than by the caller: "only a published
 * override is honoured" is a business rule (§6), and keeping it in the engine means a
 * loader that selects too many rows cannot quietly publish someone's draft.
 */
export function indexPublishedOverrides(
  overrides: readonly OpeningHoursOverride[],
): OverrideIndex {
  const index = new Map<IsoDate, OpeningHoursOverride>()

  for (const override of overrides) {
    if (override.status !== 'published') continue

    parseIsoDate(override.date)
    if (index.has(override.date)) {
      throw new TypeError(
        `More than one published opening-hours override for ${override.date}. ` +
          'The date column is UNIQUE, so this cannot come from the database.',
      )
    }

    index.set(override.date, override)
  }

  return index
}

/**
 * Read one weekday out of the schedule document.
 *
 * A missing day is a programmer error, not "closed": the database requires all seven
 * keys, so a gap means the wrong object was passed. Treating it as closed would hide
 * that behind a plausible answer. Shared with `./format.ts`, so both fail identically.
 */
export function readDaySchedule(schedule: WeeklySchedule, weekday: WeekdayKey): DaySchedule {
  const daySchedule: DaySchedule | undefined = schedule[weekday]

  if (daySchedule === undefined) {
    throw new TypeError(
      `The opening-hours schedule has no entry for "${weekday}". All seven weekdays are required.`,
    )
  }

  return daySchedule
}

/** The effective hours for one Copenhagen calendar date. */
export function resolveDayOpening(
  date: IsoDate,
  schedule: WeeklySchedule,
  overrides: OverrideIndex,
): DayOpening {
  // `weekdayOf` parses the date, so a malformed one fails here with the same message
  // it would anywhere else.
  const weekday = weekdayOf(date)

  const override = overrides.get(date)
  if (override !== undefined) {
    return fromOverride(date, weekday, override)
  }

  return fromDaySchedule(date, weekday, readDaySchedule(schedule, weekday))
}

function fromOverride(
  date: IsoDate,
  weekday: WeekdayKey,
  override: OpeningHoursOverride,
): DayOpening {
  if (override.kind === 'closed') {
    return { date, weekday, isOpen: false, source: 'override' }
  }

  if (override.opensAt === null || override.closesAt === null) {
    throw new TypeError(
      `A custom override must carry both an opening and a closing time (${date}).`,
    )
  }

  return openDay(date, weekday, override.opensAt, override.closesAt, 'override')
}

function fromDaySchedule(
  date: IsoDate,
  weekday: WeekdayKey,
  daySchedule: DaySchedule,
): DayOpening {
  if ('closed' in daySchedule) {
    return { date, weekday, isOpen: false, source: 'weekly' }
  }

  return openDay(date, weekday, daySchedule.from, daySchedule.to, 'weekly')
}

/**
 * Validate and normalise one open day.
 *
 * Times are normalised to `HH:MM`, so an override loaded from a Postgres `time`
 * column (`15:00:00`) and a weekly schedule entry (`15:00`) become the same value and
 * every consumer above this point sees one format.
 *
 * `from < to` is required, which is also what the database enforces. It means no
 * opening ever crosses midnight — an assumption the engine relies on when it decides
 * that only *today's* interval can contain *now*, so it is checked rather than
 * trusted.
 */
function openDay(
  date: IsoDate,
  weekday: WeekdayKey,
  opensAt: IsoTime,
  closesAt: IsoTime,
  source: OpeningSource,
): DayOpening {
  const from = parseIsoTime(opensAt)
  const to = parseIsoTime(closesAt)

  if (minutesOfDay(from) >= minutesOfDay(to)) {
    throw new RangeError(
      `Closing time must be after opening time on ${date}; got ${opensAt}–${closesAt}. ` +
        'Opening hours never cross midnight.',
    )
  }

  return {
    date,
    weekday,
    isOpen: true,
    from: formatIsoTime(from),
    to: formatIsoTime(to),
    source,
  }
}
