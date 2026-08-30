import 'server-only'

import { cache } from 'react'

import type { AnnouncementValues } from '@/lib/announcements/lifecycle'
import { overlayDraft } from '@/lib/drafts/overlay'
import { announcementDraft } from '@/lib/schemas/announcement'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The announcement as staff edit it — design 1ad; technical plan §4, §6, §7c.
 *
 * A **separate read from the public one**, for the three reasons `lib/content/menu-admin.ts`,
 * `lib/content/weekly-admin.ts` and `lib/content/monthly-admin.ts` already set out and
 * which apply here word for word:
 *
 *   * **Never cached.** `lib/content/announcement.ts` caches its read under the
 *     `announcement` tag; an editor served from that cache would hand a *stale*
 *     `updated_at` to the next save and turn optimistic concurrency (§6) into a lottery.
 *   * **Through the staff member's own JWT**, so RLS decides what exists. The
 *     administration never uses the anonymous client and never the service-role key.
 *   * **Both halves of every field.** The editor needs the values with the draft merged
 *     over them (what it shows) *and* the published values underneath — to measure a
 *     real change against, so a draft holds only the changed fields (§4), and to say what
 *     the hjemmeside is showing right now, which must never be read off a draft.
 *
 * `is_visible` IS READ, AND ONLY READ
 *
 * It is not a field of `announcementDraft` and is therefore not part of
 * {@link AnnouncementValues} — a draft cannot carry it, which is what §6's immediate path
 * requires. It is returned beside the values, from the **live** row, because the state
 * banner has to say what is true of the hjemmeside rather than what a draft proposes.
 * Nothing in phase 7A writes it except `publish_announcement()`; the control that turns
 * it off — 1ad's "Vis besked" switch and "Fjern beskeden nu" — is phase 7B.
 */

type AnnouncementRow = {
  id: string
  message: string | null
  link_type: string
  link_page: string | null
  link_url: string | null
  link_label: string | null
  expires_at: string | null
  is_visible: boolean
  source: string
  updated_at: string
  draft: unknown
}

const ANNOUNCEMENT_ADMIN_COLUMNS =
  'id, message, link_type, link_page, link_url, link_label, expires_at, is_visible, source, updated_at, draft'

export type AdminAnnouncement = {
  readonly id: string
  /** The version token every form on the screen submits back (§6). */
  readonly updatedAt: string
  /** Live values with the draft merged over them — what the editor shows. */
  readonly current: AnnouncementValues
  /** The published values — what a guest sees right now, and what the state is read from. */
  readonly live: AnnouncementValues
  /** The immediate path's own column; never a draft field (§6). */
  readonly isVisible: boolean
  /** `'manual'` or `'opening_hours'`. Phase 8 writes the second; phase 7A never does. */
  readonly source: string
  readonly hasDraft: boolean
  /** The editable fields the stored draft actually changes, in schema order. */
  readonly draftFields: readonly string[]
  /** True when a stored draft failed its schema and was therefore not applied. */
  readonly draftMalformed: boolean
}

function toLinkType(value: string): 'none' | 'page' | 'url' {
  return value === 'page' || value === 'url' ? value : 'none'
}

function toValues(row: Pick<AnnouncementRow, keyof AnnouncementRow>): AnnouncementValues {
  return {
    message: row.message,
    link_type: toLinkType(row.link_type),
    link_page: row.link_page,
    link_url: row.link_url,
    link_label: row.link_label,
    expires_at: row.expires_at,
  }
}

/**
 * The singleton, ready to edit — or `null` when there is no row this caller may see.
 *
 * `cache()` deduplicates within one render pass: the screen, the editor, the state
 * banner and the pending band all ask the same question. It expires with the request, so
 * two requests never share an answer — memoisation, not caching.
 */
export const readAdminAnnouncement = cache(async (): Promise<AdminAnnouncement | null> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('announcement')
    .select(ANNOUNCEMENT_ADMIN_COLUMNS)
    .maybeSingle<AnnouncementRow>()

  if (error !== null) {
    throw new Error(`Could not read the announcement for editing: ${error.message}`)
  }

  if (data === null) return null

  const { row, changedFields, malformed } = overlayDraft<AnnouncementRow>(
    data,
    data.draft,
    announcementDraft,
  )

  return {
    id: data.id,
    updatedAt: data.updated_at,
    current: toValues(row),
    live: toValues(data),
    isVisible: data.is_visible,
    source: data.source,
    hasDraft: data.draft !== null && data.draft !== undefined,
    draftFields: changedFields,
    draftMalformed: malformed,
  }
})
