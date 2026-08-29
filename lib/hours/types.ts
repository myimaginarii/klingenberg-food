import type { IsoDate, IsoTime, WeekdayKey } from '@/lib/time/calendar'

/**
 * Opening-hours domain types — technical plan §4, §7.
 *
 * These describe the data **as the database already validates it**, so there is one
 * schema, not two. `opening_hours.schedule` is checked by
 * `public.is_valid_opening_schedule()` in the initial migration, and
 * `opening_hours_overrides` by its own CHECK constraints. The types here name that
 * same shape for TypeScript; they do not restate the validation, and no second
 * validator is introduced (§5 of the phase brief — Zod arrives in phase 4, and nothing
 * in this phase needs it).
 *
 * The pure functions still fail loudly on impossible input, because a value that
 * reaches them malformed came from a programmer, not from the database.
 */

/** One day of the weekly schedule: closed, or open between two wall-clock times. */
export type DaySchedule = { closed: true } | { from: IsoTime; to: IsoTime }

/**
 * The seven-day weekly schedule, exactly as stored in `opening_hours.schedule`.
 * Keys are the seven weekday abbreviations; the migration rejects any other set.
 */
export type WeeklySchedule = Readonly<Record<WeekdayKey, DaySchedule>>

/** `opening_hours_overrides.kind`. */
export type OverrideKind = 'closed' | 'custom'

/** `opening_hours_overrides.status`. Only published overrides affect the site. */
export type OverrideStatus = 'draft' | 'published'

/**
 * A one-off change to a single date, as stored in `opening_hours_overrides`.
 *
 * `status` is part of the domain type on purpose. "Only a published override changes
 * what the public sees" is a business rule (§6), and a rule that lives in the engine
 * cannot be forgotten by a caller that loads the wrong rows.
 */
export type OpeningHoursOverride = {
  date: IsoDate
  kind: OverrideKind
  /** Set for `kind: 'custom'`, null for `kind: 'closed'`. */
  opensAt: IsoTime | null
  /** Set for `kind: 'custom'`, null for `kind: 'closed'`. */
  closesAt: IsoTime | null
  status: OverrideStatus
}

/** Which rule decided a day's hours — the weekly schedule, or a one-off override. */
export type OpeningSource = 'weekly' | 'override'

/**
 * The effective hours for one Copenhagen calendar date, after overrides are applied.
 * Times are civil (`HH:MM`); turning them into instants is the engine's job.
 */
export type DayOpening = {
  date: IsoDate
  weekday: WeekdayKey
  /** Which rule decided this day — the weekly schedule, or a one-off override. */
  source: OpeningSource
} & ({ isOpen: false } | { isOpen: true; from: IsoTime; to: IsoTime })

/** One opening, resolved to absolute instants. */
export type OpeningInterval = {
  date: IsoDate
  weekday: WeekdayKey
  from: IsoTime
  to: IsoTime
  source: OpeningSource
  /** The instant the doors open. Inclusive. */
  opensAt: Date
  /** The instant the doors close. Exclusive — at exactly this instant they are shut. */
  closesAt: Date
}
