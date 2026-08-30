import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { currentIsoWeek, type IsoWeek } from '@/lib/time/iso-week'

import { copyDestinationWeek, type WeeklySpecialValues } from './weekly'

/**
 * "Kopiér sidste uge" — technical plan §6 (decision 4), design 1ag's own open question,
 * closed by the owner.
 *
 * §6 describes the operation in four numbered steps, and this module is the first and
 * the last of them; the middle two are the database's, in
 * `public.copy_weekly_special_to_draft()`:
 *
 *   1. `requireStaff()` — done by the Server Action; the role matrix is re-asked here.
 *   2. read the **currently live** row — done by the database function, from its own
 *      `select`. Until the new week is published that row *is* last week, which is why
 *      §4 needs no weekly-special history table.
 *   3. write a `draft` under the next ISO week, with both sold-out fields cleared.
 *   4. write an `audit_log` row. **It never touches a live column and never publishes.**
 *
 * THE SERVER DECIDES WHAT IS COPIED
 *
 * Nothing about the source crosses the wire. The browser sends a version token and, for
 * an overwrite, a confirmation; the destination week is computed **here**, on the
 * server, from the server's own read of the live row; and the content is read by the
 * database from its own row. There is no parameter through which a document, a field
 * list or a value could arrive, so "do not trust a browser-submitted source" is a shape
 * this operation does not have rather than a check it performs.
 *
 * IT IS NOT A PUBLISH, AND IT IS NOT PART OF ONE
 *
 * The copy is deliberately separate from `lib/publishing/publish.ts` and shares no code
 * path with it. It expires **no cache tag**: creating a draft changes nothing a guest
 * can see, so telling the public cache about it would be telling it a story the
 * database does not agree with. The staff member then edits the copied draft, presses
 * Forhåndsvis and publishes normally — the ordinary three-step flow, unchanged.
 *
 * There is no generalised clone framework here and no "copy any entity" abstraction.
 * Månedens burger is a different domain with a different shape and a different notion of
 * "the previous one" (§7d's date window, not a week number); it gets its own operation
 * in phase 6B if it needs one.
 */

/** The outcome vocabulary. Only `copied` wrote anything. */
export type CopyWeeklyStatus =
  /** A draft was seeded. Nothing a guest can see has changed. */
  | 'copied'
  /** A draft already exists. Nothing was written; ask, then call again with confirm. */
  | 'needs_confirmation'
  /** The live row holds nothing a guest could read, so there is nothing to copy (§6). */
  | 'nothing_to_copy'
  /** Somebody else changed the row first (§6). Nothing was written. */
  | 'conflict'
  /** No row, or the caller may not see it. */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The destination week does not exist, or is outside the column's range. */
  | 'invalid_week'
  /** The database refused the write, or was unreachable. */
  | 'failed'

export type CopyWeeklyResult = {
  readonly status: CopyWeeklyStatus
  /** The week the copy landed in — or would land in, for a refusal that named one. */
  readonly destination: IsoWeek | null
  /** The new version token, present only when the status is `copied`. */
  readonly updatedAt: string | null
}

export type CopyWeeklyRequest = {
  /** The `updated_at` the screen was rendered from. The concurrency token (§6). */
  readonly expectedUpdatedAt: string
  /** True only when a person has answered the overwrite confirmation (§6). */
  readonly confirmOverwrite?: boolean
  /** The instant "this week" is resolved from. Injected so the rule is testable. */
  readonly now?: Date
}

/** The database function's reply. Anything else is treated as a failure. */
const rpcResultSchema = z.object({
  status: z.enum([
    'copied',
    'needs_confirmation',
    'nothing_to_copy',
    'conflict',
    'not_found',
    'forbidden',
    'invalid_week',
  ]),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
})

function refusal(status: CopyWeeklyStatus, destination: IsoWeek | null): CopyWeeklyResult {
  return { status, destination, updatedAt: null }
}

/**
 * The only columns this module reads.
 *
 * Two, and both of them are the *week* rather than the content. Whether there is
 * anything worth copying is the database's answer (`nothing_to_copy`), and what is
 * copied is the database's read — so nothing about the source's content passes through
 * here, and there is no second reader to fall out of step with the first.
 */
type LiveWeekRow = Pick<WeeklySpecialValues, 'iso_year' | 'iso_week'>

export async function copyPreviousWeekToDraft(
  profile: Profile,
  request: CopyWeeklyRequest,
): Promise<CopyWeeklyResult> {
  if (!mayChangeEntity('weekly_special', profile)) return refusal('forbidden', null)

  const supabase = await createSupabaseServerClient()

  // The server's own read, purely to decide *which week* the copy lands in. The content
  // is never read here — the database function reads that from its own row, so there is
  // one source for what is copied rather than two that could drift.
  const source = await supabase
    .from('weekly_special')
    .select('iso_year, iso_week')
    .maybeSingle<LiveWeekRow>()

  if (source.error !== null) {
    console.error(`Could not read the live week to copy: ${source.error.message}`)
    return refusal('failed', null)
  }

  if (source.data === null) return refusal('not_found', null)

  const destination = copyDestinationWeek(source.data, currentIsoWeek(request.now ?? new Date()))

  const { data, error } = await supabase.rpc('copy_weekly_special_to_draft', {
    p_iso_year: destination.year,
    p_iso_week: destination.week,
    p_expected_updated_at: request.expectedUpdatedAt,
    p_confirm: request.confirmOverwrite === true,
  })

  if (error) {
    console.error(`Copying the previous week failed: ${error.message}`)
    return refusal('failed', destination)
  }

  const parsed = rpcResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error('Unexpected result from copy_weekly_special_to_draft.')
    return refusal('failed', destination)
  }

  if (parsed.data.status !== 'copied') return refusal(parsed.data.status, destination)

  return {
    status: 'copied',
    destination,
    updatedAt: parsed.data.updated_at ?? null,
  }
}
