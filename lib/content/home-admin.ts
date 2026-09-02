import 'server-only'

import { cache } from 'react'

import { isPlainObject, overlayDraft } from '@/lib/drafts/overlay'
import { homeValuesOf, type HomeValues } from '@/lib/pages/home'
import { homeDraft } from '@/lib/schemas/page-documents'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The Forside document as the owner edits it — design 1u; technical plan §4, §5, §6;
 * phase 11A.
 *
 * A **separate read from the public one**, for the reasons every `*-admin.ts` module
 * records and which apply here word for word:
 *
 *   * **Never cached.** `lib/content/pages.ts` caches its read under `page:home`; an
 *     editor served from that cache would hand a *stale* `updated_at` to the next save
 *     and turn optimistic concurrency (§6) into a lottery.
 *   * **Through the caller's own JWT**, so RLS decides what exists and what may be
 *     written. `pages_select_staff` lets any staff session read the row (the dashboard
 *     needs to say a Forside change is waiting); `pages_update_scoped` lets the Owner
 *     alone write it, which is the second, independent half of the §5 rule the page's
 *     `requireOwner()` states first.
 *   * **Both halves of the document.** The editor shows the published document with the
 *     draft merged over it, *and* needs the published document underneath — to measure
 *     a real change against, so a draft holds only the changed sections (§4), and to
 *     say which sections are waiting.
 *
 * The overlay itself is not reimplemented: `overlayDraft` with `homeDraft` is the same
 * merge the Draft Mode preview performs, so the editor and Forhåndsvis can never
 * disagree about what the draft currently says. The normalisation is not reimplemented
 * either: `homeValuesOf` is what the public read uses.
 */

type HomeRow = {
  id: string
  published: unknown
  draft: unknown
  updated_at: string
}

const HOME_ADMIN_COLUMNS = 'id, published, draft, updated_at'

export type AdminHomePage = {
  readonly id: string
  /** The version token every form on the screen submits back (§6). */
  readonly updatedAt: string
  /** The published document with the draft merged over it — what the editor shows. */
  readonly current: HomeValues
  /** The published document — what a guest reads right now, and what the delta is measured against. */
  readonly live: HomeValues
  readonly hasDraft: boolean
  /** The top-level sections the stored draft actually changes, in schema order. */
  readonly draftFields: readonly string[]
  /** True when a stored draft failed its schema and was therefore not applied. */
  readonly draftMalformed: boolean
}

/**
 * The Forside, ready to edit — or `null` when there is no row this caller may see.
 *
 * `cache()` deduplicates within one render pass: the bar's badge, the pending band and
 * the four cards all ask the same question. It expires with the request, so two
 * requests never share an answer — memoisation, not caching.
 */
export const readAdminHomePage = cache(async (): Promise<AdminHomePage | null> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('pages')
    .select(HOME_ADMIN_COLUMNS)
    .eq('key', 'home')
    .maybeSingle<HomeRow>()

  if (error !== null) {
    throw new Error(`Could not read the Forside for editing: ${error.message}`)
  }

  if (data === null) return null

  const published = isPlainObject(data.published) ? data.published : {}
  const { row, changedFields, malformed } = overlayDraft(published, data.draft, homeDraft)

  return {
    id: data.id,
    updatedAt: data.updated_at,
    current: homeValuesOf(row),
    live: homeValuesOf(published),
    hasDraft: data.draft !== null && data.draft !== undefined,
    draftFields: changedFields,
    draftMalformed: malformed,
  }
})
