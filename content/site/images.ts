import { buildStaticPublicImage, seoImageOf, type PublicImage, type SeoImage } from '@/lib/images/public'

import photos from './photos.json'

/**
 * The confirmed launch photographs as the public site renders them.
 *
 * `photos.json` is the one registry — the build-time pipeline
 * (`scripts/images/build-static-derivatives.mjs`) reads the same file to render the
 * derivative ladder into `public/media/`, and this module turns each entry into the
 * `PublicImage` model every public frame already takes. Adding a photograph is one
 * entry in the JSON and one tracked file under `content/launch/photos/`; nothing here
 * changes.
 */

export type PhotoSlot = keyof typeof photos.photos

/** The renderable model of one tracked photograph. */
export function launchPhoto(slot: PhotoSlot): PublicImage {
  const photo = photos.photos[slot]
  return buildStaticPublicImage({ slot, alt: photo.alt, width: photo.width, height: photo.height })
}

/**
 * The same photograph as the one derivative every SEO surface names — the `og:image`,
 * the Twitter card and the structured data's `image` (`seoImageOf`, brief §16).
 *
 * A page hands in the slot it already shows, so the card a shared link renders is a
 * picture of that page: the burger for the Forside and everything without a photograph
 * of its own, the dining room for Om os, the sandwiches for Mad ud af huset. Nothing new
 * was shot for social, and no branded fallback card exists — §11 names one, and it is
 * still an asset the repository does not carry.
 *
 * The ladder tops out at 960 px for the portrait hero, so the share card is that
 * photograph rather than a 1200x630 crop of it; a purpose-shot landscape card is a
 * launch-time improvement, not something to invent here.
 */
export function socialImage(slot: PhotoSlot): SeoImage {
  return seoImageOf(launchPhoto(slot))
}
