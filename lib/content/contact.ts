import 'server-only'

import { cache } from 'react'

import type { SiteContact } from './types'
import { assertNoQueryError, publicDatabase } from './source'

/**
 * Contact facts — technical plan §4.
 *
 * One singleton row, read once per page render. Every phone number, the address and
 * the Facebook link on the public site come from here, so correcting a number in the
 * administration corrects it everywhere at once (§4). Nothing is hard-coded in a
 * component.
 *
 * Every field is nullable on purpose. The approved design removes a block rather than
 * showing an empty one — "Er linket ikke udfyldt i administrationen, forsvinder hele
 * kolonnen" (1g) — so absence is a rendering state, not an error.
 */

const COLUMNS =
  'venue_name, address_line1, postal_code, city, primary_phone, secondary_phone, email, facebook_url, map_attribution'

/**
 * Deduplicated for the length of one request with React's `cache`: the shared layout,
 * the footer and most pages all need the contact facts, and they should cost one query
 * between them rather than one each.
 */
export const readSiteContact = cache(async (): Promise<SiteContact> => {
  const { data, error } = await publicDatabase()
    .from('site_contact')
    .select(COLUMNS)
    .maybeSingle<{
      venue_name: string | null
      address_line1: string | null
      postal_code: string | null
      city: string | null
      primary_phone: string | null
      secondary_phone: string | null
      email: string | null
      facebook_url: string | null
      map_attribution: string | null
    }>()

  assertNoQueryError('the contact information', error)

  return {
    venueName: data?.venue_name ?? null,
    addressLine1: data?.address_line1 ?? null,
    postalCode: data?.postal_code ?? null,
    city: data?.city ?? null,
    primaryPhone: data?.primary_phone ?? null,
    secondaryPhone: data?.secondary_phone ?? null,
    email: data?.email ?? null,
    facebookUrl: data?.facebook_url ?? null,
    mapAttribution: data?.map_attribution ?? null,
  }
})
