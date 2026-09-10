import type { SiteContact } from '@/lib/content/types'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import type { SeoImage } from '@/lib/images/public'
import { absoluteAssetUrl } from '@/lib/config/site'
import { canonicalUrl } from '@/lib/seo/sitemap'
import { telHref, toPostalAddress } from '@/lib/site/links'
import { WEEKDAY_KEYS, type WeekdayKey } from '@/lib/time/calendar'

/**
 * The `Restaurant` JSON-LD block — technical plan §11.
 *
 * Built here rather than in JSX so the shape is a value a unit test can hold still, and
 * built from the *same tracked facts the pages print*: the contact document
 * (`content/site/contact.json`) and the one weekly schedule (`content/site/hours.json`).
 * There is no second copy of the address, the telephone number or the hours anywhere in
 * this file, which is what makes the markup unable to drift from the page.
 *
 * NOTHING INVENTED. Every property below restates a confirmed fact the site itself
 * shows. What a local-business block *could* carry and this one deliberately does not:
 *
 *   * `geo` — nobody measured the coordinates, and a guessed latitude puts a pin in the
 *     wrong field. The address is precise, and Google geocodes it.
 *   * `priceRange` — the menu has prices; "what price bracket is this restaurant" is a
 *     different claim, and not one the content states.
 *   * `aggregateRating`, `review` — the site carries no ratings and no reviews. Marking
 *     up ratings that do not exist is the one structured-data mistake with a penalty
 *     attached to it.
 *   * `acceptsReservations`, `hasDeliveryMethod`, `paymentAccepted`,
 *     `publicAccess`, `isAccessibleForFreeCharge`, `amenityFeature` — the restaurant has
 *     answered none of these, and the public pages promise none of them.
 *   * `alternateName` — "Carl Nielsen Caféen" is the name the restaurant was *listed
 *     under in the competition* (the award band says exactly that). It is not a second
 *     trading name, and the copy pass of 2026-09-08 settled that it must never be
 *     presented as one.
 *   * `foundingDate`, `founder`, `legalName`, `vatID` — unknown.
 *
 * `@id` is the same absolute identifier on every page that carries the block, so the
 * Forside and Find os describe **one** restaurant rather than two that happen to share
 * an address.
 */

/** The business, as the site names it. `lib/seo/metadata.ts` uses the same constant. */
const RESTAURANT_NAME = 'Klingenberg Food'

/** ISO 3166-1 alpha-2 — the address is in Denmark. */
const COUNTRY = 'DK'

/** schema.org's `DayOfWeek` enumeration members, by the schedule's own weekday keys. */
const SCHEMA_DAYS: Readonly<Record<WeekdayKey, string>> = {
  mon: 'https://schema.org/Monday',
  tue: 'https://schema.org/Tuesday',
  wed: 'https://schema.org/Wednesday',
  thu: 'https://schema.org/Thursday',
  fri: 'https://schema.org/Friday',
  sat: 'https://schema.org/Saturday',
  sun: 'https://schema.org/Sunday',
}

export type PostalAddressJsonLd = {
  readonly '@type': 'PostalAddress'
  readonly streetAddress: string
  readonly postalCode: string
  readonly addressLocality: string
  readonly addressCountry: string
}

export type OpeningHoursJsonLd = {
  readonly '@type': 'OpeningHoursSpecification'
  readonly dayOfWeek: readonly string[]
  readonly opens: string
  readonly closes: string
}

export type SpecialOpeningHoursJsonLd = {
  readonly '@type': 'OpeningHoursSpecification'
  readonly validFrom: string
  readonly validThrough: string
  readonly opens: string
  readonly closes: string
}

export type RestaurantJsonLd = {
  readonly '@context': 'https://schema.org'
  readonly '@type': 'Restaurant'
  readonly '@id': string
  readonly name: string
  readonly url: string
  readonly image?: string
  readonly telephone?: string
  readonly email?: string
  readonly address?: PostalAddressJsonLd
  readonly containedInPlace?: { readonly '@type': 'Place'; readonly name: string }
  readonly servesCuisine?: string
  readonly hasMenu?: string
  readonly award?: string
  readonly sameAs?: readonly string[]
  readonly openingHoursSpecification?: readonly OpeningHoursJsonLd[]
  readonly specialOpeningHoursSpecification?: readonly SpecialOpeningHoursJsonLd[]
}

/**
 * The weekly schedule as `OpeningHoursSpecification` entries.
 *
 * A closed day produces **no entry**: schema.org states when a business is open, and
 * days the schedule leaves out are the days it is shut. Days that share the same hours
 * share one entry, in weekday order, so Wednesday to Friday and the weekend are two
 * lines rather than five.
 */
export function weeklyOpeningHoursJsonLd(
  schedule: WeeklySchedule,
): readonly OpeningHoursJsonLd[] {
  const byHours = new Map<string, { opens: string; closes: string; days: string[] }>()

  for (const key of WEEKDAY_KEYS) {
    const day = schedule[key]
    if ('closed' in day) continue

    const hours = `${day.from}-${day.to}`
    const existing = byHours.get(hours)
    if (existing) existing.days.push(SCHEMA_DAYS[key])
    else byHours.set(hours, { opens: day.from, closes: day.to, days: [SCHEMA_DAYS[key]] })
  }

  return [...byHours.values()].map(({ opens, closes, days }) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: days,
    opens,
    closes,
  }))
}

/**
 * Published one-off changes as `specialOpeningHoursSpecification` entries — a closed
 * holiday or a shorter evening, machine-readable rather than only printed.
 *
 * A draft override is not public and is skipped. A closed date is written as
 * `opens`/`closes` both `00:00`, which is schema.org's own way of saying "shut on this
 * date"; there is no other vocabulary for it.
 *
 * The list is used exactly as the content states it — no clock, no filtering of past
 * dates, so the same content always produces the same build. Removing a date that has
 * passed is content maintenance, the same as removing it from the printed hours.
 */
export function specialOpeningHoursJsonLd(
  overrides: readonly OpeningHoursOverride[],
): readonly SpecialOpeningHoursJsonLd[] {
  return overrides
    .filter((override) => override.status === 'published')
    .map((override) => ({
      '@type': 'OpeningHoursSpecification' as const,
      validFrom: override.date,
      validThrough: override.date,
      opens: override.kind === 'closed' ? '00:00' : (override.opensAt ?? '00:00'),
      closes: override.kind === 'closed' ? '00:00' : (override.closesAt ?? '00:00'),
    }))
}

/** "+45 63 90 83 00" as a dialable string, through the one place that normalises one. */
function telephoneOf(phone: string): string {
  return telHref(phone).replace(/^tel:/, '')
}

/**
 * The block itself. Every optional property is present only when the tracked content
 * carries the fact it restates; an incomplete address removes `address` rather than
 * printing a half one, exactly as the visible page does.
 */
export function restaurantJsonLd(input: {
  readonly contact: SiteContact
  readonly schedule: WeeklySchedule
  readonly overrides: readonly OpeningHoursOverride[]
  /** The photograph the share card also uses, or `null` for no `image`. */
  readonly image?: SeoImage | null
  /** The confirmed competition result the Forside prints, or `null` to leave it out. */
  readonly award?: string | null
}): RestaurantJsonLd {
  const { contact, schedule, overrides } = input
  const address = toPostalAddress(contact)
  const image = input.image ?? null
  const award = input.award ?? null
  const weekly = weeklyOpeningHoursJsonLd(schedule)
  const special = specialOpeningHoursJsonLd(overrides)

  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    // One identifier for one business, whichever page carries the block.
    '@id': `${canonicalUrl('/')}#restaurant`,
    name: RESTAURANT_NAME,
    url: canonicalUrl('/'),
    ...(image === null ? {} : { image: absoluteAssetUrl(image.url) }),
    ...(contact.primaryPhone === null ? {} : { telephone: telephoneOf(contact.primaryPhone) }),
    // The address the site already prints on Find os, in a `mailto:` link beside it.
    ...(contact.email === null ? {} : { email: contact.email }),
    ...(address === null
      ? {}
      : {
          address: {
            '@type': 'PostalAddress' as const,
            streetAddress: address.addressLine1,
            postalCode: address.postalCode,
            addressLocality: address.city,
            addressCountry: COUNTRY,
          },
        }),
    // The hall the restaurant is inside — the venue every page names, as a place rather
    // than as a second name for the business.
    ...(contact.venueName === null
      ? {}
      : { containedInPlace: { '@type': 'Place' as const, name: contact.venueName } }),
    // The approved copy calls the business "burgerbaren", the menu opens with nine
    // burgers and the award is a burger award. Nothing broader is claimed.
    servesCuisine: 'Burger',
    hasMenu: canonicalUrl('/menu'),
    ...(award === null ? {} : { award }),
    ...(contact.facebookUrl === null ? {} : { sameAs: [contact.facebookUrl] }),
    ...(weekly.length === 0 ? {} : { openingHoursSpecification: weekly }),
    ...(special.length === 0 ? {} : { specialOpeningHoursSpecification: special }),
  }
}
