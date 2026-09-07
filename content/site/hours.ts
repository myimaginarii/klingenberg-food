import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'

/**
 * The confirmed weekly opening hours (design 1ab; `content/launch/launch-copy.md`,
 * "Åbningstider"): Monday and Tuesday closed, Wednesday–Friday 15:00–20:00,
 * Saturday–Sunday 17:00–20:00.
 *
 * No decision is made here. Whether the restaurant is open right now, when it opens
 * next and how a day is worded all belong to the pure engine in `lib/hours`, which
 * every badge, footer line and hours table reads through.
 *
 * `overrides` is the list of published one-off changes (a closed holiday, a shorter
 * evening). There are none; a future one is an entry here, in the shape
 * `{ date: 'YYYY-MM-DD', kind: 'closed', opensAt: null, closesAt: null, status: 'published' }`.
 */
export const OPENING_HOURS: {
  readonly schedule: WeeklySchedule
  readonly overrides: OpeningHoursOverride[]
} = {
  schedule: {
    mon: { closed: true },
    tue: { closed: true },
    wed: { from: '15:00', to: '20:00' },
    thu: { from: '15:00', to: '20:00' },
    fri: { from: '15:00', to: '20:00' },
    sat: { from: '17:00', to: '20:00' },
    sun: { from: '17:00', to: '20:00' },
  },
  overrides: [],
}
