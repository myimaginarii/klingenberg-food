import type { WeekdayKey } from '@/lib/time/calendar'

import { getOpenState } from './engine'
import { describeOpenState, formatWeekdayName } from './format'
import type { OpeningHoursOverride, WeeklySchedule } from './types'

/**
 * The open/closed badge as a serialisable value — technical plan §7a.
 *
 * The badge is rendered on the server and then corrected in the browser every minute,
 * so the same answer has to be reachable from both sides. This is that one answer: a
 * plain object of strings and a boolean, with no `Date` in it, which the server can
 * hand to a Client Component as props and the client can recompute from the same pure
 * engine.
 *
 * It adds no rule of its own. `getOpenState` decides, `describeOpenState` words it, and
 * this function only puts the result in a shape that survives serialisation — plus the
 * weekday the Forside hero prints after the badge ("Åbent nu · til kl. 20:00 · Onsdag",
 * 1g), which comes from the same resolved day rather than from a second clock reading.
 */
export type OpenStatusSnapshot = {
  isOpen: boolean
  /** "Åbent nu" or "Lukket". */
  label: string
  /** "til kl. 20:00" while open; null when closed — the design shows no second line. */
  detail: string | null
  /** "Onsdag" — the Copenhagen weekday `now` falls on. */
  todayLabel: string
  /** The same day as a schedule key, so an hours table can mark its own row. */
  todayWeekday: WeekdayKey
}

export function readOpenStatus(
  now: Date,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
): OpenStatusSnapshot {
  const state = getOpenState(now, schedule, overrides)
  const described = describeOpenState(state)
  const weekday = formatWeekdayName(state.today.weekday, 'long')

  return {
    isOpen: described.isOpen,
    label: described.label,
    detail: described.detail,
    todayLabel: weekday.charAt(0).toUpperCase() + weekday.slice(1),
    todayWeekday: state.today.weekday,
  }
}
