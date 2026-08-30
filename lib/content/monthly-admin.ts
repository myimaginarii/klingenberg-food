import 'server-only'

import { cache } from 'react'

import { overlayDraft } from '@/lib/drafts/overlay'
import type { MonthlyBurgerValues } from '@/lib/menu/monthly'
import { monthlyBurgerDraft } from '@/lib/schemas/specials'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { IsoDate } from '@/lib/time/calendar'

/**
 * Månedens burger as staff edit it — design 1ah; technical plan §4, §6, §7d.
 *
 * A **separate read from the public one**, for the reasons `lib/content/menu-admin.ts`
 * and `lib/content/weekly-admin.ts` already set out and which apply here word for word:
 *
 *   * **Never cached.** `lib/content/menu.ts` caches its monthly read under the
 *     `monthly` tag; an editor served from that cache would hand a *stale* `updated_at`
 *     to the next save and turn optimistic concurrency (§6) into a lottery.
 *   * **Through the staff member's own JWT**, so RLS decides what exists. The
 *     administration never uses the anonymous client and never the service-role key.
 *   * **Both halves of every field.** The editor needs the values with the draft merged
 *     over them (what it shows) *and* the published values underneath — which it needs
 *     twice over here: to measure a real change against, so a draft holds only the
 *     changed fields (§4), **and** to compute §7d's state, which is a statement about
 *     what a guest can see right now and must therefore never be read off the draft.
 *
 * The overlay itself is not reimplemented: `overlayDraft` is the same function the
 * preview and the public menu use, so the editor and Forhåndsvis can never disagree
 * about what the draft currently says.
 *
 * THE PUBLIC READER IS ALSO NOT REIMPLEMENTED — AND THIS IS NOT IT
 *
 * `readMonthlyBurger` in `lib/content/menu.ts` answers a *guest's* question and returns
 * `null` for a row with no name, because a burger without a name is not a burger. That
 * is exactly the wrong answer for an editor, which has to render the empty singleton so
 * somebody can fill it in (the seeded state — 1ab lists Månedens burger as outstanding).
 * The two reads therefore stay two, and the difference between them is this paragraph
 * rather than a flag.
 *
 * `sold_out_on` IS READ, AND ONLY READ
 *
 * It is not a field of `monthlyBurgerDraft` and is therefore not part of
 * {@link MonthlyBurgerValues} — a draft cannot carry it, which is what §6's immediate
 * path requires. It is returned beside the values, from the **live** row, because 1ah's
 * switch has to show what is true of the hjemmeside right now rather than what a draft
 * proposes.
 */

type MonthlyRow = {
  id: string
  name: string | null
  description: string | null
  price_ore: number | null
  image_id: string | null
  starts_on: string | null
  ends_on: string | null
  show_on_homepage: boolean
  sold_out_on: string | null
  updated_at: string
  draft: unknown
}

const MONTHLY_ADMIN_COLUMNS =
  'id, name, description, price_ore, image_id, starts_on, ends_on, show_on_homepage, sold_out_on, updated_at, draft'

export type AdminMonthlyBurger = {
  readonly id: string
  /** The version token every form on the screen submits back (§6). */
  readonly updatedAt: string
  /** Live values with the draft merged over them — what the editor shows. */
  readonly current: MonthlyBurgerValues
  /** The published values — what a guest sees right now, and what §7d's state is from. */
  readonly live: MonthlyBurgerValues
  /** The immediate path's own column; never a draft field (§6). */
  readonly soldOutOn: IsoDate | null
  readonly hasDraft: boolean
  /** The editable fields the stored draft actually changes, in schema order. */
  readonly draftFields: readonly string[]
  /** True when a stored draft failed its schema and was therefore not applied. */
  readonly draftMalformed: boolean
}

function toValues(row: MonthlyRow): MonthlyBurgerValues {
  return {
    name: row.name,
    description: row.description,
    price_ore: row.price_ore,
    image_id: row.image_id,
    starts_on: row.starts_on as IsoDate | null,
    ends_on: row.ends_on as IsoDate | null,
    show_on_homepage: row.show_on_homepage,
  }
}

/**
 * The singleton, ready to edit — or `null` when there is no row this caller may see.
 *
 * `cache()` deduplicates within one render pass: the screen, the editor, the state
 * banner and the pending band all ask the same question. It expires with the request, so
 * two requests never share an answer — memoisation, not caching.
 */
export const readAdminMonthlyBurger = cache(async (): Promise<AdminMonthlyBurger | null> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('monthly_burger')
    .select(MONTHLY_ADMIN_COLUMNS)
    .maybeSingle<MonthlyRow>()

  if (error !== null) {
    throw new Error(`Could not read Månedens burger for editing: ${error.message}`)
  }

  if (data === null) return null

  const { row, changedFields, malformed } = overlayDraft<MonthlyRow>(
    data,
    data.draft,
    monthlyBurgerDraft,
  )

  return {
    id: data.id,
    updatedAt: data.updated_at,
    current: toValues(row),
    live: toValues(data),
    // From the live row: the column is not draftable, and the switch reports the
    // hjemmeside rather than the draft.
    soldOutOn: data.sold_out_on as IsoDate | null,
    hasDraft: data.draft !== null && data.draft !== undefined,
    draftFields: changedFields,
    draftMalformed: malformed,
  }
})
