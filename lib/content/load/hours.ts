import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'

import { readContentJson } from './source'

/**
 * The published opening hours — `content/site/hours.json`.
 *
 * The weekly schedule and the list of one-off overrides, in the shape `lib/hours`
 * already reads: seven weekday keys, each either `{ "closed": true }` or a `from`/`to`
 * pair, and an override as
 * `{ "date": "YYYY-MM-DD", "kind": "closed", "opensAt": null, "closesAt": null, "status": "published" }`.
 *
 * No decision is made here, exactly as before: whether the restaurant is open right
 * now, when it opens next and how a day is worded all belong to the pure engine in
 * `lib/hours`, which every badge, footer line and hours table reads through.
 */
export type OpeningHoursContent = {
  readonly schedule: WeeklySchedule
  readonly overrides: OpeningHoursOverride[]
}

export function loadOpeningHours(): OpeningHoursContent {
  return readContentJson<OpeningHoursContent>('hours.json')
}
