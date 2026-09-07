import {
  type IsoDate,
  type IsoTime,
  type WeekdayKey,
  WEEKDAY_KEYS,
  formatIsoTime,
  parseIsoDate,
  parseIsoTime,
  weekdayOf,
} from '@/lib/time/calendar'
import { copenhagenWallClock } from '@/lib/time/copenhagen'

import type { OpenState } from './engine'
import { readDaySchedule } from './schedule'
import type { DaySchedule, WeeklySchedule } from './types'

/**
 * Danish presentation of opening hours — technical plan §7, design 1e and 1ab.
 *
 * Formatting only. Every decision about *whether* the restaurant is open lives in
 * `./engine.ts`; this module turns an already-decided answer into Danish. It renders
 * no markup and knows nothing about React, so the same strings serve the public footer,
 * the open/closed badge and the hours table.
 *
 * Where a caller might reasonably want more than one presentation, the return value is
 * **structured** and carries the finished string alongside its parts — see
 * {@link describeOpenState}. Nothing here invents wording the approved design does not
 * contain: a closed badge gets `detail: null` rather than a sentence nobody signed off.
 *
 * The Danish weekday names are written out rather than taken from
 * `Intl.DateTimeFormat('da-DK')`. Seven words are not worth a dependency on the host's
 * ICU data, and the approved design fixes their exact abbreviated forms.
 */

/** The en dash the approved design uses in every range — "Ons–fre 15:00–20:00". */
const EN_DASH = '–'

const WEEKDAY_NAMES: Readonly<Record<WeekdayKey, { long: string; short: string }>> = {
  mon: { long: 'mandag', short: 'man' },
  tue: { long: 'tirsdag', short: 'tir' },
  wed: { long: 'onsdag', short: 'ons' },
  thu: { long: 'torsdag', short: 'tor' },
  fri: { long: 'fredag', short: 'fre' },
  sat: { long: 'lørdag', short: 'lør' },
  sun: { long: 'søndag', short: 'søn' },
}

export type WeekdayNameStyle = 'long' | 'short'

/** A run of consecutive weekdays that share the same hours. */
export type WeeklyHoursGroup =
  | { days: WeekdayKey[]; isOpen: false }
  | { days: WeekdayKey[]; isOpen: true; from: IsoTime; to: IsoTime }

/** One row of a grouped opening-hours table: "Ons–fre" / "15:00–20:00". */
export type WeeklyHoursRow = {
  days: string
  hours: string
  isOpen: boolean
}

/** One row of a seven-line opening-hours table: "Onsdag" / "15:00–20:00". */
export type DailyHoursRow = {
  weekday: WeekdayKey
  day: string
  hours: string
  isOpen: boolean
}

/** A next opening, in every form a caller is likely to need. */
export type NextOpeningDescription = {
  weekday: WeekdayKey
  date: IsoDate
  time: IsoTime
  /** "onsdag kl. 15:00" — the §7b wording for when an item becomes available again. */
  text: string
  instant: Date
}

/** The open/closed badge, as data plus the exact strings design 1e specifies. */
export type OpenStateDescription = {
  isOpen: boolean
  /** "Åbent nu" or "Lukket". */
  label: string
  /** "til kl. 20:00" while open; null when closed — the design shows no second line. */
  detail: string | null
  nextOpening: NextOpeningDescription | null
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** The Danish name of a weekday, lowercase as Danish orthography wants it. */
export function formatWeekdayName(weekday: WeekdayKey, style: WeekdayNameStyle): string {
  return WEEKDAY_NAMES[weekday][style]
}

/** "15:00–20:00". Accepts the seconds a Postgres `time` column carries. */
export function formatTimeRange(from: IsoTime, to: IsoTime): string {
  return `${formatIsoTime(parseIsoTime(from))}${EN_DASH}${formatIsoTime(parseIsoTime(to))}`
}

/** "Man–tir", "Ons–fre", or just "Ons" for a single day. */
function formatDayRange(days: readonly WeekdayKey[], style: WeekdayNameStyle): string {
  const first = days[0]
  const last = days[days.length - 1]

  /* v8 ignore next -- a group always holds at least one day. */
  if (first === undefined || last === undefined) return ''

  const start = capitalise(formatWeekdayName(first, style))
  if (first === last) return start

  return `${start}${EN_DASH}${formatWeekdayName(last, style)}`
}

/** Normalise a stored time so `15:00` and `15:00:00` compare and render the same. */
function normaliseTime(time: IsoTime): IsoTime {
  return formatIsoTime(parseIsoTime(time))
}

/** Does this day belong to the run the last group is collecting? */
function continuesGroup(group: WeeklyHoursGroup, day: DaySchedule): boolean {
  if ('closed' in day) return !group.isOpen

  return (
    group.isOpen &&
    group.from === normaliseTime(day.from) &&
    group.to === normaliseTime(day.to)
  )
}

function startGroup(weekday: WeekdayKey, day: DaySchedule): WeeklyHoursGroup {
  if ('closed' in day) return { days: [weekday], isOpen: false }

  return {
    days: [weekday],
    isOpen: true,
    from: normaliseTime(day.from),
    to: normaliseTime(day.to),
  }
}

/**
 * Collapse the week into runs of consecutive days with identical hours, Monday first.
 *
 * This is what turns the seven stored days into the two lines the design's footer
 * actually shows.
 */
export function groupWeeklyHours(schedule: WeeklySchedule): WeeklyHoursGroup[] {
  const groups: WeeklyHoursGroup[] = []

  for (const weekday of WEEKDAY_KEYS) {
    const day = readDaySchedule(schedule, weekday)
    const last = groups[groups.length - 1]

    if (last !== undefined && continuesGroup(last, day)) {
      last.days.push(weekday)
    } else {
      groups.push(startGroup(weekday, day))
    }
  }

  return groups
}

/** The grouped rows behind "Ons–fre  15:00–20:00". */
export function formatWeeklyHours(schedule: WeeklySchedule): WeeklyHoursRow[] {
  return groupWeeklyHours(schedule).map((group) => ({
    days: formatDayRange(group.days, 'short'),
    hours: group.isOpen ? formatTimeRange(group.from, group.to) : 'Lukket',
    isOpen: group.isOpen,
  }))
}

/** The same grouping as one line each: "Ons–fre 15:00–20:00", "Man–tir lukket". */
export function formatWeeklyHoursLines(schedule: WeeklySchedule): string[] {
  return formatWeeklyHours(schedule).map((row) =>
    // Mid-sentence, Danish leaves "lukket" lowercase; the two-column form capitalises it.
    row.isOpen ? `${row.days} ${row.hours}` : `${row.days} lukket`,
  )
}

/** All seven days spelled out — the hours table on Find os and in 1ab. */
export function formatDailyHours(schedule: WeeklySchedule): DailyHoursRow[] {
  return WEEKDAY_KEYS.map((weekday) => {
    const day = readDaySchedule(schedule, weekday)
    const isOpen = !('closed' in day)

    return {
      weekday,
      day: capitalise(formatWeekdayName(weekday, 'long')),
      hours: isOpen ? formatTimeRange(day.from, day.to) : 'Lukket',
      isOpen,
    }
  })
}

/** The Copenhagen wall-clock time of an instant: "15:00". */
export function formatCopenhagenClock(instant: Date): IsoTime {
  return copenhagenWallClock(instant).time
}

/** "til kl. 20:00" — the second half of the design's "Åbent nu · til kl. 20:00". */
export function formatOpenUntil(closesAt: Date): string {
  return `til kl. ${formatCopenhagenClock(closesAt)}`
}

/** "onsdag kl. 15:00" — the wording the §7b sold-out helper text is built from. */
export function formatWeekdayTime(instant: Date): string {
  const { time, weekday } = copenhagenWallClock(instant)
  return `${formatWeekdayName(weekday, 'long')} kl. ${time}`
}

/** "21.09" — the short Danish date the override screens use. */
export function formatShortDate(date: IsoDate): string {
  const { month, day } = parseIsoDate(date)
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`
}

/** "mandag 21.09". */
export function formatWeekdayDate(date: IsoDate): string {
  return `${formatWeekdayName(weekdayOf(date), 'long')} ${formatShortDate(date)}`
}

/** Turn an engine answer into the badge the design draws, plus its parts. */
export function describeOpenState(state: OpenState): OpenStateDescription {
  const nextOpening = state.nextOpening

  return {
    isOpen: state.isOpen,
    label: state.isOpen ? 'Åbent nu' : 'Lukket',
    detail: state.isOpen ? formatOpenUntil(state.closesAt) : null,
    nextOpening:
      nextOpening === null
        ? null
        : {
            weekday: nextOpening.weekday,
            date: nextOpening.date,
            time: nextOpening.from,
            text: formatWeekdayTime(nextOpening.opensAt),
            instant: nextOpening.opensAt,
          },
  }
}
