import { type PostalAddress, formatAddressLine } from '@/lib/site/links'
import { mapEmbedUrl } from '@/lib/site/map-embed'

/**
 * The map — technical plan §7g (decision 6, revised for launch).
 *
 * One `<iframe>` pointed at Google's own embed, replacing the licensed-static-image
 * system: no map library, no tile provider request from this origin, no custom
 * JavaScript. Google's iframe is a separate browsing context with its own security
 * policy, so this origin's CSP only needs to permit the frame itself (`lib/security/headers.ts`).
 *
 * The street address is always rendered as real text elsewhere on the page — it is
 * never only inside the embed — so the location reaches a screen reader, a search
 * engine and the clipboard regardless of whether the frame loads. The "Vis vej"
 * directions link is unaffected: it stays a plain `<a>` built by `directionsUrl`.
 *
 * The embed is third-party Google content and its own privacy note applies —
 * see `docs/runbooks/launch-notes.md`.
 */

export type MapFrame = 'hero' | 'card' | 'square'

const FRAME_CLASSES: Record<MapFrame, string> = {
  hero: 'aspect-hero',
  card: 'aspect-card',
  square: 'aspect-square',
}

export function GoogleMap({
  address,
  frame = 'card',
  className = '',
}: {
  address: PostalAddress
  /** The drawn proportion per placement: 3:2 on the Forside, 4:3 on Find os (1g, 1k, 1o). */
  frame?: MapFrame
  className?: string
}) {
  const line = formatAddressLine(address)

  return (
    <div className={className}>
      <iframe
        src={mapEmbedUrl(address)}
        title={`Kort over ${line}`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className={`rounded-card-lg border-border block w-full border ${FRAME_CLASSES[frame]}`}
      />
    </div>
  )
}
