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
 *   4. **`image_id` is owned by exactly the 10C-1 selection paths** (§15, phase
 *      brief §29). The old rule — absent from every content form — was replaced
 *      deliberately in 10C-1 by the narrower truth asserted below: the id may
 *      travel only through the shared picker components and the four image
 *      Server Actions, it stays outside every content editor's field list, and
 *      it can never carry storage metadata.
 *
 * Raw storage URLs are also pinned: exactly one module may compose a
 * `/storage/v1/` path, so a hand-built storage address elsewhere fails a test
 * instead of shipping.
 *
 *   5. **Public rendering is derivative-only and has one renderer** (phase
 *      10C-2, brief §39). The private bucket's name lives in the rules module
 *      alone; every `<picture>`/`srcSet` on the public site is written by
 *      `components/site/SiteImage.tsx`; the public image model is composed only
 *      by `lib/images/public.ts` over the central path builder; no entity schema
 *      carries an alt-text field of its own; and no image proxy, optimizer or
 *      request-time transformation exists.
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

/** The one module that may name the private bucket (phase 10C-2, brief §39). */
const PRIVATE_BUCKET_NAMERS = ['lib/images/rules.ts']

/** The two renderers of a library image: the public site's, and the admin thumbnail. */
const PICTURE_RENDERERS = [
  'components/admin/images/ImageThumbnail.tsx',
  'components/site/SiteImage.tsx',
]

/** The one module that composes the public image model from a stored row. */
const PUBLIC_IMAGE_COMPOSERS = ['lib/images/public.ts']

/** The image modules that must never reach a client bundle. */
const SERVER_ONLY_IMAGE_MODULES = [
  '@/lib/images/storage',
  '@/lib/images/processing',
  '@/lib/images/finalize',
  '@/lib/images/signed-upload',
  '@/lib/images/admin',
  '@/lib/content/images-admin',
]

/** The one module that may PUT bytes to a signed upload URL (phase 10B, §31). */
const UPLOAD_PUT_MODULE = 'lib/images/client-upload.ts'

/** The modules that may remove storage objects — always server-side (§31). */
const STORAGE_REMOVAL_MODULES = [
  'lib/images/admin.ts',
  'lib/images/finalize.ts',
  'lib/images/storage.ts',
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

  it('the upload PUT lives in exactly one module (phase 10B, §31)', () => {
    // The one fetch that carries image bytes. Everything else the uploader does
    // goes through Server Actions, so a second raw upload request anywhere is a
    // failing test rather than a review finding.
    const putters = sourceFiles
      .filter((file) => /method:\s*'PUT'/.test(codeOf(file.source)))
      .map((file) => file.path)

    expect(putters).toEqual([UPLOAD_PUT_MODULE])
  })

  it('privileged storage removal happens only in the server image modules', () => {
    const removers = sourceFiles
      .filter((file) => /removeOriginal|removeDerivatives/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()

    expect(removers).toEqual(STORAGE_REMOVAL_MODULES)
  })

  it('the delete action derives storage paths from the server, never the form', () => {
    const action = sourceFiles.find(
      (file) => file.path === 'app/(admin)/admin/billeder/delete-actions.ts',
    )

    expect(action).toBeDefined()
    const code = codeOf(action!.source)
    // The trusted derivation is read server-side…
    expect(code).toContain('readImageStorageFacts')
    // …and no storage identity has a form field or a parse anywhere in the file.
    expect(code).not.toContain('storage_path')
    expect(code).not.toContain('storagePath')
  })

  it('no form control anywhere submits a storage path', () => {
    const offenders = sourceFiles
      .filter((file) => /name=["'](storage_path|storagePath|sti)["']/.test(codeOf(file.source)))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('the image form vocabulary is exactly its four fields (§21)', async () => {
    const { IMAGES_FORM } = await import('@/app/(admin)/admin/billeder/image-form')

    expect(Object.values(IMAGES_FORM).sort()).toEqual([
      'bekraeftet',
      'beskrivelse',
      'billede',
      'version',
    ])
  })
})

describe('image_id is owned by exactly the 10C-1 selection paths (§29)', () => {
  /**
   * The shared picker pair — the only components that render an image-selection
   * control — and the four Server Actions that parse one, one per approved editor.
   * A fifth entry in either list is a decision, not an accident.
   */
  const PICKER_COMPONENTS = [
    'components/admin/images/ImagePickerDialog.tsx',
    'components/admin/images/ImagePickerField.tsx',
  ]

  const SELECTION_ACTIONS = [
    // Phase 11A: the Forside's three slots, one action, Owner only.
    'app/(admin)/admin/forsiden/image-actions.ts',
    // Phase 11B: Mad ud af huset's one slot, one action, Staff and Owner.
    'app/(admin)/admin/mad-ud-af-huset/image-actions.ts',
    'app/(admin)/admin/menu/image-actions.ts',
    'app/(admin)/admin/menu/maanedens-burger/image-actions.ts',
    'app/(admin)/admin/menu/ugens-ret/image-actions.ts',
    'app/(admin)/admin/nyheder/image-actions.ts',
  ]

  it('stays outside every content editor field list — the picker owns it', async () => {
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

  it('is in the news input shape — the one news save path restates it (10C-1)', async () => {
    const { newsArticleInput } = await import('@/lib/schemas/news')
    expect(Object.keys(newsArticleInput.shape)).toContain('image_id')
  })

  it('is submitted by no literally-named form control anywhere', () => {
    const offenders = sourceFiles
      .filter((file) => /name=["']image_id["']/.test(codeOf(file.source)))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('the selection control is rendered only by the shared picker components', () => {
    const renderers = sourceFiles
      .filter((file) => /name=\{IMAGE_SELECT_FORM\.image\}/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()

    expect(renderers).toEqual(PICKER_COMPONENTS)
  })

  it('a selection is parsed only by the four approved image actions', () => {
    const parsers = sourceFiles
      .filter((file) => /readImageSelectionForm\(/.test(codeOf(file.source)))
      .filter((file) => file.path !== 'lib/images/selection.ts')
      .map((file) => file.path)
      .sort()

    expect(parsers).toEqual(SELECTION_ACTIONS)
  })

  it('is written to no draft entity by any application statement — the database transitions own it', () => {
    // The live column on dishes, weekly_special and monthly_burger is guarded in
    // the database (migration 20260901200000): only publish_dish(),
    // publish_weekly_special(), publish_monthly_burger(), replace_image() and a
    // confirmed delete_image() may move it, and a PostgREST payload naming it on
    // those tables is refused at run time. The database is the boundary; this
    // pins that the application never even tries. News is the deliberate
    // exception — it has no draft layer (§4), and its one save path restates
    // image_id, exactly as 10C-1 accepted.
    const writers = sourceFiles
      .filter((file) =>
        /\.(update|insert|upsert)\(\{[^}]*\bimage_id\b/.test(codeOf(file.source)),
      )
      .map((file) => file.path)
      .sort()

    expect(writers).toEqual(['lib/news/admin.ts'])
  })

  it('every image action verifies existence before writing (brief §6)', () => {
    for (const path of SELECTION_ACTIONS) {
      const action = sourceFiles.find((file) => file.path === path)
      expect(action, path).toBeDefined()
      expect(codeOf(action!.source), `${path} must existence-check the id`).toContain(
        'imageExists',
      )
    }
  })
})

describe('public rendering is derivative-only, through one renderer (phase 10C-2, §39)', () => {
  it('the private bucket is named in the rules module and nowhere else', () => {
    const namers = sourceFiles
      .filter((file) => codeOf(file.source).includes('media-originals'))
      .map((file) => file.path)
      .sort()

    expect(namers).toEqual(PRIVATE_BUCKET_NAMERS)
  })

  it('no public or client module reaches the private bucket constant', () => {
    const reachers = sourceFiles
      .filter((file) => /\bORIGINALS_BUCKET\b/.test(codeOf(file.source)))
      .filter((file) => file.path !== 'lib/images/rules.ts')
      .map((file) => file.path)
      .sort()

    // Only the trusted storage module (service role, server-only) may name it.
    expect(reachers).toEqual(['lib/images/storage.ts'])
    for (const file of clientFiles) {
      expect(codeOf(file.source), file.path).not.toContain('ORIGINALS_BUCKET')
    }
  })

  it('a <picture> with a srcset is written by exactly the two renderers', () => {
    const renderers = sourceFiles
      .filter((file) => /<picture\b/.test(codeOf(file.source)) || /\bsrcSet=/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()

    expect(renderers).toEqual(PICTURE_RENDERERS)
  })

  it('no public component renders a raw <img> of its own', () => {
    // The public site's photographs go through SiteImage; the only other <img> on
    // the public site is the static map (§7g), which is not a library image.
    const rawImages = sourceFiles
      .filter((file) => file.path.startsWith('components/site/') || file.path.startsWith('app/(site)/'))
      .filter((file) => file.path !== 'components/site/SiteImage.tsx')
      .filter((file) => /<img\b/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()

    expect(rawImages).toEqual(['components/site/StaticMap.tsx'])
  })

  it('the public image model is composed in one module, over the central path builder', () => {
    const composers = sourceFiles
      .filter((file) => /\bbuildPublicImage\(/.test(codeOf(file.source)))
      .filter((file) => file.path !== 'lib/content/images.ts')
      .map((file) => file.path)
      .sort()

    expect(composers).toEqual(PUBLIC_IMAGE_COMPOSERS)

    // …and the model reaches the pages only through the read layer's projection.
    const projectors = sourceFiles
      .filter((file) => /\breadPublicImages\(/.test(codeOf(file.source)))
      .filter((file) => file.path !== 'lib/content/images.ts')
      .map((file) => file.path)
      .sort()

    // The Forside document's three photographs (phase 11A) join the two entity reads.
    expect(projectors).toEqual(['lib/content/menu.ts', 'lib/content/news.ts', 'lib/content/pages.ts'])
  })

  it('derivative paths are derived in the derivatives module only — no component builds one', () => {
    const builders = sourceFiles
      .filter((file) => /\bderivativePath\(/.test(codeOf(file.source)))
      .map((file) => file.path)
      .sort()

    // The pipeline names the paths it writes; the two view models name the paths
    // they render. No page, component or action is on the list.
    expect(builders).toEqual([
      'lib/images/derivatives.ts',
      'lib/images/finalize.ts',
      'lib/images/library.ts',
      'lib/images/public.ts',
    ])
  })

  it('no entity schema carries an alt text of its own — the library is the single owner (§22)', async () => {
    const { dishDraft } = await import('@/lib/schemas/menu')
    const { weeklySpecialDraft, monthlyBurgerDraft } = await import('@/lib/schemas/specials')
    const { newsArticleInput } = await import('@/lib/schemas/news')

    for (const fields of [
      dishDraft.fields,
      weeklySpecialDraft.fields,
      monthlyBurgerDraft.fields,
      Object.keys(newsArticleInput.shape),
    ]) {
      for (const field of fields) {
        expect(field).not.toMatch(/alt/i)
      }
    }
  })

  it('no image proxy, optimizer or request-time transformation exists', () => {
    const offenders = sourceFiles
      .filter((file) =>
        /from 'next\/image'|\/_next\/image|imgproxy|\/render\/image\/|getPublicUrl\(/.test(
          codeOf(file.source),
        ),
      )
      .map((file) => file.path)

    expect(offenders).toEqual([])

    const nextConfig = readFileSync(join(ROOT, 'next.config.ts'), 'utf8')
    expect(nextConfig).not.toMatch(/\bimages\s*:/)
  })
})
