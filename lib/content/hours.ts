import 'server-only'

import { cache } from 'react'

import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'

import { assertNoQueryError, publicDatabase } from './source'

/**
 * Opening hours — technical plan §4, §7.
 *
 * The weekly schedule and the published future overrides, loaded together because
 * every consumer needs both: the open/closed badge, the footer hours, the Find os
 * table and the sold-out reset are all one question asked of the same two values.
 *
 * No decision is made here. Whether the restaurant is open, when it opens next and how
 * a day is worded all belong to `lib/hours` — the pure engine phase 2 built and tested,
 * which this loader feeds and never duplicates.
 *
 * The RLS policy already restricts the public view of `opening_hours_overrides` to
 * published rows dated today or later; the `status` filter here states the same rule in
 * the query, so a reader of this file does not have to go and check.
 */

export type OpeningHoursData = {
  schedule: WeeklySchedule
  overrides: OpeningHoursOverride[]
}

type OverrideRow = {
  date: string
  kind: 'closed' | 'custom'
  opens_at: string | null
  closes_at: string | null
  status: 'draft' | 'published'
}

/** Deduplicated per request: the badge, the footer and the sold-out rule all need it. */
export const readOpeningHours = cache(async (): Promise<OpeningHoursData> => {
  const database = publicDatabase()

  const [scheduleResult, overridesResult] = await Promise.all([
    database.from('opening_hours').select('schedule').maybeSingle<{ schedule: WeeklySchedule }>(),
    database
      .from('opening_hours_overrides')
      .select('date, kind, opens_at, closes_at, status')
      .eq('status', 'published')
      .order('date', { ascending: true })
      .returns<OverrideRow[]>(),
  ])

  assertNoQueryError('the opening hours', scheduleResult.error)
  assertNoQueryError('the opening-hours overrides', overridesResult.error)

  const schedule = scheduleResult.data?.schedule
  if (!schedule) {
    throw new Error(
      'The opening_hours singleton has no schedule. Run `npm run db:reset` locally, or ' +
        'set the weekly hours in the administration.',
    )
  }

  return {
    schedule,
    overrides: (overridesResult.data ?? []).map((row) => ({
      date: row.date,
      kind: row.kind,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      status: row.status,
    })),
  }
})
