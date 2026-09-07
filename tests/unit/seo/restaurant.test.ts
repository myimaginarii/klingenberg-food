import { describe, expect, it } from 'vitest'

import { SITE_CONTACT } from '@/content/site/contact'
import { OPENING_HOURS } from '@/content/site/hours'
import type { SiteContact } from '@/lib/content/types'
import { buildStaticPublicImage, seoImageOf } from '@/lib/images/public'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import { restaurantJsonLd, weeklyOpeningHoursJsonLd, specialOpeningHoursJsonLd } from '@/lib/seo/restaurant'

import {
  ALWAYS_CLOSED_SCHEDULE,
  closedOverride,
  CONFIRMED_SCHEDULE,
  customOverride,
} from '../fixtures/hours'

/**
 * The `Restaurant` JSON-LD block — technical plan §11; phase 2B.
 *
 * The block is a machine's copy of what the pages print, so the assertions are about
 * two things and nothing else: every property restates a tracked fact, and every
 * property the content does not carry is **absent**. The second list is the one that
 * matters — a guessed coordinate or an invented rating is the failure mode this markup
 * has, and it is asserted by name here rather than trusted to review.
 */

const IMAGE = seoImageOf(
  buildStaticPublicImage({ slot: 'test-photo', alt: 'Et billede', width: 1440, height: 960 }),
)

function block(overrides: Partial<Parameters<typeof restaurantJsonLd>[0]> = {}) {
  return restaurantJsonLd({
    contact: SITE_CONTACT,
    schedule: OPENING_HOURS.schedule,
    overrides: OPENING_HOURS.overrides,
    ...overrides,
  })
}

describe('restaurantJsonLd — the confirmed facts', () => {
  it('is one Restaurant, identified the same way on every page that carries it', () => {
    expect(block()['@context']).toBe('https://schema.org')
    expect(block()['@type']).toBe('Restaurant')
    expect(block()['@id']).toBe('http://localhost:3000/#restaurant')
    expect(block().url).toBe('http://localhost:3000/')
  })

  it('restates the tracked contact document and nothing beside it', () => {
    const jsonLd = block()

    expect(jsonLd.name).toBe('Klingenberg Food')
    expect(jsonLd.telephone).toBe('+4563908300')
    expect(jsonLd.email).toBe('soebylarsen@gmail.com')
    expect(jsonLd.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Lumbyvej 62',
      postalCode: '5792',
      addressLocality: 'Nørre Lyndelse',
      addressCountry: 'DK',
    })
    expect(jsonLd.containedInPlace).toEqual({ '@type': 'Place', name: 'Carl Nielsen Hallen' })
    expect(jsonLd.sameAs).toEqual(['https://www.facebook.com/carlnielsencafeen'])
    expect(jsonLd.hasMenu).toBe('http://localhost:3000/menu/')
  })

  it('names the venue as a place, never as a second trading name', () => {
    const serialized = JSON.stringify(block())

    expect(serialized).not.toContain('alternateName')
    expect(serialized).not.toContain('Carl Nielsen Caféen')
  })

  it('carries the share photograph as an absolute URL, or no image at all', () => {
    expect(block({ image: IMAGE }).image).toBe('http://localhost:3000/media/test-photo/1440.webp')
    expect('image' in block()).toBe(false)
  })

  it('takes the award as one line, or leaves it out', () => {
    expect(block({ award: 'Danmarks Bedste Burger 2026' }).award).toBe('Danmarks Bedste Burger 2026')
    expect('award' in block()).toBe(false)
  })
})

describe('restaurantJsonLd — what is deliberately absent', () => {
  it('invents none of the properties nobody has answered', () => {
    const jsonLd = block({ image: IMAGE, award: 'Danmarks Bedste Burger 2026' }) as Record<
      string,
      unknown
    >

    for (const property of [
      'geo',
      'latitude',
      'longitude',
      'priceRange',
      'aggregateRating',
      'review',
      'acceptsReservations',
      'paymentAccepted',
      'currenciesAccepted',
      'hasDeliveryMethod',
      'areaServed',
      'openingHours',
      'foundingDate',
      'founder',
      'legalName',
      'vatID',
      'alternateName',
      'amenityFeature',
      'isAccessibleForFree',
      'publicAccess',
    ]) {
      expect(property in jsonLd, property).toBe(false)
    }
  })

  it('removes a block rather than half-filling it when a contact fact is missing', () => {
    const empty: SiteContact = {
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
    const jsonLd = block({ contact: empty }) as Record<string, unknown>

    for (const property of ['address', 'telephone', 'email', 'containedInPlace', 'sameAs']) {
      expect(property in jsonLd, property).toBe(false)
    }
    // What is left is still a valid, if bare, description of the business.
    expect(jsonLd.name).toBe('Klingenberg Food')
  })
})

describe('weeklyOpeningHoursJsonLd', () => {
  it('states when the restaurant is open, groups equal days, and omits the closed ones', () => {
    expect(weeklyOpeningHoursJsonLd(CONFIRMED_SCHEDULE)).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [
          'https://schema.org/Wednesday',
          'https://schema.org/Thursday',
          'https://schema.org/Friday',
        ],
        opens: '15:00',
        closes: '20:00',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['https://schema.org/Saturday', 'https://schema.org/Sunday'],
        opens: '17:00',
        closes: '20:00',
      },
    ])
  })

  it('says nothing at all for a schedule with no opening day', () => {
    expect(weeklyOpeningHoursJsonLd(ALWAYS_CLOSED_SCHEDULE)).toEqual([])
    expect('openingHoursSpecification' in block({ schedule: ALWAYS_CLOSED_SCHEDULE })).toBe(false)
  })
})

describe('specialOpeningHoursJsonLd', () => {
  it('marks a published one-off closure as a date that is shut', () => {
    expect(specialOpeningHoursJsonLd([closedOverride('2026-12-24')])).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        validFrom: '2026-12-24',
        validThrough: '2026-12-24',
        opens: '00:00',
        closes: '00:00',
      },
    ])
  })

  it('carries a published change of hours as the hours it changes to', () => {
    expect(specialOpeningHoursJsonLd([customOverride('2026-12-31', '12:00', '16:00')])).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        validFrom: '2026-12-31',
        validThrough: '2026-12-31',
        opens: '12:00',
        closes: '16:00',
      },
    ])
  })

  it('ignores a draft override, which is not public', () => {
    const draft = { ...closedOverride('2026-12-24'), status: 'draft' as const }

    expect(specialOpeningHoursJsonLd([draft])).toEqual([])
    expect('specialOpeningHoursSpecification' in block({ overrides: [draft] })).toBe(false)
  })

  it('is absent from the block while the tracked content lists no override', () => {
    expect(OPENING_HOURS.overrides).toEqual([])
    expect('specialOpeningHoursSpecification' in block()).toBe(false)
  })
})

describe('the serialised block', () => {
  it('is valid JSON that cannot close the script element early', () => {
    const jsonLd = block({ image: IMAGE, award: 'Vinder af Fyn & Øer' })
    const serialized = serializeJsonLd(jsonLd)

    expect(JSON.parse(serialized)).toEqual(jsonLd)
    expect(serialized).not.toContain('<')
    expect(serialized).not.toContain('>')
    expect(serialized).not.toContain('&')
  })
})
