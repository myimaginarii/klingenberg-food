import { describe, expect, it } from 'vitest'

import type { SiteContact } from '@/lib/content/types'
import {
  directionsUrl,
  formatAddressLine,
  mailtoHref,
  telHref,
  toPostalAddress,
} from '@/lib/site/links'

const ADDRESS = {
  addressLine1: 'Lumbyvej 62',
  postalCode: '5792',
  city: 'Nørre Lyndelse',
}

/** The confirmed contact facts, as `content/site/contact.ts` carries them. */
const CONTACT: SiteContact = {
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

describe('telHref', () => {
  it('strips the spaces a stored number is printed with', () => {
    expect(telHref('+45 63 90 83 00')).toBe('tel:+4563908300')
    expect(telHref('+45 51 79 45 66')).toBe('tel:+4551794566')
  })

  it('keeps a leading plus and drops any other separator', () => {
    expect(telHref('+45-63.90.83.00')).toBe('tel:+4563908300')
    expect(telHref('63 90 83 00')).toBe('tel:63908300')
  })

  it('refuses a number with no digits rather than producing a dead link', () => {
    expect(() => telHref('  ')).toThrow(TypeError)
  })
})

describe('mailtoHref', () => {
  it('links the confirmed public address', () => {
    expect(mailtoHref(CONTACT.email as string)).toBe('mailto:soebylarsen@gmail.com')
  })

  it('drops the whitespace a paste leaves behind', () => {
    expect(mailtoHref('  soebylarsen@gmail.com \n')).toBe('mailto:soebylarsen@gmail.com')
  })

  it('carries no subject, no body and no second recipient', () => {
    expect(mailtoHref('soebylarsen@gmail.com')).not.toMatch(/[?&,]/)
  })

  it('refuses an empty address rather than producing a dead link', () => {
    expect(() => mailtoHref('   ')).toThrow(TypeError)
  })
})

describe('formatAddressLine', () => {
  it('writes the one-line form used in the footer and the map link', () => {
    expect(formatAddressLine(ADDRESS)).toBe('Lumbyvej 62, 5792 Nørre Lyndelse')
  })
})

describe('directionsUrl', () => {
  it('builds one universal Google Maps directions link from the stored address', () => {
    expect(directionsUrl(ADDRESS)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Lumbyvej%2062%2C%205792%20N%C3%B8rre%20Lyndelse',
    )
  })

  it('encodes the destination, so the address can never break out of the query', () => {
    const url = directionsUrl({ ...ADDRESS, city: 'Nørre & Lyndelse' })
    expect(url).toContain('N%C3%B8rre%20%26%20Lyndelse')
    expect(url.split('destination=')[1]).not.toContain('&')
  })
})

describe('toPostalAddress', () => {
  it('maps the confirmed contact row', () => {
    expect(toPostalAddress(CONTACT)).toEqual(ADDRESS)
  })

  it('returns null when any part is missing, so no half-filled block renders', () => {
    expect(toPostalAddress({ ...CONTACT, city: null })).toBeNull()
    expect(toPostalAddress({ ...CONTACT, addressLine1: null })).toBeNull()
    expect(toPostalAddress({ ...CONTACT, postalCode: null })).toBeNull()
  })
})
