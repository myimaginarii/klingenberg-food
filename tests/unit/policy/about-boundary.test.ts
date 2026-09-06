import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The Om os administration's boundary — technical plan §5, §6, §8, §10a; phase 14B1.
 *
 * Six properties the plan states in prose, held over the real source tree in the
 * family of `images-boundary.test.ts`:
 *
 *   1. **One Om os editor.** Exactly one route folder writes `page:about`, and the
 *      phase-4 content screen that used to carry it is gone.
 *   2. **No raw JSON editor.** The editor's forms carry the document's fields by name;
 *      no form field, textarea or action accepts a JSON document.
 *   3. **No second image picker.** The about components import the shared picker pair
 *      and draw no `<dialog>`, `<picture>` or storage URL of their own; no about
 *      component is a client component.
 *   4. **No browser Supabase.** No file under the about route or its components imports
 *      a Supabase client, and the public Om os components import no server module.
 *   5. **The strict schema.** `aboutDraft` carries no non-strict nested object.
 *   6. **The confirmed-content loader stays clear of Om os.** The confirmed seed writes
 *      no page document and carries none of the about placeholder prose; the
 *      development layer is where the placeholder document lives.
 */

const ROOT = process.cwd()

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.tsx?$/.test(full)) yield full
  }
}

type SourceFile = { path: string; source: string }

function read(absolute: string): SourceFile {
  return { path: relative(ROOT, absolute).split(sep).join('/'), source: readFileSync(absolute, 'utf8') }
}

/** Strip comments, so a boundary documented in prose does not trip its own test. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const sourceFiles: SourceFile[] = ['app', 'components', 'lib'].flatMap((directory) =>
  [...walk(join(ROOT, directory))].map(read),
)

const ABOUT_ROUTE = 'app/(admin)/admin/om-os/'
const ABOUT_COMPONENTS = 'components/admin/about/'
const PUBLIC_ABOUT = 'components/site/about/'

describe('one Om os editor', () => {
  it('exactly one route folder writes the page:about entity, and the phase-4 content screen is gone', () => {
    // The Server Actions that name the entity; the dashboard tile names it only to ask
    // the registry who may open the editor.
    const writers = sourceFiles.filter(
      (file) =>
        file.path.startsWith('app/') &&
        /^\s*'use server'/m.test(file.source) &&
        /entity:\s*'page:about'/.test(codeOf(file.source)),
    )
    const folders = new Set(writers.map((file) => file.path.split('/').slice(0, 4).join('/')))
    expect([...folders]).toEqual(['app/(admin)/admin/om-os'])

    expect(existsSync(join(ROOT, 'app/(admin)/admin/indhold'))).toBe(false)
    for (const file of sourceFiles) {
      expect(codeOf(file.source), file.path).not.toContain('/admin/indhold')
    }
  })

  it('the dashboard tile and the preview target both point at the one editor', () => {
    const tiles = read(join(ROOT, 'app/(admin)/admin/dashboard-tiles.ts')).source
    expect(tiles).toContain("import { ABOUT_ADMIN_PATH } from './om-os/routes'")
    expect(tiles.match(/entity: 'page:about'/g)).toHaveLength(1)

    const targets = read(join(ROOT, 'lib/drafts/targets.ts')).source
    expect(targets).toContain("'om-os': { path: '/om-os'")
  })
})

describe('no raw JSON editor', () => {
  it('the forms name the document\'s fields, not a document', () => {
    const forms = read(join(ROOT, `${ABOUT_ROUTE}forms.ts`)).source
    const code = codeOf(forms)
    expect(code).not.toMatch(/JSON\.parse/)
    // Every form field name is one of the document's own words; none is a document.
    const names = [...code.matchAll(/^\s+\w+: '([a-z_]+)',?$/gm)].map((match) => match[1])
    expect(names.length).toBeGreaterThan(5)
    for (const name of names) expect(name, name).not.toMatch(/json|dokument|document|raw/)
  })

  it('no about action parses JSON from a form', () => {
    for (const file of sourceFiles.filter((file) => file.path.startsWith(ABOUT_ROUTE))) {
      expect(codeOf(file.source), file.path).not.toMatch(/JSON\.parse/)
    }
  })
})

describe('no second image picker, no client component, no storage URL', () => {
  it('the about screen draws the shared picker pair and nothing of its own', () => {
    const page = read(join(ROOT, `${ABOUT_ROUTE}page.tsx`)).source
    expect(page).toContain("from '@/components/admin/images/ImagePickerDialog'")
    expect(page).toContain("from '@/components/admin/images/ImagePickerField'")

    for (const file of sourceFiles.filter(
      (file) => file.path.startsWith(ABOUT_COMPONENTS) || file.path.startsWith(ABOUT_ROUTE),
    )) {
      const code = codeOf(file.source)
      expect(code, file.path).not.toMatch(/<dialog/)
      expect(code, file.path).not.toMatch(/<picture/)
      expect(code, file.path).not.toMatch(/<img\b/)
      expect(code, file.path).not.toMatch(/\/storage\/v1\//)
      expect(code, file.path).not.toMatch(/media-originals/)
      expect(code, file.path).not.toMatch(/^\s*['"]use client['"]/m)
    }
  })

  it('the public Om os markup renders its images through the one public renderer only', () => {
    for (const file of sourceFiles.filter((file) => file.path.startsWith(PUBLIC_ABOUT))) {
      const code = codeOf(file.source)
      expect(code, file.path).toContain("from '@/components/site/SiteImage'")
      expect(code, file.path).not.toMatch(/<picture|<img\b|\/storage\/v1\//)
      expect(code, file.path).not.toMatch(/^\s*['"]use client['"]/m)
      expect(code, file.path).not.toMatch(/@\/lib\/supabase|@\/lib\/content\/(pages|about-admin|images-admin)/)
    }
  })
})

describe('no browser Supabase', () => {
  it('nothing under the about route or its components constructs a Supabase client', () => {
    for (const file of sourceFiles.filter(
      (file) =>
        file.path.startsWith(ABOUT_ROUTE) ||
        file.path.startsWith(ABOUT_COMPONENTS) ||
        file.path.startsWith(PUBLIC_ABOUT) ||
        file.path === 'lib/pages/about.ts',
    )) {
      const code = codeOf(file.source)
      expect(code, file.path).not.toMatch(/@supabase\/supabase-js|createClient\(|createBrowserClient/)
    }
  })

  it('the admin read is server-only and goes through the request-scoped client', () => {
    const adminRead = read(join(ROOT, 'lib/content/about-admin.ts')).source
    expect(adminRead).toContain("import 'server-only'")
    expect(adminRead).toContain("from '@/lib/supabase/server'")
    expect(codeOf(adminRead)).not.toMatch(/service/i)
  })
})

describe('the strict schema', () => {
  it('aboutDraft carries no non-strict nested object', () => {
    const schema = read(join(ROOT, 'lib/schemas/page-documents.ts')).source
    const start = schema.indexOf('export const aboutDraft = defineDraft({')
    expect(start).toBeGreaterThan(0)
    const body = schema.slice(start)
    expect(body).not.toMatch(/z\.object\(/)
    expect(body.match(/z\s*\.strictObject\(/g)).toHaveLength(2)
    expect(body).toContain('venue_image_id')
    expect(body).not.toContain('award_image_id')
  })
})

describe('the confirmed-content loader stays clear of Om os', () => {
  const confirmed = readFileSync(join(ROOT, 'supabase/seed/confirmed.sql'), 'utf8')
  const development = readFileSync(join(ROOT, 'supabase/seed/development.sql'), 'utf8')

  it('the confirmed file writes no page document and carries none of the about prose', () => {
    expect(confirmed).not.toMatch(/public\.pages/)
    for (const phrase of ['Vores historie', 'story_blocks', 'venue_image_id', 'Sådan laver vi burgere', 'holdet']) {
      expect(confirmed.toLowerCase(), phrase).not.toContain(phrase.toLowerCase())
    }
  })

  it('the development layer holds the about document with the three empty image keys', () => {
    expect(development).toMatch(/where key = 'about'/)
    expect(development).toContain("'venue_image_id', null")
    expect(development.match(/'image_id', null/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})
