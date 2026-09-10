#!/usr/bin/env node
/**
 * Measure the tracked photographs, render their derivatives, and write the manifest.
 *
 * This is the whole image pipeline, and it runs before every `next dev`, `next build`
 * and `vitest` (`predev`, `prebuild`, `pretest`). It reads one directory and writes two
 * things:
 *
 *     public/photos/<slug>.<jpg|jpeg|png|webp>     the tracked sources — the record
 *         ↓  measured with sharp
 *     generated/images.json                        the manifest the pages read
 *     public/media/<slug>/<width>.<avif|webp>      the derivative ladder a browser gets
 *
 * WHY THE DIRECTORY IS THE REGISTRY. Before this, a photograph existed only if somebody
 * also wrote its slot, its source file name and its measured width and height into a
 * JSON registry by hand. An editor cannot know any of those. Now the file *is* the
 * entry: its name is its slot, its pixels are its dimensions, and the content that
 * shows it names it as `/photos/<file>`. A future Pages CMS image field uploads into
 * this same directory and writes that same value, with nothing else to keep in step.
 *
 * The ladder, the encoder settings and the path grammar are imported from
 * `lib/images/derivatives.ts`, and the name rules from `lib/images/photos.ts`, rather
 * than restated — so the files this script writes are exactly the files a page's
 * `srcset` names (`buildStaticPublicImage` in `lib/images/public.ts`), and a name this
 * script accepts is exactly one the content loader accepts.
 *
 * WHAT IT REFUSES, all of it naming the file:
 *
 *   * a name that is not `<lower-case-slug>.<jpg|jpeg|png|webp>` — an editor's upload
 *     is untrusted input, and a name that cannot be a slot cannot be a photograph;
 *   * two sources that would claim one slot (`dish-odin.png` and `dish-odin.jpg`),
 *     which would otherwise be a silent race over one derivative folder;
 *   * a file `sharp` cannot read, or one that measures as no pixels at all;
 *   * a rendered derivative whose size is not the size that was planned.
 *
 * IT RECONCILES. `public/media/` is made to hold exactly the derivatives the current
 * sources plan and nothing else: a deleted photograph's folder, a replaced
 * photograph's now-unplanned rungs and anything else that has drifted in are removed.
 * A stale folder that still looked valid was the one way this build could serve a
 * photograph that no longer exists.
 *
 * Idempotent and cheap to rerun: a derivative newer than its source is left alone, so
 * the second run is instantaneous. The output and the manifest are both git-ignored —
 * the sources and the content are the record, everything here is a build product.
 *
 * Paths are resolved from the working directory, which is the repository root for
 * every script that runs this; the module resolution below stays anchored to this
 * file, so the pure TypeScript modules can be shared without a build step. Node runs
 * this repository's TypeScript directly (type stripping), and the small resolve hook
 * teaches it the `@/` alias and the extensionless relative imports the codebase uses.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import sharp from 'sharp'

/** The repository this script belongs to — where its own imports resolve from. */
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The tree being built. The same directory in every real run; a fixture under test. */
const ROOT = process.cwd()

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = specifier.startsWith('@/')
      ? pathToFileURL(join(PROJECT, specifier.slice(2))).href
      : specifier
    let resolved
    try {
      resolved = nextResolve(mapped, context)
    } catch (error) {
      if (/\.(m?[jt]s)$/.test(mapped) || !/^(\.{1,2}\/|file:)/.test(mapped)) throw error
      resolved = nextResolve(`${mapped}.ts`, context)
    }
    // The repository's TypeScript is ES modules; saying so spares Node a reparse.
    return resolved.url.endsWith('.ts') ? { ...resolved, format: 'module-typescript' } : resolved
  },
})

const {
  AVIF_QUALITY,
  DERIVATIVE_FORMATS,
  STATIC_MEDIA_DIRECTORY,
  WEBP_QUALITY,
  derivativePath,
  planDerivatives,
} = await import('../../lib/images/derivatives.ts')

const { PHOTO_EXTENSIONS, PHOTO_SOURCE_DIRECTORY, isPhotoFileName } = await import(
  '../../lib/images/photos.ts'
)

const { IMAGE_MANIFEST_PATH, manifestPath, photoFilePath, photosDirectory } = await import(
  '../../lib/images/manifest.ts'
)

const SOURCES = photosDirectory(ROOT)
const OUTPUT = join(ROOT, 'public', STATIC_MEDIA_DIRECTORY)
const MANIFEST = manifestPath(ROOT)

const fail = (message) => {
  throw new Error(`static images: ${message}`)
}

/**
 * Every source photograph, by slot — the directory read as the registry it is.
 *
 * Anything that is not a usable photograph name stops the build rather than being
 * skipped: a file quietly ignored here is a photograph an editor uploaded and cannot
 * find, which is worse than a message saying what to rename.
 */
function readSources() {
  if (!existsSync(SOURCES)) {
    fail(`public/${PHOTO_SOURCE_DIRECTORY}/ does not exist. It is where the site's photographs live.`)
  }

  const bySlot = new Map()

  for (const entry of readdirSync(SOURCES, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory()) {
      fail(
        `public/${PHOTO_SOURCE_DIRECTORY}/${entry.name}/ is a folder. Photographs sit directly in that directory.`,
      )
    }
    if (!entry.isFile()) continue
    // The one thing that is not a photograph and is not a mistake.
    if (entry.name === '.gitkeep') continue

    if (!isPhotoFileName(entry.name)) {
      fail(
        `public/${PHOTO_SOURCE_DIRECTORY}/${entry.name} cannot be used. A photograph is named with ` +
          `lower-case letters, digits and single hyphens, and ends in ${PHOTO_EXTENSIONS.join(', ')}.`,
      )
    }

    const slot = entry.name.slice(0, entry.name.lastIndexOf('.'))
    const taken = bySlot.get(slot)
    if (taken !== undefined) {
      fail(
        `public/${PHOTO_SOURCE_DIRECTORY}/${taken} and public/${PHOTO_SOURCE_DIRECTORY}/${entry.name} ` +
          `would both be "${slot}" and would overwrite each other's derivatives. Rename or remove one.`,
      )
    }
    bySlot.set(slot, entry.name)
  }

  return [...bySlot.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** The source's dimensions with its orientation applied, or a refusal naming the file. */
async function measure(file, input) {
  let metadata
  try {
    metadata = await sharp(input).metadata()
  } catch (cause) {
    throw new Error(
      `static images: public/${PHOTO_SOURCE_DIRECTORY}/${file} could not be read as an image.`,
      { cause },
    )
  }

  const rotated = (metadata.orientation ?? 1) >= 5
  const width = rotated ? metadata.height : metadata.width
  const height = rotated ? metadata.width : metadata.height

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    fail(`public/${PHOTO_SOURCE_DIRECTORY}/${file} measures ${width}×${height}, which is not a picture.`)
  }

  return { width, height }
}

/**
 * Make `public/media/` hold exactly `expected` and nothing else.
 *
 * Only ever inside the output directory, and only the two shapes this script writes:
 * a slot folder, and a `<width>.<format>` file inside one. Anything else that has
 * appeared there is a leftover of an earlier build, which is exactly what has to go.
 */
function reconcile(expected) {
  if (!existsSync(OUTPUT)) return 0

  let removed = 0

  for (const entry of readdirSync(OUTPUT, { withFileTypes: true })) {
    const path = join(OUTPUT, entry.name)
    const planned = expected.get(entry.name)

    if (planned === undefined || !entry.isDirectory()) {
      rmSync(path, { recursive: true, force: true })
      removed += 1
      continue
    }

    for (const file of readdirSync(path, { withFileTypes: true })) {
      if (file.isFile() && planned.has(file.name)) continue
      rmSync(join(path, file.name), { recursive: true, force: true })
      removed += 1
    }
  }

  return removed
}

const sources = readSources()
const manifest = { photos: {} }
/** slot → the set of file names that slot's folder should contain. */
const expected = new Map()

let written = 0
let kept = 0

for (const [slot, file] of sources) {
  const input = readFileSync(photoFilePath(ROOT, file))
  const { width, height } = await measure(file, input)

  manifest.photos[slot] = { file, width, height }

  const sourceTime = statSync(photoFilePath(ROOT, file)).mtimeMs
  const names = new Set()
  expected.set(slot, names)

  for (const size of planDerivatives(width, height)) {
    for (const format of DERIVATIVE_FORMATS) {
      const relative = derivativePath(slot, size.width, format)
      names.add(relative.slice(relative.indexOf('/') + 1))

      const target = join(OUTPUT, relative.split('/').join(sep))

      if (existsSync(target) && statSync(target).mtimeMs >= sourceTime) {
        kept += 1
        continue
      }

      const pipeline = sharp(input).rotate().resize({ width: size.width, withoutEnlargement: true })
      const encoded =
        format === 'avif'
          ? pipeline.avif({ quality: AVIF_QUALITY })
          : pipeline.webp({ quality: WEBP_QUALITY })

      mkdirSync(dirname(target), { recursive: true })
      const info = await encoded.toFile(target)

      if (info.width !== size.width || info.height !== size.height) {
        fail(`"${slot}" rendered ${info.width}×${info.height} where ${size.width}×${size.height} was planned.`)
      }
      written += 1
    }
  }
}

const removed = reconcile(expected)

mkdirSync(dirname(MANIFEST), { recursive: true })
writeFileSync(
  MANIFEST,
  `${JSON.stringify(
    {
      $comment:
        `Generated by scripts/images/build-static-derivatives.mjs from public/${PHOTO_SOURCE_DIRECTORY}/. ` +
        'Not content, not edited by hand, not committed — every build writes it again.',
      ...manifest,
    },
    null,
    2,
  )}\n`,
)

console.log(
  `static images: ${sources.length} photograph(s) — ${written} derivative(s) written, ${kept} up to date, ` +
    `${removed} stale entr(ies) removed, in public/${STATIC_MEDIA_DIRECTORY}/; measured into ${IMAGE_MANIFEST_PATH}`,
)
