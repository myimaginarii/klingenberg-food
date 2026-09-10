import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import type { WeekdayKey } from '@/lib/time/calendar'

/**
 * Shared opening-hours fixtures.
 *
 * `CONFIRMED_SCHEDULE` is the restaurant's real, owner-confirmed schedule (design 1ab,
 * tracked in `content/site/hours.json`): Monday and Tuesday closed, Wednesday–Friday
 * 15:00–20:00, Saturday–Sunday 17:00–20:00. Every worked example in technical plan §7b
 * is stated against it, so the tests use the same data the site will.
 */
export const CONFIRMED_SCHEDULE: WeeklySchedule = {
  mon: { closed: true },
  tue: { closed: true },
  wed: { from: '15:00', to: '20:00' },
  thu: { from: '15:00', to: '20:00' },
  fri: { from: '15:00', to: '20:00' },
  sat: { from: '17:00', to: '20:00' },
  sun: { from: '17:00', to: '20:00' },
}

/** A schedule with no opening day at all — the 60-day-cap case (§7b). */
export const ALWAYS_CLOSED_SCHEDULE: WeeklySchedule = {
  mon: { closed: true },
  tue: { closed: true },
  wed: { closed: true },
  thu: { closed: true },
  fri: { closed: true },
  sat: { closed: true },
  sun: { closed: true },
}

/** A published one-off closure. */
export function closedOverride(date: string): OpeningHoursOverride {
  return { date, kind: 'closed', opensAt: null, closesAt: null, status: 'published' }
}

/** A published one-off change of hours — including opening a normally closed day. */
export function customOverride(date: string, opensAt: string, closesAt: string): OpeningHoursOverride {
  return { date, kind: 'custom', opensAt, closesAt, status: 'published' }
}

/**
 * A schedule with one weekday missing.
 *
 * The database cannot produce this — `is_valid_opening_schedule()` requires all seven
 * keys — so it exists only to prove the pure functions refuse it loudly instead of
 * treating a missing day as closed.
 */
export function withoutWeekday(schedule: WeeklySchedule, weekday: WeekdayKey): WeeklySchedule {
  const incomplete: Record<string, unknown> = { ...schedule }
  delete incomplete[weekday]
  return incomplete as unknown as WeeklySchedule
}
