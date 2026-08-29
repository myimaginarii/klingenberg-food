import 'server-only'

import { CACHE_TAGS } from '@/lib/cache/tags'
import { overlayDraft } from '@/lib/drafts/overlay'
import { siteContactDraft } from '@/lib/schemas/contact'

import type { SiteContact } from './types'
import { assertNoQueryError, columns, definePublicRead, type ContentAccess } from './source'

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
 *
 * These facts appear on every page, which is why the `contact` tag legitimately
 * expires the whole site when they are published (§6).
 */

type SiteContactRow = {
  venue_name: string | null
  address_line1: string | null
  postal_code: string | null
  city: string | null
  primary_phone: string | null
  secondary_phone: string | null
  email: string | null
  facebook_url: string | null
  map_attribution: string | null
}

const LIVE_COLUMNS =
  'venue_name, address_line1, postal_code, city, primary_phone, secondary_phone, email, facebook_url, map_attribution'

const EMPTY: SiteContact = {
  venueName: null,
  addressLine1: null,
  postalCode: null,
  city: null,
  primaryPhone: null,
  secondaryPhone: null,
  email: null,
  facebookUrl: null,
  mapAttribution: null,
}

function toSiteContact(row: SiteContactRow): SiteContact {
  return {
    venueName: row.venue_name,
    addressLine1: row.address_line1,
    postalCode: row.postal_code,
    city: row.city,
    primaryPhone: row.primary_phone,
    secondaryPhone: row.secondary_phone,
    email: row.email,
    facebookUrl: row.facebook_url,
    mapAttribution: row.map_attribution,
  }
}

/**
 * Deduplicated for the length of one request: the shared layout, the footer and most
 * pages all need the contact facts, and they should cost one query between them rather
 * than one each.
 */
export const readSiteContact = definePublicRead(
  'site-contact',
  [CACHE_TAGS.contact],
  async (access: ContentAccess): Promise<SiteContact> => {
    const { data, error } = await access.database
      .from('site_contact')
      .select(columns(access, LIVE_COLUMNS))
      .maybeSingle<SiteContactRow & { draft?: unknown }>()

    assertNoQueryError('the contact information', error)
    if (data === null) return EMPTY

    // On the published path there is no `draft` property at all, so this is a no-op
    // and the live row is returned unchanged. That is the same call either way, which
    // is the point: there is one merge implementation, not one per path.
    const { row } = overlayDraft<SiteContactRow>(
      data,
      access.includeDrafts ? data.draft : null,
      siteContactDraft,
    )

    return toSiteContact(row)
  },
)
