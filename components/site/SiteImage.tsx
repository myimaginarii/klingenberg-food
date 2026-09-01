import type { PublicImage, ImageSizesPreset } from '@/lib/images/public'
import { IMAGE_SIZES } from '@/lib/images/public'

import { MediaPlaceholder, RATIO_CLASSES, type MediaRatio } from './MediaPlaceholder'

/**
 * A public photograph in one of the approved frames — design 1aa ("Billedcontainere —
 * faste forhold"); technical plan §1 (adjustment 3); phase 10C-2.
 *
 * The ONE renderer of a library image on the public site (the administration's
 * thumbnails are `components/admin/images/ImageThumbnail.tsx`, and nothing else
 * writes a `<picture>`). It takes the public image model — already composed by the
 * read layer from the derivative ladder — and a slot, and emits plain server HTML:
 *
 *     <picture class="aspect-… overflow-hidden">
 *       <source type="image/avif" srcset="… 480w, … 960w, …" sizes="…">
 *       <img src="…960.webp" srcset="… 480w, … 960w, …" sizes="…"
 *            width height alt loading>
 *     </picture>
 *
 * AVIF is offered to the browsers that decode it, WebP is the `<img>` for the rest;
 * every candidate is a processed derivative in the public bucket, so no browser is
 * ever handed the private original and no request-time transformation exists. The
 * browser picks the rung from `sizes` — the slot's real rendered width per breakpoint,
 * stated once in `IMAGE_SIZES` — so a 6rem thumbnail never downloads the 2160 rung.
 *
 * NO LAYOUT SHIFT. The `<picture>` is the aspect-ratio box the placeholder already
 * reserved (the same `RATIO_CLASSES`, the same override classes the caller passes),
 * and the `<img>` carries its intrinsic `width`/`height` and fills the box with
 * `object-cover`. A photo that fails to load leaves the box exactly where it was; a
 * photo of another shape is cropped within the frame, never resized on disk.
 *
 * NO IMAGE. With no model — no selection, or a row the read layer could not render
 * safely — the reserved placeholder renders exactly as it did before phase 10, so an
 * empty slot and a broken record look the same to a guest: a frame, not a hole.
 *
 * Works without JavaScript: there is nothing here to hydrate.
 */
export function SiteImage({
  image,
  ratio,
  sizes,
  placeholder,
  className = '',
  loading = 'lazy',
}: {
  image: PublicImage | null
  /** The frame's aspect ratio (1aa). Callers may override per breakpoint through `className`. */
  ratio: MediaRatio
  /** Which approved slot this is — selects the `sizes` string the browser chooses a rung by. */
  sizes: ImageSizesPreset
  /** What the reserved frame says when there is no image. */
  placeholder: {
    label: string
    detail?: string
    tone?: 'default' | 'inverse'
  }
  className?: string
  /** `lazy` for everything below the fold; `eager` only for a page's primary image. */
  loading?: 'lazy' | 'eager'
}) {
  if (image === null) {
    return (
      <MediaPlaceholder
        ratio={ratio}
        label={placeholder.label}
        detail={placeholder.detail}
        tone={placeholder.tone}
        className={className}
      />
    )
  }

  const sizesAttribute = IMAGE_SIZES[sizes]

  return (
    <picture className={`block overflow-hidden ${RATIO_CLASSES[ratio]} ${className}`}>
      <source type="image/avif" srcSet={image.avifSrcSet} sizes={sizesAttribute} />
      <img
        alt={image.alt}
        className="size-full object-cover"
        decoding="async"
        height={image.height}
        loading={loading}
        sizes={sizesAttribute}
        src={image.src}
        srcSet={image.webpSrcSet}
        width={image.width}
      />
    </picture>
  )
}
