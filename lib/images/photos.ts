/**
 * The source-photograph vocabulary — what a content file is allowed to point at, and
 * which derivative folder that means (phase 2 of the CMS migration).
 *
 * Every photograph the site renders is a tracked file in `public/photos/`, named once
 * and referred to by its site-relative path:
 *
 *     "photo": { "file": "/photos/dish-odin.png", "alt": "", "focus": "center" }
 *
 * That is the whole editor-facing model. Nobody types a registry key, a width, a
 * height or a filesystem path; a future Pages CMS image field writes exactly this
 * `file` value, and everything else about the photograph — its measured size, its
 * derivative ladder — is derived by the build.
 *
 * THIS MODULE IS THE GATE. A stored `file` is untrusted input: a CMS rename is a
 * convenience, not a security boundary, so the value is parsed here rather than
 * trusted. {@link photoSlotFrom} accepts only `/photos/<slug>.<ext>` — one segment,
 * a lower-case slug, one of four raster extensions — which is what refuses
 * `../secret.png`, `/photos/../../secret.png`, `https://example.test/x.jpg`,
 * `C:\secret.png`, `/photos/My Burger.png` and `/photos/foo.svg`. The Node side adds
 * the second check the filesystem can make ({@link photoFilePath}): the resolved file
 * must sit inside `public/photos/` and nowhere else.
 *
 * THE SLUG IS THE SLOT. `/photos/dish-odin.png` renders its derivatives into
 * `public/media/dish-odin/`, so the file name an editor uploads is the only name in
 * the system. Two sources that would claim one slot (`dish-odin.png` and
 * `dish-odin.jpg`) are a build failure rather than a race — see the build script.
 *
 * Pure: no filesystem, no `sharp`, no Node-only API below {@link photoFilePath}, so
 * the browser-facing bundle can hold the same rules the build enforces.
 */

/** The tracked source directory, under `public/` so a future CMS can write into it. */
export const PHOTO_SOURCE_DIRECTORY = 'photos'

/** How a content file names a source photograph. */
export const PHOTO_URL_PREFIX = `/${PHOTO_SOURCE_DIRECTORY}/`

/**
 * The extensions a source photograph may carry — the raster formats `sharp` reads and
 * a browser could have produced. No SVG (it is markup, and markup is not a photograph),
 * no AVIF source (the ladder writes AVIF; it does not take it), no TIFF, no HEIC.
 */
export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const
export type PhotoExtension = (typeof PHOTO_EXTENSIONS)[number]

/**
 * The one shape a file name's stem may take: lower-case letters and digits in
 * hyphen-separated words. It is what a "safe" CMS rename produces, it is a legal path
 * segment on every filesystem, and it is a legal URL path segment unescaped — so the
 * name on disk, the slot, and the derivative URL are the same string throughout.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The parsed form of a stored `file` value. */
export type PhotoSource = {
  /** The derivative folder and the internal name of the photograph: the stem. */
  readonly slot: string
  /** The file name under `public/photos/`, as stored: `dish-odin.png`. */
  readonly fileName: string
  readonly extension: PhotoExtension
}

function refuse(where: string, value: unknown, why: string): never {
  throw new TypeError(
    `${where}: ${JSON.stringify(value)} is not a usable photograph — ${why}. ` +
      `A photograph is a file in public/photos/, written as "${PHOTO_URL_PREFIX}<navn>.<${PHOTO_EXTENSIONS.join('|')}>".`,
  )
}

/**
 * The photograph a stored `file` value names, or a refusal that says which content
 * field is wrong.
 *
 * The accepted grammar, in full: `/photos/`, then one path segment that is a
 * {@link SLUG}, then `.`, then one of {@link PHOTO_EXTENSIONS} in lower case. Anything
 * else — a second segment, a `..`, a backslash, a space, an upper-case letter, a query
 * string, a scheme, an underscore, a second dot — is refused.
 */
export function photoSourceFrom(file: unknown, where: string): PhotoSource {
  if (typeof file !== 'string') refuse(where, file, 'it is not a path')

  const value = file.trim()
  if (value !== file) refuse(where, file, 'it has surrounding whitespace')
  if (!value.startsWith(PHOTO_URL_PREFIX)) {
    refuse(where, file, `it does not start with "${PHOTO_URL_PREFIX}"`)
  }

  const name = value.slice(PHOTO_URL_PREFIX.length)
  if (name.length === 0) refuse(where, file, 'it names no file')
  // One segment only. This is what refuses `..`, a nested path and a Windows path;
  // the filesystem check in `photoFilePath` is the second lock on the same door.
  if (name.includes('/') || name.includes('\\')) {
    refuse(where, file, 'a photograph is one file directly in public/photos/, not a path')
  }

  const dot = name.lastIndexOf('.')
  if (dot <= 0) refuse(where, file, 'it has no file extension')

  const stem = name.slice(0, dot)
  const extension = name.slice(dot + 1)

  if (!SLUG.test(stem)) {
    refuse(
      where,
      file,
      'the name must be lower-case letters, digits and single hyphens (no spaces, no underscores, no dots)',
    )
  }
  if (!(PHOTO_EXTENSIONS as readonly string[]).includes(extension)) {
    refuse(where, file, `"${extension}" is not one of ${PHOTO_EXTENSIONS.join(', ')}`)
  }

  return { slot: stem, fileName: name, extension: extension as PhotoExtension }
}

/** The derivative folder a stored `file` value means: `/photos/dish-odin.png` → `dish-odin`. */
export function photoSlotFrom(file: unknown, where: string): string {
  return photoSourceFrom(file, where).slot
}

/** The stored `file` value for a file name on disk: `dish-odin.png` → `/photos/dish-odin.png`. */
export function photoUrlFor(fileName: string): string {
  return `${PHOTO_URL_PREFIX}${fileName}`
}

/** True when a directory entry is a file this pipeline would read. */
export function isPhotoFileName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return (
    dot > 0 &&
    SLUG.test(name.slice(0, dot)) &&
    (PHOTO_EXTENSIONS as readonly string[]).includes(name.slice(dot + 1))
  )
}
