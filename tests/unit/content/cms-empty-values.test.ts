import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  checkContent as check,
  contentFixture as fixture,
  loadedContent as loaded,
  removeContentFixtures,
  type ContentFiles as Files,
} from '../../support/content-fixture'

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
 * The comparison is made through `tests/support/content-fixture.ts`, which copies the
 * tracked tree and prints what a directory loads to, because the loaders resolve their
 * content from the process working directory and a copy can only be asked about by
 * running against it.
 */

const ROOT = process.cwd()

afterAll(removeContentFixtures)

/** Every tracked document, so a whole-tree edit does not have to name them one by one. */
const DOCUMENTS = [
  'menu.json',
  'tapas.json',
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

describe('an untouched Pages CMS save', () => {
  const saved = fixture(({ read, write }) => {
    for (const path of DOCUMENTS) write(path, asSaved(read(path)))
  })

  /**
   * The guard against a vacuous suite. It used to name three fields of
   * `weekly-special.json` and expect each of them empty, which was really an assertion
   * that no week had been published; the fields a document happens to be leaving unset
   * this week are the restaurant's business. What this suite needs is only that the save
   * *did* rewrite the tree — stated as the rule `asSaved` follows, over whichever
   * documents currently hold a `null`.
   */
  it('rewrites something — otherwise the rest of this suite proves nothing', () => {
    const holdsNull = (path: string) => /:\s*null/.test(readFileSync(path, 'utf8'))
    const emptied = DOCUMENTS.filter((path) => holdsNull(join(ROOT, path)))

    expect(emptied.length).toBeGreaterThan(0)
    for (const path of emptied) {
      expect(holdsNull(join(saved, path)), path).toBe(false)
      expect(readFileSync(join(saved, path), 'utf8'), path).not.toBe(
        readFileSync(join(ROOT, path), 'utf8'),
      )
    }
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
