import { photoMeasurementOf } from '@/lib/images/manifest'
import { photoSourceFrom } from '@/lib/images/photos'
import {
  buildStaticPublicImage,
  IMAGE_FOCUSES,
  type ImageFocus,
  type PublicImage,
} from '@/lib/images/public'

/**
 * The photograph a content field selects, as the public site renders it.
 *
 * THE FIELD. A photograph is an object on the thing that shows it — the dish, the
 * page section, the article — and never a registry key held somewhere else:
 *
 *     "photo": { "file": "/photos/dish-frigg.png", "alt": "", "focus": "upper" }
 *
 *   * `file`   the photograph in `public/photos/`. The only value an editor picks,
 *              and the only one a Pages CMS image field has to write.
 *   * `alt`    what a screen reader hears. Empty is a valid, deliberate answer — see
 *              below — and nothing is ever invented to fill it.
 *   * `focus`  which part of the photograph a frame keeps when it has to crop, from a
 *              closed vocabulary (`center`, `upper`). Absent means `center`.
 *
 * `null`, or an absent field, is the frame's own no-image state: the menu's reserved
 * "Retfoto" card, the Om os text-only sections, a page whose text takes the full width.
 * That is a real answer too, so it is spelled `null` rather than faked with a
 * placeholder file.
 *
 * WHAT AN EDITOR NO LONGER MAINTAINS. Width, height, a registry slot, a source
 * directory and a derivative folder: all of that is measured from the file itself by
 * the build (`generated/images.json`) and derived from its name. Uploading a
 * photograph and selecting it is the whole task.
 *
 * WHY THE PARSING IS HERE. A stored `file` is untrusted: it is whatever was written
 * into a JSON file, and a future CMS's "safe rename" is a convenience rather than a
 * security boundary. `photoSourceFrom` refuses anything that is not one plainly-named
 * file directly in `public/photos/`, and the manifest lookup refuses one that is not
 * actually there. Both refusals name the content field, because the person who has to
 * fix it is looking at the content.
 */

/** The stored shape of a selected photograph. */
export type PhotoField = {
  file?: unknown
  alt?: unknown
  focus?: unknown
}

/** True for the values that mean "this frame has no photograph". */
function isAbsent(value: unknown): value is null | undefined | '' {
  return value === null || value === undefined || value === ''
}

/**
 * The crop, from the closed vocabulary and nothing else.
 *
 * `focus` is a named choice rather than a CSS value on purpose (see `ImageFocus`):
 * the site's `style-src` is `'self'`, so an inline `object-position` could not be
 * written even if a field offered one, and an editor should be choosing between two
 * framings rather than typing coordinates. An unknown name is refused by field name.
 */
function focusFrom(value: unknown, where: string): ImageFocus | null {
  if (isAbsent(value)) return null

  const focus = IMAGE_FOCUSES.find((name) => name === value)
  if (focus === undefined) {
    throw new TypeError(
      `${where}: "${String(value)}" is not a crop. Use ${IMAGE_FOCUSES.map((name) => `"${name}"`).join(' or ')}.`,
    )
  }

  return focus
}

export function resolvePhoto(
  photo: PhotoField | null | undefined,
  where: string,
): PublicImage | null {
  if (isAbsent(photo)) return null

  if (typeof photo !== 'object' || Array.isArray(photo)) {
    throw new TypeError(
      `${where}: a photograph is an object with a "file", or null. Got ${JSON.stringify(photo)}.`,
    )
  }

  const field: PhotoField = photo

  // A selected-but-emptied image field — a CMS clearing the file but leaving the
  // object behind — is the no-image state, not a broken reference.
  if (isAbsent(field.file)) return null

  const source = photoSourceFrom(field.file, where)
  const measured = photoMeasurementOf(source, where)

  return buildStaticPublicImage({
    slot: source.slot,
    alt: typeof field.alt === 'string' ? field.alt : null,
    width: measured.width,
    height: measured.height,
    focus: focusFrom(field.focus, where),
  })
}
