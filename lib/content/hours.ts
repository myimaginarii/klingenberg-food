import 'server-only'

import { CACHE_TAGS } from '@/lib/cache/tags'
import { overlayDraft } from '@/lib/drafts/overlay'
import { openingHoursDraft } from '@/lib/schemas/opening-hours'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'

import { assertNoQueryError, columns, definePublicRead, type ContentAccess } from './source'

/**
 * Opening hours — technical plan §4, §7.
 *
 * The weekly schedule and the published future overrides, loaded together because
 * every consumer needs both: the open/closed badge, the footer hours, the Find os
 * table and the sold-out reset are all one question asked of the same two values.
 *
 * No decision is made here. Whether the restaurant is open, when it opens next and how
 * a day is worded all belong to `lib/hours` — the pure engine phase 2 built and
 * tested, which this loader feeds and never duplicates.
 *
 * WHAT A PREVIEW SEES
 *
 * A draft weekly schedule, and one-off overrides that have not been published yet.
 * Both are pending changes a staff member is about to make live, and preview exists so
 * they can see them in place first (§6). A visitor sees neither: RLS restricts the
 * public view of `opening_hours_overrides` to published rows dated today or later, and
 * the `status` filter on the published path states the same rule in the query so a
 * reader of this file does not have to go and check.
 */

export type OpeningHoursData = {
  schedule: WeeklySchedule
  overrides: OpeningHoursOverride[]
}

type ScheduleRow = { schedule: WeeklySchedule; draft?: unknown }

type OverrideRow = {
  date: string
  kind: 'closed' | 'custom'
  opens_at: string | null
  closes_at: string | null
  status: 'draft' | 'published'
}

/** Deduplicated per request: the badge, the footer and the sold-out rule all need it. */
export const readOpeningHours = definePublicRead(
  'opening-hours',
  [CACHE_TAGS.hours],
  async (access: ContentAccess): Promise<OpeningHoursData> => {
    let overridesQuery = access.database
      .from('opening_hours_overrides')
      .select('date, kind, opens_at, closes_at, status')

    if (!access.includeDrafts) {
      overridesQuery = overridesQuery.eq('status', 'published')
    }

    const [scheduleResult, overridesResult] = await Promise.all([
      access.database
        .from('opening_hours')
        .select(columns(access, 'schedule'))
        .maybeSingle<ScheduleRow>(),
      overridesQuery.order('date', { ascending: true }).returns<OverrideRow[]>(),
    ])

    assertNoQueryError('the opening hours', scheduleResult.error)
    assertNoQueryError('the opening-hours overrides', overridesResult.error)

    if (scheduleResult.data === null) {
      throw new Error(
        'The opening_hours singleton is missing. Run `npm run db:reset` locally, or ' +
          'set the weekly hours in the administration.',
      )
    }

    const { row } = overlayDraft<ScheduleRow>(
      scheduleResult.data,
      access.includeDrafts ? scheduleResult.data.draft : null,
      openingHoursDraft,
    )

    if (!row.schedule) {
      throw new Error(
        'The opening_hours singleton has no schedule. Run `npm run db:reset` locally, or ' +
          'set the weekly hours in the administration.',
      )
    }

    return {
      schedule: row.schedule,
      overrides: (overridesResult.data ?? []).map((override) => ({
        date: override.date,
        kind: override.kind,
        opensAt: override.opens_at,
        closesAt: override.closes_at,
        status: override.status,
      })),
    }
  },
)
