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
 * phase 4B, corrected against a measured save.
 *
 * `content/site/` is written two ways. Somebody editing the JSON writes `null` for a
 * field that is not filled in. Somebody editing the same document in Pages CMS is
 * given a form, and the form is serialised back over the file. What that serialisation
 * does was originally guessed here — "an empty control becomes `""`" — and the guess
 * was wrong in the one way that mattered. Real saves have now been made and read back,
 * and this is what they do:
 *
 *   * **A blank optional string is left out**, not written as `""`.
 *   * **An empty list is left out.** This is the one that broke the build: the first
 *     ordinary menu save dropped `"dishes": []` from Ugens ret and from Tapasbordet —
 *     the two sections that are never allowed to hold dishes — and `check:content`
 *     refused the restaurant's own save. A missing list is an empty list
 *     (`lib/content/validate/menu.ts`, `lib/content/load/menu.ts`).
 *   * **A declared default may be materialised**: a section with no `kind` comes back
 *     `"kind": "dishes"`, a dish with no photograph comes back `"photo": {"focus":
 *     "center"}`, a dish nobody put on the Forside comes back `"featured": false`.
 *   * **`false` is preserved** — it is a value, not an empty control.
 *   * **The keys are written in the schema's order**, not the order the file had.
 *   * The output is pretty-printed JSON with no trailing newline.
 *
 * That is not an edit, and the site must not treat it as one. The fixture below is
 * that save applied to every tracked document. Three things are then asserted, in the
 * order that matters:
 *
 *   1. `npm run check:content` accepts it — the build is not broken by a save.
 *   2. Every loader produces **the same domain value, byte for byte in JSON**, as the
 *      tracked content does. That is the real claim: not that each field is handled,
 *      but that the whole site is the same site.
 *   3. A *required* field left empty still fails. "Not filled in" is only safe if it
 *      is still refused where the site needs a value.
 *
 * WHAT IS DELIBERATELY STILL TESTED IN THE OLD SPELLING. The suites further down empty
 * fields with `""`. That is not the CMS's spelling any more, and it is kept anyway:
 * `""` is what the *content contract* says a cleared field may be
 * (`lib/content/load/cleared.ts`), it is what earlier saves already wrote into files
 * that are still on disk, and it is what a person editing the JSON by hand may type.
 * Tolerating it is a rule of this site, not an artefact of one CMS's serialiser.
 *
 * The comparison is made through `tests/support/content-fixture.ts`, which copies the
 * tracked tree and prints what a directory loads to, because the loaders resolve their
 * content from the process working directory and a copy can only be asked about by
 * running against it.
 */

const ROOT = process.cwd()

afterAll(removeContentFixtures)

/** Every tracked document, so a whole-tree edit does not have to name them one by one. */
const MENU = 'content/site/menu.json'

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

/** The marker for a key the save does not write at all. */
const OMITTED = Symbol('omitted')

/**
 * One document as an untouched Pages CMS save writes it — the four rules above, over
 * whatever the document happens to contain.
 *
 * An unset photograph is the `foto` component's own shape with only its declared
 * default in it: the object is written because the form has one, and the two controls
 * inside it that are empty are left out like every other empty control. The keys come
 * back in the schema's order rather than the file's, which is modelled here as *some*
 * other order — the loaders must not depend on either.
 *
 * The materialised defaults are the menu schema's, because the menu is the document
 * the measured save was made from; a default is written where the schema declares one,
 * so this is applied where it was observed rather than everywhere.
 */
function asSaved(value: unknown, key?: string): unknown {
  if (key === 'photo' && (value === null || value === undefined || value === '')) {
    return { focus: 'center' }
  }
  if (value === null || value === undefined || value === '') return OMITTED
  if (Array.isArray(value)) {
    return value.length === 0 ? OMITTED : value.map((entry) => asSaved(entry))
  }
  if (typeof value === 'object') {
    const written = Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([name, entry]) => [name, asSaved(entry, name)] as const)
      .filter(([, entry]) => entry !== OMITTED)
    return Object.fromEntries(written)
  }
  return value
}

/** A menu category with the defaults the menu schema declares written out. */
function withMenuDefaults(document: unknown): unknown {
  const menu = document as { categories?: Record<string, unknown>[] }
  if (!Array.isArray(menu.categories)) return document

  return {
    ...menu,
    categories: menu.categories.map((category) => ({
      kind: 'dishes',
      ...category,
      dishes: ((category.dishes ?? []) as Record<string, unknown>[]).map((dish) => ({
        featured: false,
        photo: { focus: 'center' },
        ...dish,
      })),
    })),
  }
}

describe('an untouched Pages CMS save', () => {
  const saved = fixture(({ read, write }) => {
    write(MENU, asSaved(withMenuDefaults(read(MENU))))
    for (const path of DOCUMENTS.filter((path) => path !== MENU)) write(path, asSaved(read(path)))
  })

  /**
   * The guard against a vacuous suite. It used to name three fields of
   * `weekly-special.json` and expect each of them empty, which was really an assertion
   * that no week had been published; the fields a document happens to be leaving unset
   * this week are the restaurant's business. What this suite needs is only that the save
   * *did* rewrite the tree — stated as the rules `asSaved` follows, over whichever
   * documents currently hold a value one of them applies to.
   */
  it('rewrites something — otherwise the rest of this suite proves nothing', () => {
    const holdsBlank = (path: string) => /:\s*(null|""|\[\])/.test(readFileSync(path, 'utf8'))
    const emptied = DOCUMENTS.filter((path) => holdsBlank(join(ROOT, path)))

    expect(emptied.length).toBeGreaterThan(0)
    for (const path of emptied) {
      expect(holdsBlank(join(saved, path)), path).toBe(false)
      expect(readFileSync(join(saved, path), 'utf8'), path).not.toBe(
        readFileSync(join(ROOT, path), 'utf8'),
      )
    }
  })

  /**
   * And specifically the rule that broke the build. The two menu sections that draw
   * another document are the ones that carry `"dishes": []`, so they are the ones a
   * save leaves without a `dishes` key at all — named here rather than left implied,
   * because "the save rewrote something" would still pass if this stopped happening.
   */
  it('leaves out the dishes list of every section that had an empty one', () => {
    const sections = (root: string) =>
      (JSON.parse(readFileSync(join(root, MENU), 'utf8')) as { categories: object[] }).categories

    const wereEmpty = sections(ROOT).filter(
      (section) => (section as { dishes?: unknown[] }).dishes?.length === 0,
    )
    expect(wereEmpty.length).toBeGreaterThan(0)

    const written = sections(saved).filter((section) => 'dishes' in section)
    expect(written).toHaveLength(sections(ROOT).length - wereEmpty.length)
  })

  it('passes check:content', () => {
    expect(check(saved)).toEqual({ status: 0, stderr: '' })
  })

  it('loads to exactly the site the tracked content loads to', () => {
    expect(loaded(saved)).toBe(loaded(ROOT))
  })
})

/**
 * The save that actually broke the build, on its own — the real menu from
 * `origin/content` (7c00ae4, "Update content/site/menu.json (via Pages CMS)"), where
 * `dishes` is missing from Ugens ret and from Tapasbordet and present everywhere else.
 *
 * The suite above models the whole serialisation and applies it to every document;
 * this is the one file, edited by hand into exactly the shape the restaurant's own
 * save left on disk, so the case survives any later change to that model. It is built
 * from the tracked menu rather than checked in as a copy of it, because a second copy
 * of the menu in this repository would be a second menu to keep up to date — and the
 * only thing 7c00ae4 does that matters here is drop those two lists. (The real file
 * also reorders keys, drops blank strings and writes the schema's defaults; that this
 * changes nothing is what the suite above proves.)
 */
describe('the Pages CMS menu save that left two sections without a dishes list', () => {
  const emptied: unknown[] = []

  const withoutEmptyDishes = fixture(({ read, write }) => {
    const menu = read(MENU) as { categories: Record<string, unknown>[] }

    for (const section of menu.categories) {
      if ((section.dishes as unknown[] | undefined)?.length !== 0) continue
      delete section.dishes
      emptied.push(section.id)
    }

    write(MENU, menu)
  })

  it('is a save that dropped a list — otherwise the two cases below prove nothing', () => {
    expect(emptied.length).toBeGreaterThan(0)
  })

  it('passes check:content', () => {
    expect(check(withoutEmptyDishes)).toEqual({ status: 0, stderr: '' })
  })

  it('loads to exactly the menu the tracked content loads to', () => {
    expect(loaded(withoutEmptyDishes)).toBe(loaded(ROOT))
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
