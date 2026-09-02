import 'server-only'

import { cache } from 'react'

import { contactValuesOf, type ContactValues } from '@/lib/contact/editor'
import { overlayDraft } from '@/lib/drafts/overlay'
import { siteContactDraft } from '@/lib/schemas/contact'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The contact facts as the Owner edits them — design 1v; technical plan §4, §5,
 * §6; phase 11B.
 *
 * A **separate read from the public one**, for the reasons every `*-admin.ts` module
 * records: never cached (the public read is cached under `contact`, and a stale
 * `updated_at` would turn optimistic concurrency into a lottery); through the
 * caller's own JWT (`site_contact_select_staff` lets any staff session read the row —
 * the dashboard needs to say a change is waiting — and `site_contact_update_owner`
 * lets the Owner alone write it, §5); and both halves — the live columns a guest
 * reads now, and the draft merged over them, so the delta is measured against what
 * the hjemmeside actually says.
 *
 * `overlayDraft` with `siteContactDraft` is the same merge `lib/content/contact.ts`
 * performs in Draft Mode, so the editor and Forhåndsvis cannot disagree.
 */

type ContactRow = {
  id: string
  venue_name: string | null
  address_line1: string | null
  postal_code: string | null
  city: string | null
  primary_phone: string | null
  secondary_phone: string | null
  email: string | null
  facebook_url: string | null
  map_attribution: string | null
  draft: unknown
  updated_at: string
}

const CONTACT_ADMIN_COLUMNS =
  'id, venue_name, address_line1, postal_code, city, primary_phone, secondary_phone, email, facebook_url, map_attribution, draft, updated_at'

export type AdminContact = {
  readonly id: string
  /** The version token the form submits back (§6). */
  readonly updatedAt: string
  /** The live values with the draft merged over them — what the editor shows. */
  readonly current: ContactValues
  /** The live values — what a guest reads right now, and what the delta is measured against. */
  readonly live: ContactValues
  readonly hasDraft: boolean
  /** The fields the stored draft actually changes, in schema order. */
  readonly draftFields: readonly string[]
  /** True when a stored draft failed its schema and was therefore not applied. */
  readonly draftMalformed: boolean
}

export const readAdminContact = cache(async (): Promise<AdminContact | null> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('site_contact')
    .select(CONTACT_ADMIN_COLUMNS)
    .maybeSingle<ContactRow>()

  if (error !== null) {
    throw new Error(`Could not read the contact information for editing: ${error.message}`)
  }

  if (data === null) return null

  const { draft, ...live } = data
  const { row, changedFields, malformed } = overlayDraft(live, draft, siteContactDraft)

  return {
    id: data.id,
    updatedAt: data.updated_at,
    current: contactValuesOf(row),
    live: contactValuesOf(live),
    hasDraft: draft !== null && draft !== undefined,
    draftFields: changedFields,
    draftMalformed: malformed,
  }
})
