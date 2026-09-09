#!/usr/bin/env node
/**
 * Render the static site's photographs — the build-time twin of the upload pipeline.
 *
 * Reads the tracked registry `content/site/photos.json`, and for every photograph
 * writes the derivative ladder into `public/media/<slot>/<width>.<format>`:
 * AVIF and WebP, at the rungs `planDerivatives()` chooses for the source size, with
 * the encoder settings the upload flow uses. The ladder, the path grammar and the
 * quality numbers are imported from `lib/images/derivatives.ts` rather than restated,
 * so the files this script writes are exactly the files the page's `srcset` names
 * (`buildStaticPublicImage` in `lib/images/public.ts`).
 *
 * Two refusals keep the registry honest:
 *
 *   * a listed source file that is missing under `content/launch/photos/`;
 *   * a source whose measured dimensions differ from the recorded `width`/`height` —
 *     the page plans its rungs from the recorded numbers, so a wrong record would
 *     name a rung that was never rendered.
 *
 * Idempotent and cheap to rerun: a derivative newer than its source and than this
 * registry is left alone. `npm run build` runs it first (`prebuild`); `npm run dev`
 * too (`predev`). The output directory is git-ignored — the tracked sources are the
 * record, the derivatives are a build product.
 *
 * Node runs this repository's TypeScript directly (type stripping), and the small
 * resolve hook below teaches it the `@/` alias and extensionless relative imports the
 * codebase uses, so the pure modules can be shared without a build step.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REGISTRY = join(ROOT, 'content', 'site', 'photos.json')
const SOURCES = join(ROOT, 'content', 'launch', 'photos')

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = specifier.startsWith('@/')
      ? pathToFileURL(join(ROOT, specifier.slice(2))).href
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

const OUTPUT = join(ROOT, 'public', STATIC_MEDIA_DIRECTORY)

/** @type {{ photos: Record<string, { file: string; width: number; height: number; alt: string | null; focus?: string }> }} */
const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'))
const registryTime = statSync(REGISTRY).mtimeMs

let written = 0
let kept = 0

for (const [slot, photo] of Object.entries(registry.photos)) {
  const source = join(SOURCES, photo.file)
  if (!existsSync(source)) {
    throw new Error(`static images: "${slot}" names ${photo.file}, which is not in content/launch/photos/`)
  }

  const input = readFileSync(source)
  const sniffed = await sharp(input).metadata()
  const rotated = (sniffed.orientation ?? 1) >= 5
  const width = rotated ? sniffed.height : sniffed.width
  const height = rotated ? sniffed.width : sniffed.height

  if (width !== photo.width || height !== photo.height) {
    throw new Error(
      `static images: "${slot}" is recorded as ${photo.width}×${photo.height} but ${photo.file} measures ${width}×${height}. Correct content/site/photos.json.`,
    )
  }

  const sourceTime = Math.max(statSync(source).mtimeMs, registryTime)

  for (const size of planDerivatives(width, height)) {
    for (const format of DERIVATIVE_FORMATS) {
      const target = join(OUTPUT, derivativePath(slot, size.width, format).split('/').join(sep))

      if (existsSync(target) && statSync(target).mtimeMs >= sourceTime) {
        kept += 1
        continue
      }

      const pipeline = sharp(input)
        .rotate()
        .resize({ width: size.width, withoutEnlargement: true })
      const encoded = format === 'avif' ? pipeline.avif({ quality: AVIF_QUALITY }) : pipeline.webp({ quality: WEBP_QUALITY })

      mkdirSync(dirname(target), { recursive: true })
      const info = await encoded.toFile(target)

      if (info.width !== size.width || info.height !== size.height) {
        throw new Error(
          `static images: "${slot}" rendered ${info.width}×${info.height} where ${size.width}×${size.height} was planned.`,
        )
      }
      written += 1
    }
  }
}

console.log(
  `static images: ${Object.keys(registry.photos).length} photograph(s) — ${written} derivative(s) written, ${kept} up to date, in public/${STATIC_MEDIA_DIRECTORY}/`,
)
