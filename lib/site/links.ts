import type { SiteContact } from '@/lib/content/types'

/**
 * The outbound links the public site builds — technical plan §7g, §8.
 *
 * Each one is constructed here rather than at the call site so there is exactly one
 * place that decides what a phone link, an e-mail link and a directions link look like,
 * and exactly one place a reviewer has to read to be sure none of them is built from
 * visitor input.
 */

/**
 * `tel:` href for a stored phone number.
 *
 * Numbers are stored the way they are printed ("+45 63 90 83 00"); a dialler wants them
 * without spaces. Everything except digits and a single leading `+` is dropped, so a
 * stored number with a different separator still produces a working link.
 */
export function telHref(phone: string): string {
  const trimmed = phone.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  const digits = trimmed.replace(/\D/g, '')

  if (digits.length === 0) {
    throw new TypeError(`A phone number must contain at least one digit. Received: ${phone}`)
  }

  return `tel:${plus}${digits}`
}

/**
 * `mailto:` href for the stored public e-mail address.
 *
 * The address is a stored contact fact, validated on the way in by
 * `siteContactDraft.email` (§4), so nothing is escaped or re-shaped here beyond the
 * surrounding whitespace a paste can leave behind. There is no subject, no body and no
 * second recipient: the link opens an empty message to the restaurant and nothing else.
 */
export function mailtoHref(email: string): string {
  const trimmed = email.trim()

  if (trimmed.length === 0) {
    throw new TypeError('An e-mail address must not be empty.')
  }

  return `mailto:${trimmed}`
}

/** A postal address, as the site stores and prints it. */
export type PostalAddress = {
  addressLine1: string
  postalCode: string
  city: string
}

/** "Lumbyvej 62, 5792 Nørre Lyndelse" — the one-line form used in links and the footer. */
export function formatAddressLine(address: PostalAddress): string {
  return `${address.addressLine1}, ${address.postalCode} ${address.city}`
}

/**
 * The universal directions link (§7g).
 *
 * One URL for every platform: it opens the native Google Maps app on Android and iOS
 * when installed and the web map otherwise. No user-agent sniffing, no JavaScript, and
 * the destination is built from the stored address rather than from anything a visitor
 * can supply.
 */
export function directionsUrl(address: PostalAddress): string {
  const destination = encodeURIComponent(formatAddressLine(address))
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`
}

/**
 * The address as a link builder needs it, or `null` when the administration has not
 * filled it in.
 *
 * The approved design removes a block rather than showing a half-filled one, so an
 * incomplete address produces no map, no directions button and no address line —
 * never "Vis vej" pointing at a comma.
 */
export function toPostalAddress(contact: SiteContact): PostalAddress | null {
  if (!contact.addressLine1 || !contact.postalCode || !contact.city) return null

  return {
    addressLine1: contact.addressLine1,
    postalCode: contact.postalCode,
    city: contact.city,
  }
}
