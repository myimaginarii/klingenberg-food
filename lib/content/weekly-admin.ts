import 'server-only'

import { cache } from 'react'

import { overlayDraft } from '@/lib/drafts/overlay'
import type { WeeklySpecialValues } from '@/lib/menu/weekly'
import { weeklySpecialDraft } from '@/lib/schemas/specials'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { IsoDate, WeekdayKey } from '@/lib/time/calendar'

/**
 * Ugens ret and Lørdagsmenu as staff edit them — design 1ag; technical plan §4, §6.
 *
 * A **separate read from the public one**, for the reasons `lib/content/menu-admin.ts`
 * already sets out for dishes and which apply here word for word:
 *
 *   * **Never cached.** `lib/content/menu.ts` caches its weekly read under the `weekly`
 *     tag; an editor served from that cache would hand a *stale* `updated_at` to the
 *     next save and turn optimistic concurrency (§6) into a lottery.
 *   * **Through the staff member's own JWT**, so RLS decides what exists. The
 *     administration never uses the anonymous client and never the service-role key.
 *   * **Both halves of every field.** The editor needs the values with the draft merged
 *     over them (what it shows) *and* the published values underneath (what it measures
 *     a real change against, so a draft holds only the changed fields — §4).
 *
 * The overlay itself is not reimplemented: `overlayDraft` is the same function the
 * preview and the public menu use, so the editor and Forhåndsvis can never disagree
 * about what the draft currently says.
 *
 * THE TWO SOLD-OUT COLUMNS ARE READ, AND ONLY READ
 *
 * `sold_out_on` and `sat_sold_out_on` are not fields of `weeklySpecialDraft` and are
 * therefore not part of {@link WeeklySpecialValues} — a draft cannot carry either of
 * them, which is exactly what §6's immediate path requires. They are returned beside
 * the values, from the **live** row, because the two switches in 1ag have to show what
 * is true of the hjemmeside right now rather than what a draft proposes.
 */

type WeeklyRow = {
  id: string
  iso_year: number | null
  iso_week: number | null
  days: string[] | null
  name: string | null
  description: string | null
  price_small_ore: number | null
  price_large_ore: number | null
  image_id: string | null
  sold_out_on: string | null
  sat_enabled: boolean
  sat_name: string | null
  sat_description: string | null
  sat_price_ore: number | null
  sat_deadline: string | null
  sat_sold_out_on: string | null
  updated_at: string
  draft: unknown
}

const WEEKLY_ADMIN_COLUMNS =
  'id, iso_year, iso_week, days, name, description, price_small_ore, price_large_ore, image_id, sold_out_on, sat_enabled, sat_name, sat_description, sat_price_ore, sat_deadline, sat_sold_out_on, updated_at, draft'

export type AdminWeeklySpecial = {
  readonly id: string
  /** The version token every form on the screen submits back (§6). */
  readonly updatedAt: string
  /** Live values with the draft merged over them — what the editor shows. */
  readonly current: WeeklySpecialValues
  /** The published values — what a guest sees right now. */
  readonly live: WeeklySpecialValues
  /** Ugens ret's own Udsolgt state. The immediate path; never a draft field (§6). */
  readonly soldOutOn: IsoDate | null
  /** Lørdagsmenuens Udsolgt state. Its own column, its own switch. */
  readonly saturdaySoldOutOn: IsoDate | null
  readonly hasDraft: boolean
  /** The editable fields the stored draft actually changes, in schema order. */
  readonly draftFields: readonly string[]
  /** True when a stored draft failed its schema and was therefore not applied. */
  readonly draftMalformed: boolean
}

/**
 * The `days` column as the domain speaks about it.
 *
 * The database CHECK already restricts the array to the seven schedule keys, so this is
 * a narrowing rather than a validation — and an unexpected value is dropped rather than
 * rendered, because a chip nobody can name is worse than a chip that is missing.
 */
function toWeekdays(days: string[] | null): readonly WeekdayKey[] {
  const known: readonly string[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

  return (days ?? []).filter((day): day is WeekdayKey => known.includes(day))
}

function toValues(row: WeeklyRow): WeeklySpecialValues {
  return {
    iso_year: row.iso_year,
    iso_week: row.iso_week,
    days: toWeekdays(row.days),
    name: row.name,
    description: row.description,
    price_small_ore: row.price_small_ore,
    price_large_ore: row.price_large_ore,
    image_id: row.image_id,
    sat_enabled: row.sat_enabled,
    sat_name: row.sat_name,
    sat_description: row.sat_description,
    sat_price_ore: row.sat_price_ore,
    sat_deadline: row.sat_deadline,
  }
}

/**
 * The singleton, ready to edit — or `null` when there is no row this caller may see.
 *
 * `cache()` deduplicates within one render pass: the screen, both editors, the pending
 * band and the copy control all ask the same question. It expires with the request, so
 * two requests never share an answer — memoisation, not caching.
 */
export const readAdminWeeklySpecial = cache(async (): Promise<AdminWeeklySpecial | null> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('weekly_special')
    .select(WEEKLY_ADMIN_COLUMNS)
    .maybeSingle<WeeklyRow>()

  if (error !== null) {
    throw new Error(`Could not read Ugens ret for editing: ${error.message}`)
  }

  if (data === null) return null

  const { row, changedFields, malformed } = overlayDraft<WeeklyRow>(
    data,
    data.draft,
    weeklySpecialDraft,
  )

  return {
    id: data.id,
    updatedAt: data.updated_at,
    current: toValues(row),
    live: toValues(data),
    // From the live row in both cases: neither column is draftable, and the switches
    // report the hjemmeside rather than the draft.
    soldOutOn: data.sold_out_on as IsoDate | null,
    saturdaySoldOutOn: data.sat_sold_out_on as IsoDate | null,
    hasDraft: data.draft !== null && data.draft !== undefined,
    draftFields: changedFields,
    draftMalformed: malformed,
  }
})
