import 'server-only'

import { cache } from 'react'

import { isPlainObject, overlayDraft } from '@/lib/drafts/overlay'
import { aboutValuesOf, type AboutValues } from '@/lib/pages/about'
import { aboutDraft } from '@/lib/schemas/page-documents'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Om os as staff edit it — design 1i; technical plan §4, §5, §6; phase 14B1.
 *
 * A **separate read from the public one**, for the reasons every `*-admin.ts` module
 * records and which apply here word for word:
 *
 *   * **Never cached.** `lib/content/pages.ts` caches its read under `page:about`; an
 *     editor served from that cache would hand a *stale* `updated_at` to the next save
 *     and turn optimistic concurrency (§6) into a lottery.
 *   * **Through the caller's own JWT**, so RLS decides what exists and what may be
 *     written. `pages_select_staff` lets any staff session read the row, and
 *     `pages_update_scoped` lets Staff and Owner alike write the `about` row — §5's
 *     matrix, in the database.
 *   * **Both halves of the document.** The editor shows the published document with the
 *     draft merged over it, *and* needs the published document underneath — to measure
 *     a real change against, so a draft holds only the changed keys and sections (§4),
 *     and to say which cards are waiting.
 *
 * The overlay itself is not reimplemented: `overlayDraft` with `aboutDraft` is the same
 * merge the Draft Mode preview performs, so the editor and Forhåndsvis can never
 * disagree about what the draft currently says. The normalisation is not reimplemented
 * either: `aboutValuesOf` is what the public read uses.
 */

type AboutRow = {
  id: string
  published: unknown
  draft: unknown
  updated_at: string
}

const ABOUT_ADMIN_COLUMNS = 'id, published, draft, updated_at'

export type AdminAboutPage = {
  readonly id: string
  /** The version token every form on the screen submits back (§6). */
  readonly updatedAt: string
  /** The published document with the draft merged over it — what the editor shows. */
  readonly current: AboutValues
  /** The published document — what a guest reads right now, and what the delta is measured against. */
  readonly live: AboutValues
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
export const readAdminAboutPage = cache(async (): Promise<AdminAboutPage | null> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('pages')
    .select(ABOUT_ADMIN_COLUMNS)
    .eq('key', 'about')
    .maybeSingle<AboutRow>()

  if (error !== null) {
    throw new Error(`Could not read Om os for editing: ${error.message}`)
  }

  if (data === null) return null

  const published = isPlainObject(data.published) ? data.published : {}
  const { row, changedFields, malformed } = overlayDraft(published, data.draft, aboutDraft)

  return {
    id: data.id,
    updatedAt: data.updated_at,
    current: aboutValuesOf(row),
    live: aboutValuesOf(published),
    hasDraft: data.draft !== null && data.draft !== undefined,
    draftFields: changedFields,
    draftMalformed: malformed,
  }
})
