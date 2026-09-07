import { buildStaticPublicImage, type PublicImage } from '@/lib/images/public'

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

/** True when `value` names a photograph the registry actually carries. */
export function isPhotoSlot(value: unknown): value is PhotoSlot {
  return typeof value === 'string' && Object.hasOwn(photos.photos, value)
}
