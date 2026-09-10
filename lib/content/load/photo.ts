import { isPhotoSlot, launchPhoto } from '@/content/site/images'
import type { PublicImage } from '@/lib/images/public'

/**
 * The photograph a content file names, as the public site renders it.
 *
 * Content refers to a photograph by its **slot** — the key of `content/site/photos.json`,
 * which is also the folder its derivatives are rendered into. That registry stays the
 * one place a photograph is described, so moving content into JSON changes nothing
 * about how images work; `null` is the frame's own no-image state, unchanged.
 *
 * A slot the registry does not carry is refused here, with the name of the thing that
 * asked for it — otherwise the mistake would surface much later as a missing file.
 */
export function resolvePhoto(slot: string | null | undefined, where: string): PublicImage | null {
  if (slot === null || slot === undefined) return null

  if (!isPhotoSlot(slot)) {
    throw new TypeError(`${where}: "${slot}" is not a photograph in content/site/photos.json.`)
  }

  return launchPhoto(slot)
}
