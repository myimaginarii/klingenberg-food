import { getOpenState } from '@/lib/hours/engine'
import { formatWeekdayName } from '@/lib/hours/format'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { addDays, isIsoDate, type IsoDate, type IsoTime } from '@/lib/time/calendar'
import { copenhagenInstantOf, copenhagenWallClock } from '@/lib/time/copenhagen'

import { parseExpiryInstant } from './expiry'

/**
 * The editor's half of the expiry — design 1ad.
 *
 * `./expiry.ts` owns the rule a stored instant obeys, and imports nothing so the client
 * guard can share it. This module owns what the *editing screen* needs, which is a
 * different and much heavier question: 1ad draws a **date** field and a **time** field,
 * and a person typing into them means Copenhagen wall clock — "søndag 14.09.2026",
 * "20:00". Converting that pair to the instant it names, and back, is
 * {@link announcementExpiryInstant} and {@link announcementExpiryFields}, each one call
 * to `lib/time/copenhagen.ts` and no arithmetic of its own. That module already resolves
 * both daylight-saving edge cases — the skipped hour in March, the repeated hour in
 * October — and is tested for them in phase 2; nothing here re-implements a minute of it.
 *
 * THE SUGGESTIONS (1ad's CHIPS)
 *
 * 1ad draws a row of suggested expiries under the two fields — "Når vi lukker søndag",
 * "I aften kl. 20:00", "Om en uge", "Vælg selv". They are an editing convenience and
 * nothing else: each is a *value the fields could have held*, computed from the published
 * opening hours and one instant, and each goes through the same parse and the same
 * validation as a date somebody typed. A suggestion cannot carry a value the fields could
 * not, and choosing one publishes nothing.
 *
 * Three ship rather than four, because two of the four are the same instant said twice.
 * "Når vi lukker søndag" and "I aften kl. 20:00" both name **the next closing time**, and
 * which sentence is true depends on whether that closing is today — so the closing
 * suggestion words itself from the instant it found ("Når vi lukker i dag kl. 20:00" or
 * "Når vi lukker søndag kl. 20:00") and the frame's two chips become one chip that is
 * right in either case. "Om en uge" and "Vælg selv" are unchanged.
 *
 * Nothing here is *applied* by this module. It returns values; the editor renders them as
 * choices and the server reads back which one a person chose.
 */

/** A civil reading of an expiry instant, as 1ad's two fields hold it. */
export type AnnouncementExpiryFields = {
  /** `YYYY-MM-DD`, Copenhagen-local — the value of an `input type="date"`. */
  readonly date: IsoDate
  /** `HH:MM`, Copenhagen-local — the value of an `input type="time"`. */
  readonly time: IsoTime
}

/**
 * The instant a Copenhagen wall-clock date and time name.
 *
 * `copenhagenInstantOf` owns both daylight-saving conventions (§7's "compatible"
 * disambiguation forward through the March gap, earliest occurrence in the October
 * repeat), so an expiry typed on either Sunday resolves to a real instant rather than to
 * an invalid one.
 */
export function announcementExpiryInstant(date: IsoDate, time: IsoTime): Date {
  return copenhagenInstantOf(date, time)
}

/** The same instant read back as the two fields, so the editor round-trips exactly. */
export function announcementExpiryFields(expiresAt: Date): AnnouncementExpiryFields {
  const wallClock = copenhagenWallClock(expiresAt)
  return { date: wallClock.date, time: wallClock.time }
}

// ---------------------------------------------------------------------------
// 1ad's suggestions
// ---------------------------------------------------------------------------

/** Which suggestion a person chose. `custom` means "use the two fields as typed". */
export type AnnouncementExpiryChoice = 'closing' | 'week' | 'custom'

export const ANNOUNCEMENT_EXPIRY_CHOICES: readonly AnnouncementExpiryChoice[] = [
  'closing',
  'week',
  'custom',
]

/** True when `value` names one of the three choices. */
export function isAnnouncementExpiryChoice(
  value: unknown,
): value is AnnouncementExpiryChoice {
  return (
    typeof value === 'string' &&
    (ANNOUNCEMENT_EXPIRY_CHOICES as readonly string[]).includes(value)
  )
}

/** One chip: what it says, and the instant it stands for. */
export type AnnouncementExpirySuggestion = {
  readonly choice: Exclude<AnnouncementExpiryChoice, 'custom'>
  /** The Danish sentence on the chip. */
  readonly label: string
  readonly instant: Date
}

/** How many days "Om en uge" is. Stated once. */
const A_WEEK_IN_DAYS = 7

/**
 * "Når vi lukker …" — the next closing instant, worded from the day it falls on.
 *
 * Two cases, and the difference is exactly the difference between 1ad's first two chips:
 * the doors are open now, so the closing is *today*; or they are shut, so the closing is
 * the end of the **next** opening. Past the engine's 60-day search window there is no
 * opening at all — a schedule with every day closed — and the suggestion is simply absent
 * rather than invented.
 */
function closingSuggestion(
  now: Date,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
): AnnouncementExpirySuggestion | null {
  const state = getOpenState(now, schedule, overrides)

  const closesAt = state.isOpen ? state.closesAt : (state.nextOpening?.closesAt ?? null)
  if (closesAt === null) return null

  const closing = copenhagenWallClock(closesAt)
  const today = copenhagenWallClock(now).date

  const day = closing.date === today ? 'i dag' : formatWeekdayName(closing.weekday, 'long')

  return {
    choice: 'closing',
    label: `Når vi lukker ${day} kl. ${closing.time}`,
    instant: closesAt,
  }
}

/**
 * "Om en uge" — the same wall clock, seven Copenhagen days later.
 *
 * Seven *calendar* days rather than 7 × 24 hours, so a suggestion made in the week of a
 * daylight-saving change still reads back as the same time of day. The civil date is
 * advanced by `addDays` and handed back to `copenhagenInstantOf`, which is the only
 * pairing in this repository that survives both transitions.
 */
function weekSuggestion(now: Date): AnnouncementExpirySuggestion {
  const { date, time } = announcementExpiryFields(now)

  return {
    choice: 'week',
    label: 'Om en uge',
    instant: announcementExpiryInstant(addDays(date, A_WEEK_IN_DAYS), time),
  }
}

/**
 * The chips 1ad draws, for this instant and these published hours.
 *
 * Order is the frame's: the closing time first, because it is the one a shift-time
 * message almost always wants, then the week. "Vælg selv" is not in this list — it is the
 * absence of a suggestion, and the editor renders it as the choice that uses the two
 * fields exactly as typed.
 */
export function announcementExpirySuggestions(
  now: Date,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
): readonly AnnouncementExpirySuggestion[] {
  const closing = closingSuggestion(now, schedule, overrides)

  return closing === null ? [weekSuggestion(now)] : [closing, weekSuggestion(now)]
}

/**
 * Which chip, if any, a stored expiry currently matches.
 *
 * The row holds one instant and no record of how it was produced, which is the right
 * thing to store — the value is a time, not a choice. So the checked chip is recomputed:
 * a stored expiry that is still exactly the instant a suggestion names shows that chip as
 * chosen (1ad draws one with a tick), and anything else shows "Vælg selv", which is the
 * honest description of a date somebody typed, or of a suggestion the opening hours have
 * since moved.
 */
export function matchingExpiryChoice(
  expiresAt: string | null,
  suggestions: readonly AnnouncementExpirySuggestion[],
): AnnouncementExpiryChoice {
  const instant = parseExpiryInstant(expiresAt)
  if (instant === null) return 'custom'

  const match = suggestions.find(
    (suggestion) => suggestion.instant.getTime() === instant.getTime(),
  )

  return match?.choice ?? 'custom'
}

/** The instant a choice stands for, or `null` when the editor's own fields decide. */
export function instantForChoice(
  choice: AnnouncementExpiryChoice,
  suggestions: readonly AnnouncementExpirySuggestion[],
): Date | null {
  if (choice === 'custom') return null

  return suggestions.find((suggestion) => suggestion.choice === choice)?.instant ?? null
}

/** True when a string is a civil date this editor will accept. */
export function isExpiryDate(value: string): value is IsoDate {
  return isIsoDate(value)
}

/** `HH:MM`, the shape an `input type="time"` submits. Seconds are not accepted. */
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isExpiryTime(value: string): value is IsoTime {
  return CLOCK_PATTERN.test(value)
}
