import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

/**
 * The image-domain boundary — technical plan §1 (adjustment 2), §8; phase 10A.
 *
 * Four properties the plan states in prose, held here over the real source tree,
 * in the family of public-javascript.test.ts:
 *
 *   1. **The service-role client has one caller.** §8 confines the key to
 *      `lib/supabase/service.ts`; phase 10A gave it its first legitimate importer,
 *      `lib/images/storage.ts`, and that must remain the only one — a second
 *      importer is a decision, not an accident.
 *   2. **sharp stays on the trusted server.** Only `lib/images/processing.ts` may
 *      import it; a browser bundle with an image decoder in it is a build error
 *      waiting to be misread.
 *   3. **No client component reaches the image server modules.**
 *   4. **`image_id` is still owned by no editor** (§0b–§0s, §15): not in any
 *      editor field list, and no form control anywhere submits it. Phase 10C is
 *      the phase that changes this, deliberately.
 *
 * Raw storage URLs are also pinned: exactly one module may compose a
 * `/storage/v1/` path, so a hand-built storage address elsewhere fails a test
 * instead of shipping.
 */

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabasePublicClient: vi.fn(),
}))

const ROOT = process.cwd()
const SOURCE_DIRECTORIES = ['app', 'components', 'lib']

/** The one module that may construct the service client (§8, phase 10A). */
const SERVICE_CLIENT_IMPORTERS = ['lib/images/storage.ts']

/** The one module that may import sharp (§1 adjustment 3, §22). */
const SHARP_IMPORTERS = ['lib/images/processing.ts']

/** The one module that may compose a raw storage URL path. */
const STORAGE_URL_COMPOSERS = ['lib/images/derivatives.ts']

/** The image modules that must never reach a client bundle. */
const SERVER_ONLY_IMAGE_MODULES = [
  '@/lib/images/storage',
  '@/lib/images/processing',
  '@/lib/images/finalize',
  '@/lib/images/signed-upload',
]

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (/\.tsx?$/.test(full)) {
      yield full
    }
  }
}

type SourceFile = { path: string; source: string }

function read(absolute: string): SourceFile {
  return {
    path: relative(ROOT, absolute).split(sep).join('/'),
    source: readFileSync(absolute, 'utf8'),
  }
}

/** Strip comments, so a boundary documented in prose does not trip its own test. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const sourceFiles: SourceFile[] = SOURCE_DIRECTORIES.flatMap((directory) =>
  [...walk(join(ROOT, directory))].map(read),
)

const clientFiles = sourceFiles.filter((file) => /^\s*['"]use client['"]/m.test(file.source))

describe('the service-role boundary', () => {
  it('found the tree it polices', () => {
    expect(sourceFiles.length).toBeGreaterThan(20)
  })

  it('exactly one module imports the service client', () => {
    const importers = sourceFiles
      .filter((file) => file.path !== 'lib/supabase/service.ts')
      .filter((file) => /from '@\/lib\/supabase\/service'/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()

    expect(importers).toEqual(SERVICE_CLIENT_IMPORTERS)
  })

  it('exactly one module imports sharp', () => {
    const importers = sourceFiles
      .filter((file) => /from 'sharp'/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()

    expect(importers).toEqual(SHARP_IMPORTERS)
  })

  it('exactly one module composes a raw storage URL path', () => {
    const composers = sourceFiles
      .filter((file) => codeOf(file.source).includes('/storage/v1/'))
      .map((file) => file.path)
      .sort()

    expect(composers).toEqual(STORAGE_URL_COMPOSERS)
  })

  it('no client component reaches an image server module', () => {
    for (const file of clientFiles) {
      for (const specifier of SERVER_ONLY_IMAGE_MODULES) {
        expect(file.source, `${file.path} imports ${specifier}`).not.toContain(specifier)
      }
    }
  })
})

describe('image_id stays unowned until 10C', () => {
  it('is in no editor field list', async () => {
    const { DISH_EDITOR_FIELDS } = await import('@/lib/menu/admin')
    const { WEEK_EDITOR_FIELDS, SATURDAY_EDITOR_FIELDS } = await import('@/lib/menu/weekly')
    const { MONTHLY_EDITOR_FIELDS } = await import('@/lib/menu/monthly')

    for (const fields of [
      DISH_EDITOR_FIELDS,
      WEEK_EDITOR_FIELDS,
      SATURDAY_EDITOR_FIELDS,
      MONTHLY_EDITOR_FIELDS,
    ]) {
      expect(fields).not.toContain('image_id')
    }
  })

  it('is in no news input shape', async () => {
    const { newsArticleInput } = await import('@/lib/schemas/news')
    expect(Object.keys(newsArticleInput.shape)).not.toContain('image_id')
  })

  it('is submitted by no form control anywhere', () => {
    const offenders = sourceFiles
      .filter((file) => /name=["']image_id["']/.test(codeOf(file.source)))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })
})
