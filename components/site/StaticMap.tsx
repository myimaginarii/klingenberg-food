import { type PostalAddress, directionsUrl, formatAddressLine } from '@/lib/site/links'

/**
 * The map — technical plan §7g (decision 6).
 *
 * One `<a>` around one `<img>`, and nothing else. No map library, no tile provider, no
 * runtime request to a map service and no JavaScript: the entire preview is a link that
 * opens the guest's own map application, which is what "hele udsnittet er ét klik →
 * åbner gæstens egen kort-app" in 1k and 1o asks for. It therefore works with
 * JavaScript disabled, which E2E 12 asserts.
 *
 * The destination is built from the stored address by `directionsUrl` and never from
 * anything a visitor can supply (§8).
 *
 * The street address is always rendered as real text elsewhere on the page — it is
 * never only inside this image — so the location reaches a screen reader, a search
 * engine and the clipboard regardless of whether the picture loads.
 *
 * **The asset is a placeholder** until the licensed image arrives (§13, open item C).
 * Swapping it is a one-file change: this descriptor is the only place the path and the
 * intrinsic size appear, and `public/map/LICENSE.md` carries the provenance field the
 * launch check reads.
 */
const MAP_ASSET = {
  src: '/map/klingenberg-food-placeholder.svg',
  width: 1200,
  height: 900,
} as const

export type MapFrame = 'hero' | 'card' | 'square'

const FRAME_CLASSES: Record<MapFrame, string> = {
  hero: 'aspect-hero',
  card: 'aspect-card',
  square: 'aspect-square',
}

export function StaticMap({
  address,
  frame = 'card',
  attribution,
  className = '',
}: {
  address: PostalAddress
  /** The drawn proportion per placement: 3:2 on the Forside, 4:3 on Find os (1g, 1k, 1o). */
  frame?: MapFrame
  /** `site_contact.map_attribution`, rendered as text when the licence requires it. */
  attribution?: string | null
  className?: string
}) {
  const line = formatAddressLine(address)

  return (
    <div className={className}>
      <a
        href={directionsUrl(address)}
        className="rounded-card-lg border-border block overflow-hidden border"
        rel="noopener noreferrer"
        target="_blank"
      >
        {/* eslint-disable-next-line @next/next/no-img-element --
            A plain <img> is the decision, not an oversight. §1 (adjustment 3) rules
            next/image out for this project: images are processed once at upload time
            into a fixed derivative ladder and served with `srcset`, which avoids the
            host's image-transformation quota entirely. §7g then specifies this element
            exactly — one <a> around one <img>, with explicit width and height so the
            frame is reserved before the file arrives. */}
        <img
          src={MAP_ASSET.src}
          width={MAP_ASSET.width}
          height={MAP_ASSET.height}
          alt={`Kort over ${line}. Åbner vejvisning i din kort-app.`}
          loading="lazy"
          decoding="async"
          className={`block h-full w-full object-cover ${FRAME_CLASSES[frame]}`}
        />
      </a>
      {attribution ? (
        <p className="text-ink-3 font-mono text-[0.6875rem] mt-2">{attribution}</p>
      ) : null}
    </div>
  )
}
