import 'server-only'

import { CACHE_TAGS } from '@/lib/cache/tags'
import { overlayDraft } from '@/lib/drafts/overlay'
import { openingHoursDraft, openingHoursOverrideDraft } from '@/lib/schemas/opening-hours'
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
 * A draft weekly schedule, and one-off overrides **as publishing them would leave them**:
 * a row that has never been live, and the pending edit sitting on a row that is (phase
 * 8B). Both are changes a staff member is about to make, and preview exists so they can
 * see them in place first (§6).
 *
 * That is the same "as if published" contract `overlayDraft` gives every other entity,
 * applied to a table whose pending state is a `status` **and** a `draft` column. It is
 * resolved here, in the loader, rather than in the engine — which is why each row the
 * preview path returns is reported as `published`: it is what a guest would read if
 * somebody pressed Offentliggør now, and `resolveDayOpening` has one rule for applying an
 * override rather than two.
 *
 * A visitor sees none of it. RLS restricts the public view of `opening_hours_overrides` to
 * published rows dated today or later; the `status` filter on the published path states
 * the same rule in the query so a reader of this file does not have to go and check; and
 * `indexPublishedOverrides` in the engine drops a non-published row a third time, so a
 * loader that one day selected too much still could not publish somebody's draft to a
 * guest. `draft` is not a column `anon` holds a grant on at all, so the published path
 * does not — and could not — name it.
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
  draft?: unknown
}

const OVERRIDE_COLUMNS = 'date, kind, opens_at, closes_at, status'

/**
 * One override row, resolved for the access path that read it.
 *
 * On the published path there is no draft to apply and `status` is already `published`,
 * so this is a rename. On the preview path the draft is merged with the same
 * `overlayDraft` the editor and every other preview use — a field the draft does not
 * mention keeps its live value, a field present with `null` clears it, and a draft that
 * does not parse is not applied at all — and the result is reported as `published`,
 * because that is what it would be.
 */
function toOverride(row: OverrideRow, includeDrafts: boolean): OpeningHoursOverride {
  const { row: merged } = overlayDraft<OverrideRow>(
    row,
    includeDrafts ? row.draft : null,
    openingHoursOverrideDraft,
  )

  return {
    date: merged.date,
    kind: merged.kind,
    opensAt: merged.opens_at,
    closesAt: merged.closes_at,
    status: includeDrafts ? 'published' : merged.status,
  }
}

/** Deduplicated per request: the badge, the footer and the sold-out rule all need it. */
export const readOpeningHours = definePublicRead(
  'opening-hours',
  [CACHE_TAGS.hours],
  async (access: ContentAccess): Promise<OpeningHoursData> => {
    let overridesQuery = access.database
      .from('opening_hours_overrides')
      .select(columns(access, OVERRIDE_COLUMNS))

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
      overrides: (overridesResult.data ?? []).map((override) =>
        toOverride(override, access.includeDrafts),
      ),
    }
  },
)
