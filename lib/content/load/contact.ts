import type { SiteContact } from '@/lib/content/types'

import { validateContact } from '../validate/contact'
import { assertValid } from '../validate/problems'

import { stored } from './cleared'
import { contentPath, once, readContentJson } from './source'

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
 *
 * Every field here is a *fact* rather than prose — a number that gets dialled, an
 * address that gets a `mailto:`, a page that gets linked — so an emptied one is `null`
 * and not `""`. That matters for the two optional ones: `sameAs: [""]` in the
 * `Restaurant` JSON-LD and a footer anchor pointing at nothing are what an emptied
 * Pages CMS text field would otherwise produce (`./cleared.ts`). The required fields
 * never reach this point empty — the validator refuses them first.
 */
type ContactFile = Partial<Record<keyof Omit<SiteContact, 'mapAttribution'>, string | null>>

export const loadContact = once((): SiteContact => {
  const file = readContentJson<ContactFile>('contact.json')
  assertValid(validateContact(file, contentPath('contact.json')))

  return {
    venueName: stored(file.venueName),
    addressLine1: stored(file.addressLine1),
    postalCode: stored(file.postalCode),
    city: stored(file.city),
    primaryPhone: stored(file.primaryPhone),
    secondaryPhone: stored(file.secondaryPhone),
    email: stored(file.email),
    facebookUrl: stored(file.facebookUrl),
    mapAttribution: null,
  }
})
