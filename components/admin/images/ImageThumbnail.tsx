import type { AdminImageThumbnail } from '@/lib/content/images-admin'
import { thumbnailAlt } from '@/lib/images/library'

/**
 * One library thumbnail — design 1w's photo frame; phase 10B (brief §12, §13).
 *
 * A `<picture>` over the **smallest public derivative pair** — never the private
 * original, never the 2160 rung — with explicit `width`/`height` from the stored
 * record so the grid cannot shift as images arrive. The URLs come whole from the
 * read layer, which composes them through the one centralized derivative-path
 * function; nothing here builds a storage address.
 *
 * Plain `<img>`, no `next/image`: §1 adjustment 3 rules the optimizer out for this
 * project, which also means no remote-image host configuration exists to widen.
 */
export function ImageThumbnail({
  thumbnail,
  altText,
  className,
  sizes,
}: {
  thumbnail: AdminImageThumbnail
  altText: string | null
  className: string
  /** The rendered slot's width hint, e.g. '(min-width: 768px) 10rem, 45vw'. */
  sizes?: string
}) {
  return (
    <picture>
      <source sizes={sizes} srcSet={thumbnail.avifUrl} type="image/avif" />
      <img
        alt={thumbnailAlt(altText)}
        className={className}
        height={thumbnail.height}
        loading="lazy"
        sizes={sizes}
        src={thumbnail.webpUrl}
        width={thumbnail.width}
      />
    </picture>
  )
}
