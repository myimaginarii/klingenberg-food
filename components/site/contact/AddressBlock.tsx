import type { PostalAddress } from '@/lib/site/links'

/**
 * The street address as real text — design 1g, 1k, 1o.
 *
 * It appears on the Forside and on Find os, and it is deliberately never only inside
 * the map image: an address in text is what reaches a screen reader, a search engine and
 * the clipboard (§7g, §11). One `<address>` element, so both pages agree.
 */
export function AddressBlock({
  address,
  venueName,
  className = '',
}: {
  address: PostalAddress
  venueName: string | null
  className?: string
}) {
  return (
    <address className={`not-italic ${className}`}>
      <span className="font-display text-card block">
        {address.addressLine1}
        <br />
        {`${address.postalCode} ${address.city}`}
      </span>
      {venueName ? (
        <span className="text-ink-2 text-detail mt-1.5 block">{`${venueName} · Danmark`}</span>
      ) : null}
    </address>
  )
}
