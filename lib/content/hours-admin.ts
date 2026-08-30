import 'server-only'

import { cache } from 'react'

import { overlayDraft } from '@/lib/drafts/overlay'
import type { WeeklySchedule } from '@/lib/hours/types'
import { openingHoursDraft } from '@/lib/schemas/opening-hours'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The weekly opening hours as the owner edits them — design 1t; technical plan §4, §5, §6.
 *
 * A **separate read from the public one**, for the three reasons
 * `lib/content/monthly-admin.ts` and `lib/content/weekly-admin.ts` already set out, all
 * of which apply here word for word:
 *
 *   * **Never cached.** `lib/content/hours.ts` caches its read under the `hours` tag, and
 *     an editor served from that cache would hand a *stale* `updated_at` to the next save
 *     and turn optimistic concurrency (§6) into a lottery.
 *   * **Through the caller's own JWT**, so RLS decides what exists and what may be
 *     written. The administration never uses the anonymous client and never the
 *     service-role key. `opening_hours` is readable by any staff session and writable only
 *     by an owner (`opening_hours_update_owner`), which is the second, independent half of
 *     the §5 rule the page's `requireOwner()` states first.
 *   * **Both halves of the document.** The editor needs the schedule with the draft merged
 *     over it — what the seven rows show — *and* the published schedule underneath, which
 *     it needs twice over: to measure a real change against, so a draft holds only a
 *     changed document (§4), and to say **which days** are waiting, which is a statement
 *     about the difference between the two and cannot be read off either one alone.
 *
 * The overlay itself is not reimplemented: `overlayDraft` is the same function the preview
 * and the public site use, so the editor and Forhåndsvis can never disagree about what the
 * draft currently says.
 *
 * WHAT IS DELIBERATELY NOT READ HERE
 *
 * `opening_hours_overrides`. One-off dates are phase 8B, and this module is the weekly
 * schedule's own read: nothing in the 8A screen displays an override, decides anything
 * from one, or could write one. The public loader (`./hours.ts`) reads both because every
 * *public* consumer needs both — whether the restaurant is open right now is one question
 * asked of the two together — and that is exactly the difference between rendering the
 * hours and editing the recurring schedule.
 */

type OpeningHoursRow = {
  id: string
  schedule: WeeklySchedule
  updated_at: string
  draft: unknown
}

const ADMIN_COLUMNS = 'id, schedule, updated_at, draft'

export type AdminOpeningHours = {
  readonly id: string
  /** The version token every form on the screen submits back (§6). */
  readonly updatedAt: string
  /** The published schedule with the draft merged over it — what the editor shows. */
  readonly current: WeeklySchedule
  /** The published schedule — what a guest reads right now. */
  readonly live: WeeklySchedule
  readonly hasDraft: boolean
  /** True when a stored draft failed its schema and was therefore not applied. */
  readonly draftMalformed: boolean
}

/**
 * The singleton, ready to edit — or `null` when there is no row this caller may see.
 *
 * `cache()` deduplicates within one render pass: the bar's badge, the pending band and the
 * editor card all ask the same question. It expires with the request, so two requests
 * never share an answer — memoisation, not caching.
 */
export const readAdminOpeningHours = cache(async (): Promise<AdminOpeningHours | null> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('opening_hours')
    .select(ADMIN_COLUMNS)
    .maybeSingle<OpeningHoursRow>()

  if (error !== null) {
    throw new Error(`Could not read the opening hours for editing: ${error.message}`)
  }

  if (data === null) return null

  const { row, malformed } = overlayDraft<OpeningHoursRow>(data, data.draft, openingHoursDraft)

  return {
    id: data.id,
    updatedAt: data.updated_at,
    current: row.schedule,
    live: data.schedule,
    hasDraft: data.draft !== null && data.draft !== undefined,
    draftMalformed: malformed,
  }
})
