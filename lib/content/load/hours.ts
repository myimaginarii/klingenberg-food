import type {
  DaySchedule,
  OpeningHoursOverride,
  OverrideKind,
  OverrideStatus,
  WeeklySchedule,
} from '@/lib/hours/types'
import { WEEKDAY_KEYS, type IsoDate, type IsoTime, type WeekdayKey } from '@/lib/time/calendar'

import { validateHours } from '../validate/hours'
import { assertValid } from '../validate/problems'

import { contentPath, once, readContentJson } from './source'

/**
 * The published opening hours — `content/site/hours.json` (design 1ab;
 * `content/launch/launch-copy.md`, "Åbningstider").
 *
 * On disk every weekday is one uniform entry — `closed`, `from`, `to` — because that
 * is one form an editor fills in the same way seven times. The engine in `lib/hours`
 * reads a day as either `{ closed: true }` or a `from`/`to` pair, and that conversion
 * is the whole of this loader. `overrides` is the list of published one-off changes (a
 * closed holiday, a shorter evening), in the shape the engine already takes.
 *
 * No decision is made here. Whether the restaurant is open right now, when it opens
 * next and how a day is worded all belong to the pure engine in `lib/hours`, which
 * every badge, footer line and hours table reads through.
 */

type DayFile = { closed?: boolean; from?: IsoTime | null; to?: IsoTime | null }

type OverrideFile = {
  date: IsoDate
  kind: OverrideKind
  opensAt?: IsoTime | null
  closesAt?: IsoTime | null
  status: OverrideStatus
}

export type HoursFile = {
  schedule: Partial<Record<WeekdayKey, DayFile>>
  overrides?: OverrideFile[]
}

export type OpeningHours = {
  readonly schedule: WeeklySchedule
  readonly overrides: OpeningHoursOverride[]
}

function dayFrom(day: DayFile | undefined, where: string): DaySchedule {
  if (day === undefined) {
    throw new Error(`${where} is missing. Every weekday needs an entry.`)
  }
  if (day.closed === true) return { closed: true }
  if (!day.from || !day.to) {
    throw new Error(`${where}: an open day needs both "from" and "to", or "closed": true.`)
  }
  return { from: day.from, to: day.to }
}

/** The domain value one hours file means; `where` names the file in any refusal. */
export function openingHoursFrom(file: HoursFile, where: string): OpeningHours {
  const schedule = Object.fromEntries(
    WEEKDAY_KEYS.map((weekday) => [weekday, dayFrom(file.schedule[weekday], `${where}: schedule.${weekday}`)]),
  ) as Record<WeekdayKey, DaySchedule>

  const overrides = (file.overrides ?? []).map(
    (override): OpeningHoursOverride => ({
      date: override.date,
      kind: override.kind,
      opensAt: override.opensAt ?? null,
      closesAt: override.closesAt ?? null,
      status: override.status,
    }),
  )

  return { schedule, overrides }
}

export const loadOpeningHours = once((): OpeningHours => {
  const file = readContentJson<HoursFile>('hours.json')
  assertValid(validateHours(file, contentPath('hours.json')))

  return openingHoursFrom(file, contentPath('hours.json'))
})
