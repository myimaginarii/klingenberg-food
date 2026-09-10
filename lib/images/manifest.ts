import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'

import { PHOTO_SOURCE_DIRECTORY, isPhotoFileName, photoUrlFor, type PhotoSource } from './photos'

/**
 * The generated image manifest — the measured size of every tracked source photograph.
 *
 * WHY IT EXISTS. `public/photos/` is the record: an editor uploads a photograph there
 * and names it in the content, and nothing else. But a page still needs the intrinsic
 * `width`/`height` to reserve its box, and the derivative ladder still has to be
 * planned from the source size. Measuring an image needs `sharp`, which has no place
 * in the rendered module graph, so the measurement happens once at build time and is
 * written here:
 *
 *     public/photos/dish-odin.png
 *         → prebuild measures it with sharp
 *         → renders public/media/dish-odin/<width>.<avif|webp>
 *         → records { "dish-odin": { file, width, height } } in this manifest
 *         → next build reads it and SiteImage renders the ladder
 *
 * WHAT IT IS NOT. It is not content and it is not a source of truth: it states only
 * what `sharp` measured, it is regenerated from `public/photos/` on every build, and
 * it is git-ignored. Delete it and the next `npm run build`, `npm run dev` or
 * `npm test` writes it again. Nothing may be authored into it — a photograph's
 * description and crop live with the content that shows the photograph.
 *
 * The ladder itself is deliberately *not* stored: `planDerivatives()` derives it from
 * the measured size, and the build script and `lib/images/public.ts` already share
 * that one function. Recording the rungs here would be a second copy of a derivation
 * that cannot disagree with itself.
 *
 * THE SIZE OF THE THING. Seven photographs. This is an index of a small folder, not an
 * asset database: no hashes, no EXIF, no history, no upload records.
 */

/** `public/photos/` — where the tracked source photographs live, relative to the repository. */
export const PHOTO_SOURCE_ROOT = ['public', PHOTO_SOURCE_DIRECTORY] as const

/** Where the generated manifest is written, relative to the repository. Git-ignored. */
export const IMAGE_MANIFEST_ROOT = ['generated', 'images.json'] as const

/** The manifest path as a person reading an error sees it. */
export const IMAGE_MANIFEST_PATH = IMAGE_MANIFEST_ROOT.join('/')

/** One measured source photograph. */
export type PhotoMeasurement = {
  /** The file under `public/photos/`, as stored in the content: `dish-odin.png`. */
  readonly file: string
  /** The measured source dimensions, orientation applied. */
  readonly width: number
  readonly height: number
}

/** Every tracked photograph the build measured, by slot. */
export type ImageManifest = {
  readonly photos: Readonly<Record<string, PhotoMeasurement>>
}

/** `<root>/public/photos` — the one directory a photograph may come from. */
export function photosDirectory(root: string): string {
  return join(root, ...PHOTO_SOURCE_ROOT)
}

/** `<root>/generated/images.json`. */
export function manifestPath(root: string): string {
  return join(root, ...IMAGE_MANIFEST_ROOT)
}

/**
 * The absolute path of one source photograph, proven to be inside `public/photos/`.
 *
 * `photoSourceFrom()` has already refused every path shape that could escape, so this
 * is the second lock rather than the first: the resolved path is compared against the
 * resolved directory, which is the check that survives a symlink, a stray separator or
 * a future relaxation of the grammar. A name that does not belong to this pipeline at
 * all is refused here too, so nothing can ask for `../../.env` by calling it a photo.
 */
export function photoFilePath(root: string, fileName: string): string {
  if (!isPhotoFileName(fileName) || isAbsolute(fileName)) {
    throw new Error(
      `image source: "${fileName}" is not a photograph in public/${PHOTO_SOURCE_DIRECTORY}/.`,
    )
  }

  const directory = resolve(photosDirectory(root))
  const file = resolve(directory, fileName)

  if (!file.startsWith(directory + sep)) {
    throw new Error(
      `image source: "${fileName}" resolves outside public/${PHOTO_SOURCE_DIRECTORY}/.`,
    )
  }

  return file
}

/** A measurement is only useful if it is a real pixel size. */
function assertMeasurement(slot: string, entry: unknown): PhotoMeasurement {
  const photo = entry as Partial<PhotoMeasurement> | null
  const usable =
    photo !== null &&
    typeof photo === 'object' &&
    typeof photo.file === 'string' &&
    Number.isInteger(photo.width) &&
    Number.isInteger(photo.height) &&
    (photo.width as number) > 0 &&
    (photo.height as number) > 0

  if (!usable) {
    throw new Error(
      `${IMAGE_MANIFEST_PATH}: "${slot}" has no usable dimensions. ` +
        'Delete the file and let the next build write it again.',
    )
  }

  return photo as PhotoMeasurement
}

const cache = new Map<string, ImageManifest>()

/**
 * The manifest, parsed once per repository root per process.
 *
 * A missing file is the one failure worth explaining rather than reporting: it means
 * the prebuild step did not run, which is a one-command fix and not a broken checkout.
 */
export function readImageManifest(root: string = process.cwd()): ImageManifest {
  const path = manifestPath(root)
  const remembered = cache.get(path)
  if (remembered !== undefined) return remembered

  let file: string
  try {
    file = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new Error(
      `The generated image manifest is missing (${IMAGE_MANIFEST_PATH}). It is written ` +
        'from public/photos/ by the "images:static" script, which the dev, build and test ' +
        'commands all run first. Run it once and try again.',
      { cause },
    )
  }

  const parsed = JSON.parse(file) as { photos?: Record<string, unknown> }
  const photos: Record<string, PhotoMeasurement> = {}
  for (const [slot, entry] of Object.entries(parsed.photos ?? {})) {
    photos[slot] = assertMeasurement(slot, entry)
  }

  const manifest: ImageManifest = { photos }
  cache.set(path, manifest)
  return manifest
}

/**
 * The measurement of the photograph a content field names, or a refusal that names
 * both the field and the file.
 *
 * Two mistakes reach here, and only an editor can make either: naming a photograph
 * that is not in `public/photos/` (deleted, or never uploaded), and naming one whose
 * extension has changed under it — `dish-odin.jpg` where the folder now holds
 * `dish-odin.png`. Both would otherwise surface much later as a missing derivative.
 */
export function photoMeasurementOf(source: PhotoSource, where: string): PhotoMeasurement {
  const photo = readImageManifest().photos[source.slot]
  const named = photoUrlFor(source.fileName)

  if (photo === undefined) {
    throw new Error(
      `${where}: "${named}" is not a photograph in public/${PHOTO_SOURCE_DIRECTORY}/. ` +
        'Upload it there, or point the field at one that is.',
    )
  }

  if (photo.file !== source.fileName) {
    throw new Error(
      `${where}: "${named}" is not in public/${PHOTO_SOURCE_DIRECTORY}/ — that folder holds ` +
        `"${photo.file}", a different file under the same name.`,
    )
  }

  return photo
}
