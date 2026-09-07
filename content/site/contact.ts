import type { SiteContact } from '@/lib/content/types'

/**
 * The restaurant's confirmed contact facts — the one place they are written for the
 * public site (design 1ab; `content/launch/launch-copy.md`, "Praktiske oplysninger").
 *
 * Every phone number, the address, the e-mail address and the Facebook link on the
 * site come from here, so a correction is one edit. `mapAttribution` is `null`: the
 * map is Google's own embed and needs no credit line.
 */
export const SITE_CONTACT: SiteContact = {
  venueName: 'Carl Nielsen Hallen',
  addressLine1: 'Lumbyvej 62',
  postalCode: '5792',
  city: 'Nørre Lyndelse',
  primaryPhone: '+45 63 90 83 00',
  secondaryPhone: '+45 51 79 45 66',
  email: 'soebylarsen@gmail.com',
  facebookUrl: 'https://www.facebook.com/carlnielsencafeen',
  mapAttribution: null,
}
