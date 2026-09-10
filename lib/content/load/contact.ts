import type { SiteContact } from '@/lib/content/types'

import { once, readContentJson } from './source'

/**
 * The restaurant's confirmed contact facts — `content/site/contact.json` (design 1ab;
 * `content/launch/launch-copy.md`, "Praktiske oplysninger").
 *
 * Every phone number, the address, the e-mail address and the Facebook link on the
 * site come from here, so a correction is one edit. The file is the domain shape
 * written down, field for field; a field the file leaves out is `null`, which every
 * page already treats as "not stated" and removes the block for.
 *
 * `mapAttribution` is not in the file: the map is Google's own embed and needs no
 * credit line, so there is nothing for the restaurant to write. It stays in the type
 * because the link builders and the JSON-LD take the whole {@link SiteContact}.
 */
type ContactFile = Partial<Record<keyof Omit<SiteContact, 'mapAttribution'>, string | null>>

export const loadContact = once((): SiteContact => {
  const file = readContentJson<ContactFile>('contact.json')

  return {
    venueName: file.venueName ?? null,
    addressLine1: file.addressLine1 ?? null,
    postalCode: file.postalCode ?? null,
    city: file.city ?? null,
    primaryPhone: file.primaryPhone ?? null,
    secondaryPhone: file.secondaryPhone ?? null,
    email: file.email ?? null,
    facebookUrl: file.facebookUrl ?? null,
    mapAttribution: null,
  }
})
