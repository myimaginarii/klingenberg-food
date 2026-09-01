import type { AdminImage } from '@/lib/content/images-admin'
import { imageAccessibleName, usageLabel, UNUSED_LABEL } from '@/lib/images/library'

import { ImageThumbnail } from './ImageThumbnail'

/**
 * The library grid — design 1w; phase 10B.
 *
 * 1w draws four thumbnail columns at 700 px with a usage caption under each and a
 * dashed "+ Upload" tile at the end. The phone has no dedicated Billeder frame
 * (1x only draws the dashboard tile), so the grid follows the established mobile
 * stacking rule instead: two columns at 375, three from `md`, 1w's four from `lg`.
 *
 * Every card is a **link** — pressing a thumbnail navigates to the detail panel,
 * and nothing has happened yet (the administration's rule for anything that opens
 * something). The card's accessible name is the image's description, or its
 * filename when no description exists, so a screen-reader listing is a list of
 * pictures rather than a list of "link, link, link".
 *
 * The usage caption is text on every card — never a colour, never an icon alone
 * (1aa). "Bruges ikke endnu" keeps 1w's muted tone; a used image's caption reads
 * in the ordinary ink.
 */
export function ImageLibraryGrid({
  images,
  hrefFor,
  selectedId,
  uploadHref,
}: {
  images: readonly AdminImage[]
  /** The detail address for one image — built by the page's own route module. */
  hrefFor: (image: AdminImage) => string
  selectedId?: string
  /** Where the dashed "+ Upload" tile lands: the uploader's file input. */
  uploadHref: string
}) {
  return (
    <ul className="grid list-none grid-cols-2 gap-3.5 p-0 md:grid-cols-3 lg:grid-cols-4">
      {images.map((image) => {
        const label = usageLabel(image.usages)
        const selected = image.id === selectedId

        return (
          <li key={image.id}>
            <a
              aria-current={selected ? 'true' : undefined}
              className={`rounded-card block ${
                selected ? '[outline:3px_solid_var(--color-focus)] outline-offset-2' : ''
              }`}
              href={hrefFor(image)}
            >
              <span className="sr-only">{imageAccessibleName(image.altText, image.originalFilename)}</span>
              {image.thumbnail === null ? (
                <span
                  aria-hidden="true"
                  className="bg-field-bg border-field-border rounded-card flex h-[6.875rem] items-center justify-center border font-mono text-label text-ink-3 uppercase"
                >
                  Foto
                </span>
              ) : (
                <ImageThumbnail
                  altText={null}
                  className="rounded-card h-[6.875rem] w-full object-cover"
                  sizes="(min-width: 1024px) 12rem, (min-width: 768px) 30vw, 45vw"
                  thumbnail={image.thumbnail}
                />
              )}
              <span
                aria-hidden="true"
                className={`mt-1.5 block text-[0.8125rem] leading-snug ${
                  label === UNUSED_LABEL ? 'text-ink-3' : 'text-ink-2'
                }`}
              >
                {label}
              </span>
              {/* The caption is part of the link's spoken name too. */}
              <span className="sr-only">{label}</span>
            </a>
          </li>
        )
      })}

      <li>
        <a
          className="rounded-card border-rule text-ink-2 bg-surface hover:text-ink flex h-[6.875rem] items-center justify-center border-[1.5px] border-dashed font-medium"
          href={uploadHref}
        >
          + Upload
        </a>
      </li>
    </ul>
  )
}
