import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * What a Pages CMS save does to the tracked content, and why it changes nothing —
 * phase 4B.
 *
 * `content/site/` is written two ways. Somebody editing the JSON writes `null` for a
 * field that is not filled in. Somebody editing the same field in Pages CMS is given a
 * form control, and an **empty control serialises as `""`**: a date picker with no
 * date, a cleared price, a number field with nothing in it, an image field with no
 * image selected. Opening a document in the editor and pressing save — without
 * changing a single thing — therefore rewrites a good part of the file from `null` to
 * `""`.
 *
 * That is not an edit, and the site must not treat it as one. The fixture below is
 * exactly that save: every `null` in every tracked document rewritten as an empty
 * control, and every unset photograph rewritten as the emptied object the CMS's image
 * component actually writes. Three things are then asserted, in the order that matters:
 *
 *   1. `npm run check:content` accepts it — the build is not broken by a save.
 *   2. Every loader produces **the same domain value, byte for byte in JSON**, as the
 *      tracked content does. That is the real claim: not that each field is handled,
 *      but that the whole site is the same site.
 *   3. A *required* field left empty still fails. `""` meaning "not filled in" is only
 *      safe if "not filled in" is still refused where the site needs a value.
 *
 * The comparison is made through `tests/support/load-content.mjs`, which prints what a
 * directory loads to, because the loaders resolve their content from the process
 * working directory and a copy can only be asked about by running against it.
 */

const ROOT = process.cwd()
const PROBE = join(ROOT, 'tests', 'support', 'load-content.mjs')
const CHECK = join(ROOT, 'scripts', 'check-content.mjs')

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** A copy of the real content in a temporary directory, with an edit applied to it. */
function fixture(edit: (files: Files) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'cms-empty-'))
  roots.push(root)

  mkdirSync(join(root, 'content'), { recursive: true })
  cpSync(join(ROOT, 'content', 'site'), join(root, 'content', 'site'), { recursive: true })
  mkdirSync(join(root, 'generated'), { recursive: true })
  cpSync(join(ROOT, 'generated', 'images.json'), join(root, 'generated', 'images.json'))

  edit({
    read: (path) => JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown,
    write: (path, value) => writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`),
  })

  return root
}

type Files = {
  read: (path: string) => unknown
  write: (path: string, value: unknown) => void
}

/** Every tracked document, so a whole-tree edit does not have to name them one by one. */
const DOCUMENTS = [
  'menu.json',
  'weekly-special.json',
  'monthly-burger.json',
  'hours.json',
  'contact.json',
  'award.json',
  'announcement.json',
  'pages/home.json',
  'pages/about.json',
  'pages/takeaway.json',
].map((name) => `content/site/${name}`)

/**
 * One document as an untouched Pages CMS save would write it.
 *
 * An unset photograph is the `foto` component's own emptied shape — the object stays,
 * with no file selected and the default crop — because that is what a form with three
 * controls in it produces. Everything else that was `null` becomes the empty string an
 * emptied control writes. Nothing else is changed: no value is added, removed or
 * reordered.
 */
function asSaved(value: unknown, key?: string): unknown {
  if (key === 'photo' && (value === null || value === undefined)) {
    return { file: '', alt: '', focus: 'center' }
  }
  if (value === null) return ''
  if (Array.isArray(value)) return value.map((entry) => asSaved(entry))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([name, entry]) => [
        name,
        asSaved(entry, name),
      ]),
    )
  }
  return value
}

/** Run `check:content` over a directory the way CI and a person both run it. */
function check(cwd: string): { status: number; stderr: string } {
  try {
    execFileSync(process.execPath, [CHECK], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stderr?: string }
    return { status: failure.status ?? -1, stderr: failure.stderr ?? '' }
  }
}

/** What a directory's content loads to, as the JSON the probe prints. */
function loaded(cwd: string): string {
  return execFileSync(process.execPath, [PROBE], { cwd, encoding: 'utf8' })
}

describe('an untouched Pages CMS save', () => {
  const saved = fixture(({ read, write }) => {
    for (const path of DOCUMENTS) write(path, asSaved(read(path)))
  })

  it('rewrites something — otherwise the rest of this suite proves nothing', () => {
    const before = readFileSync(join(ROOT, 'content', 'site', 'weekly-special.json'), 'utf8')
    const after = readFileSync(join(saved, 'content', 'site', 'weekly-special.json'), 'utf8')

    expect(after).not.toBe(before)
    expect(JSON.parse(after)).toMatchObject({ isoWeek: '', soldOutOn: '', priceSmall: '' })
  })

  it('passes check:content', () => {
    expect(check(saved)).toEqual({ status: 0, stderr: '' })
  })

  it('loads to exactly the site the tracked content loads to', () => {
    expect(loaded(saved)).toBe(loaded(ROOT))
  })
})

/**
 * Clearing an optional field is a real edit, and it has to mean "there is none".
 *
 * The two optional contact fields are the case worth pinning, because they are read by
 * something other than a `null` check: the footer draws an anchor when there is a
 * Facebook page, and the `Restaurant` JSON-LD writes `sameAs` when there is one. An
 * emptied text control that arrived as `""` would be a link to nowhere and a `sameAs`
 * naming the empty string.
 */
describe('an optional field the editor cleared', () => {
  it('is null in the domain, not an empty string', () => {
    const root = fixture(({ read, write }) => {
      const contact = read('content/site/contact.json') as Record<string, unknown>
      contact.facebookUrl = ''
      contact.secondaryPhone = ''
      write('content/site/contact.json', contact)
    })

    expect(check(root).status).toBe(0)
    expect(JSON.parse(loaded(root)).contact).toMatchObject({
      facebookUrl: null,
      secondaryPhone: null,
    })
  })
})

/**
 * The other half of the rule. An optional field may be empty in either spelling; a
 * required one may not be empty in either. Each case below is a field the site cannot
 * draw without — the number every "ring op" button dials, the words on the takeaway
 * page's one button, the day a published article is dated, the date a special opening
 * is about — and each is emptied the way a form empties it.
 */
describe('a required field left empty', () => {
  const refused = (edit: (files: Files) => void, where: RegExp) => {
    const result = check(fixture(edit))
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(where)
  }

  it('refuses a cleared telephone number', () => {
    refused(({ read, write }) => {
      const contact = read('content/site/contact.json') as Record<string, unknown>
      contact.primaryPhone = ''
      write('content/site/contact.json', contact)
    }, /contact\.json → primaryPhone\n\s+Skal udfyldes\./)
  })

  it('refuses a cleared button label', () => {
    refused(({ read, write }) => {
      const page = read('content/site/pages/takeaway.json') as Record<string, unknown>
      page.ctaLabel = ''
      write('content/site/pages/takeaway.json', page)
    }, /takeaway\.json → ctaLabel\n\s+Skal udfyldes\./)
  })

  it('refuses a cleared date on a special opening day', () => {
    refused(({ read, write }) => {
      const hours = read('content/site/hours.json') as Record<string, unknown>
      hours.overrides = [{ date: '', kind: 'closed', status: 'published' }]
      write('content/site/hours.json', hours)
    }, /hours\.json → overrides → særlig dag 1 → date\n\s+Skal udfyldes/)
  })

  it('refuses a cleared publication date on a published article', () => {
    refused(({ write }) => {
      write('content/site/news/foo.json', {
        title: 'Ny burger',
        published: true,
        publishedAt: '',
        body: ['Første afsnit.'],
      })
    }, /news\/foo\.json → publishedAt\n\s+Skal udfyldes/)
  })

  it('refuses an active week whose dish name was cleared', () => {
    refused(({ read, write }) => {
      const weekly = read('content/site/weekly-special.json') as Record<string, unknown>
      weekly.active = true
      weekly.name = ''
      write('content/site/weekly-special.json', weekly)
    }, /weekly-special\.json → name\n\s+Skal udfyldes\./)
  })

  it('still refuses a price that was typed wrong rather than left empty', () => {
    refused(({ read, write }) => {
      const menu = read('content/site/menu.json') as {
        categories: { dishes: { price?: unknown }[] }[]
      }
      menu.categories[0]!.dishes[0]!.price = '89 kr.'
      write('content/site/menu.json', menu)
    }, /Prisen skrives i kroner/)
  })

  it('still refuses a date that was typed wrong rather than left empty', () => {
    refused(({ read, write }) => {
      const burger = read('content/site/monthly-burger.json') as Record<string, unknown>
      burger.startsOn = '2026-02-31'
      write('content/site/monthly-burger.json', burger)
    }, /monthly-burger\.json → startsOn\n\s+Skal være en rigtig dato/)
  })

  it('still refuses a week number that is not a week', () => {
    refused(({ read, write }) => {
      const weekly = read('content/site/weekly-special.json') as Record<string, unknown>
      weekly.isoWeek = 54
      write('content/site/weekly-special.json', weekly)
    }, /weekly-special\.json → isoWeek\n\s+Skal være et helt tal mellem 1 og 53/)
  })
})
