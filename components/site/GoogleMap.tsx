import { type PostalAddress, formatAddressLine } from '@/lib/site/links'

/**
 * The map — technical plan §7g (decision 6, revised for launch, finalised in 14B3).
 *
 * One `<iframe>` on Google's own official embed link (copied verbatim from Google
 * Maps' own "Del" → "Integrer et kort" dialog for the restaurant's listing): no map
 * library, no tile provider request from this origin, no custom JavaScript, and no
 * API key. Google's iframe is a separate browsing context with its own security
 * policy, so this origin's CSP only needs to permit the frame itself (`lib/security/headers.ts`).
 *
 * The street address is always rendered as real text elsewhere on the page — it is
 * never only inside the embed — so the location reaches a screen reader, a search
 * engine and the clipboard regardless of whether the frame loads. The "Vis vej"
 * directions link is unaffected: it stays a plain `<a>` built by `directionsUrl`.
 *
 * The embed is third-party Google content and its own privacy note applies —
 * see `docs/technical-plan.md` §7g.
 */

export type MapFrame = 'hero' | 'card' | 'square'

const FRAME_CLASSES: Record<MapFrame, string> = {
  hero: 'aspect-hero',
  card: 'aspect-card',
  square: 'aspect-square',
}

/**
 * Google's own generated embed `src` for the restaurant's Maps listing ("Carl
 * Nielsen Hallens Cafeteria") — copied directly from Google Maps, not derived from
 * the stored address. Fixed on purpose: it is Google's place record, not something
 * this codebase can or should reconstruct from address text.
 */
const MAP_EMBED_SRC =
  'https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1238.4235623306165!2d10.400771966055665!3d55.300752675988925!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x464d2724d7b63557%3A0xb7c3a17dc6585e17!2sCarl%20Nielsen%20Hallens%20Cafeteria!5e0!3m2!1sen!2sdk!4v1788703533559!5m2!1sen!2sdk'

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

  /* The frame is the wrapper's box and the iframe simply fills it, rather than the
     iframe carrying the aspect ratio itself. Same drawn result, but it lets a caller
     that has a column to fill override the ratio (Find os passes `md:aspect-auto`
     with `md:flex-1`) without reaching inside this component. The iframe's own
     attributes — the embed `src`, the title, lazy loading, fullscreen and the referrer
     policy — are untouched. */
  return (
    <div
      className={`rounded-card-lg border-border overflow-hidden border ${FRAME_CLASSES[frame]} ${className}`}
    >
      <iframe
        src={MAP_EMBED_SRC}
        title={`Kort over ${line}`}
        loading="lazy"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="block size-full"
      />
    </div>
  )
}
