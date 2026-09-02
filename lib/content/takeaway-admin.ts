import 'server-only'

import { cache } from 'react'

import { isPlainObject, overlayDraft } from '@/lib/drafts/overlay'
import { takeawayValuesOf, takeawayVisibility, type TakeawayValues } from '@/lib/pages/takeaway'
import { takeawayDraft } from '@/lib/schemas/page-documents'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Mad ud af huset as staff edit it — design 1aj; technical plan §4, §5, §6;
 * phase 11B.
 *
 * A **separate read from the public one**, for the reasons every `*-admin.ts` module
 * records and which apply here word for word:
 *
 *   * **Never cached.** `lib/content/pages.ts` caches its read under `page:takeaway`;
 *     an editor served from that cache would hand a *stale* `updated_at` to the next
 *     save and turn optimistic concurrency (§6) into a lottery.
 *   * **Through the caller's own JWT**, so RLS decides what exists and what may be
 *     written. `pages_select_staff` lets any staff session read the row, and
 *     `pages_update_scoped` lets Staff and Owner alike write the `takeaway` row —
 *     §5's matrix, in the database.
 *   * **Both halves of the document, and both halves of the switch.** The editor
 *     shows the published document with the draft merged over it, *and* needs the
 *     published document underneath — to measure a real change against, so a draft
 *     holds only the changed keys (§4), and to say which cards are waiting. The
 *     visibility is read the same two ways: the column as a guest gets it, and the
 *     pending value the preview shows.
 *
 * The overlay itself is not reimplemented: `overlayDraft` with `takeawayDraft` is the
 * same merge the Draft Mode preview performs, so the editor and Forhåndsvis can never
 * disagree about what the draft currently says.
 */

type TakeawayRow = {
  id: string
  published: unknown
  draft: unknown
  is_visible: boolean
  updated_at: string
}

const TAKEAWAY_ADMIN_COLUMNS = 'id, published, draft, is_visible, updated_at'

export type AdminTakeawayPage = {
  readonly id: string
  /** The version token every form on the screen submits back (§6). */
  readonly updatedAt: string
  /** The published document with the draft merged over it — what the editor shows. */
  readonly current: TakeawayValues
  /** The published document — what a guest reads right now, and what the delta is measured against. */
  readonly live: TakeawayValues
  /** The switch as the pending draft leaves it — what publishing would make true. */
  readonly currentVisible: boolean
  /** The switch as a guest gets it right now. */
  readonly liveVisible: boolean
  readonly hasDraft: boolean
  /** The top-level keys the stored draft actually changes, in schema order. */
  readonly draftFields: readonly string[]
  /** True when a stored draft failed its schema and was therefore not applied. */
  readonly draftMalformed: boolean
}

/**
 * The page, ready to edit — or `null` when there is no row this caller may see.
 *
 * `cache()` deduplicates within one render pass: the bar's badge, the pending band and
 * the cards all ask the same question. It expires with the request, so two requests
 * never share an answer — memoisation, not caching.
 */
export const readAdminTakeawayPage = cache(async (): Promise<AdminTakeawayPage | null> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('pages')
    .select(TAKEAWAY_ADMIN_COLUMNS)
    .eq('key', 'takeaway')
    .maybeSingle<TakeawayRow>()

  if (error !== null) {
    throw new Error(`Could not read Mad ud af huset for editing: ${error.message}`)
  }

  if (data === null) return null

  const published = isPlainObject(data.published) ? data.published : {}
  const { row, changedFields, malformed } = overlayDraft(published, data.draft, takeawayDraft)

  return {
    id: data.id,
    updatedAt: data.updated_at,
    current: takeawayValuesOf(row),
    live: takeawayValuesOf(published),
    currentVisible: takeawayVisibility(data.is_visible, data.draft),
    liveVisible: data.is_visible,
    hasDraft: data.draft !== null && data.draft !== undefined,
    draftFields: changedFields,
    draftMalformed: malformed,
  }
})
