import 'server-only'

import { cache } from 'react'

import { overlayDraft } from '@/lib/drafts/overlay'
import type { OverrideContent } from '@/lib/hours/override-form'
import { overrideLifecycle, type OverrideLifecycle } from '@/lib/hours/override-form'
import type { OverrideStatus } from '@/lib/hours/types'
import { openingHoursOverrideDraft } from '@/lib/schemas/opening-hours'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { IsoDate } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

/**
 * The one-off overrides as staff edit them — design 1t (lower card); technical plan §4,
 * §5, §6, §7e.
 *
 * A **separate read from the public one**, for the three reasons `./hours-admin.ts`,
 * `./monthly-admin.ts` and `./weekly-admin.ts` already set out, all of which apply here
 * word for word:
 *
 *   * **Never cached.** `./hours.ts` caches its read under the `hours` tag, and an editor
 *     served from that cache would hand a *stale* `updated_at` to the next save and turn
 *     optimistic concurrency (§6) into a lottery.
 *   * **Through the caller's own JWT**, so RLS decides what exists and what may be
 *     written. `overrides_select_staff` is what makes a pending row visible here at all,
 *     and `overrides_insert_staff` / `_update_staff` / `_delete_staff` are what let a
 *     **staff** member — not only the owner — change one. That is the §5 matrix row this
 *     card is built around, and it is the database's rule before it is the screen's.
 *   * **Both halves of every row.** The card needs what is *live* on a date and what is
 *     *pending* for it, because §6's whole promise is that a guest goes on reading the
 *     first while somebody prepares the second.
 *
 * The overlay is not reimplemented: `overlayDraft` is the same function the preview and
 * the public loader use, so the editor and Forhåndsvis can never disagree about what the
 * draft currently says.
 *
 * WHY ONLY TODAY AND LATER
 *
 * §7e item 7: *"The date must be today or later."* The public policy says the same thing
 * from the other side — `overrides_select_public` hands a guest only rows dated today or
 * later — so a past row is one that no guest can read and no editor may create. Listing it
 * would be offering to edit something with no effect. The rows are left in place rather
 * than cleaned up: nothing in this system deletes data on a timer (§0a D2).
 *
 * WHAT IS DELIBERATELY NOT READ HERE
 *
 * **Whether this date owns the generated announcement.** That is
 * `announcement.source_override_id`, on the *announcement* row, and it is read by
 * `lib/announcements/generated-operation.ts` — never here. §4's original column for the
 * job, `opening_hours_overrides.announcement_created`, was dropped by 8C-3A because one
 * pointer that can be joined beats a boolean that has to be kept in step; the migration
 * `20260831180000_generated_announcement_ownership.sql` records why in full.
 *
 * So this loader reads the six columns below and no others, and the screen it feeds says
 * nothing about announcements at all — 1t's checkbox and 1ae's sheet are **8C-3B**.
 */

type OverrideRow = {
  id: string
  date: string
  kind: 'closed' | 'custom'
  opens_at: string | null
  closes_at: string | null
  status: OverrideStatus
  updated_at: string
  draft: unknown
}

const ADMIN_COLUMNS = 'id, date, kind, opens_at, closes_at, status, updated_at, draft'

/** Postgres returns a `time` as `HH:MM:SS`; the domain and the schema speak `HH:MM`. */
function toClockTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5)
}

export type AdminOverride = {
  readonly id: string
  readonly date: IsoDate
  /** The version token every form on the card submits back (§6). */
  readonly updatedAt: string
  /** Where this date is in its lifecycle — the four states the model can hold. */
  readonly lifecycle: OverrideLifecycle
  /**
   * The three content **columns**, before any draft is applied.
   *
   * This is what a Gem measures its delta against, whatever the lifecycle — which is what
   * makes "a draft holds only the changed fields" (§4) literally true here: an edit taken
   * back to what the row already holds leaves no draft behind, so the Kladde badge and the
   * dashboard count cannot claim a change the database does not hold. For a published row
   * it is also {@link live}; for one that has never been live it is the values the
   * creation wrote, which is what publishing it would make live.
   */
  readonly stored: OverrideContent
  /** What a guest reads on this date right now, or `null` while it has never been live. */
  readonly live: OverrideContent | null
  /** The columns with the draft merged over them — what the card shows. */
  readonly current: OverrideContent
  /** True when a stored draft failed its schema and was therefore not applied. */
  readonly draftMalformed: boolean
}

function toAdminOverride(row: OverrideRow): AdminOverride {
  const columns: OverrideContent = {
    kind: row.kind,
    opens_at: toClockTime(row.opens_at),
    closes_at: toClockTime(row.closes_at),
  }

  const { row: merged, malformed } = overlayDraft<OverrideContent>(
    columns,
    row.draft,
    openingHoursOverrideDraft,
  )

  return {
    id: row.id,
    date: row.date,
    updatedAt: row.updated_at,
    lifecycle: overrideLifecycle({
      status: row.status,
      hasDraft: row.draft !== null && row.draft !== undefined,
    }),
    stored: columns,
    // A row that has never been published has no live answer at all: its own columns are
    // the pending values, and a guest reads the weekly schedule for that date.
    live: row.status === 'published' ? columns : null,
    current: merged,
    draftMalformed: malformed,
  }
}

/**
 * Every one-off change from today onwards, earliest first.
 *
 * `cache()` deduplicates within one render pass: the card, the list beneath it and the
 * removal control all ask the same question. It expires with the request, so two requests
 * never share an answer — memoisation, not caching.
 */
export const readAdminOverrides = cache(async (): Promise<AdminOverride[]> => {
  const supabase = await createSupabaseServerClient()
  const today = copenhagenDateOf(new Date())

  const { data, error } = await supabase
    .from('opening_hours_overrides')
    .select(ADMIN_COLUMNS)
    .gte('date', today)
    .order('date', { ascending: true })
    .returns<OverrideRow[]>()

  if (error !== null) {
    throw new Error(`Could not read the one-off opening hours for editing: ${error.message}`)
  }

  return (data ?? []).map(toAdminOverride)
})

/**
 * The override on one date, or `null` when that date follows the weekly schedule.
 *
 * Read from the list rather than with a second query, so the card and the list beneath it
 * can never describe the same date differently — and so a date the list excludes (a past
 * one) is a date this cannot return either.
 */
export async function readAdminOverrideOn(date: IsoDate): Promise<AdminOverride | null> {
  return (await readAdminOverrides()).find((override) => override.date === date) ?? null
}
