import { renderToStaticMarkup } from 'react-dom/server'

import { afterAll, describe, expect, it } from 'vitest'

import { FeaturedDishes } from '@/components/site/home/FeaturedDishes'
import type { DishView } from '@/lib/menu/view'

import {
  checkContent,
  contentFixture,
  loadedContent,
  removeContentFixtures,
} from '../../support/content-fixture'

/**
 * Prose the restaurant reworded — the case that blocked the first automatic
 * publication.
 *
 * Phase 5D published a real Pages CMS save end to end for the first time: a save on the
 * `content` branch rang the publisher, the publisher composed the change onto `main`,
 * `check:content` accepted it, and the publication PR was opened. It was then blocked by
 * CI, because the save had added one word to the Forside's menu-price note and a unit
 * test quoted that sentence. Nothing was wrong with the content. The words were the
 * restaurant's own, in a field Pages CMS gives them precisely so they can write it.
 *
 * Updating the quotation would have fixed that save and broken the next one, so the
 * quotations went instead (`./static-site.test.ts`), and this is what stands in their
 * place: **rewording an editable field is a change to those words and to nothing else.**
 *
 * It is proved on wording that appears nowhere in this repository, through the two entry
 * points CI actually runs — `npm run check:content` and the loaders, each in its own
 * process over a copy of the tracked tree (`tests/support/content-fixture.ts`) — and
 * then through the component that draws the line. If any of it ever started depending on
 * *which* words were written, one of these would fail on wording it has never seen.
 *
 * The Forside's note is the field the phase 5D publication actually changed, so it is
 * the one written out in full here. The same fixture rewords the other editable prose
 * beside it, because a suite that pinned one field would only have moved the problem.
 */

afterAll(removeContentFixtures)

/**
 * Words no document, test or design note in this repository contains — and a price the
 * restaurant has never charged, so the note still reads like the note it replaces.
 */
const REWORDED = {
  featuredNote: 'Enhver burger fås som menu med kartoffelbåde og et glas most fra 167 kr.',
  heroHeading: 'Kartoffelbåde, most og en bolle med låg',
  takeawayHeading: 'Vi pakker det hele ned til jer',
  ctaLabel: 'Slå på tråden',
  phoneNote: 'Aftalerne laver vi altid i telefonen, aldrig på skrift.',
  allergenNote: 'Sig endelig til, hvis noget skal udelades.',
}

/** The tracked tree with every one of those fields rewritten, and nothing else touched. */
const REWORDED_TREE = contentFixture(({ read, write }) => {
  const home = read('content/site/pages/home.json') as {
    hero: { heading?: string | null }
    featured?: { note?: string | null }
  }
  home.hero.heading = REWORDED.heroHeading
  home.featured = { ...home.featured, note: REWORDED.featuredNote }
  write('content/site/pages/home.json', home)

  const takeaway = read('content/site/pages/takeaway.json') as Record<string, unknown>
  takeaway.heading = REWORDED.takeawayHeading
  takeaway.ctaLabel = REWORDED.ctaLabel
  takeaway.phoneNote = REWORDED.phoneNote
  write('content/site/pages/takeaway.json', takeaway)

  const menu = read('content/site/menu.json') as Record<string, unknown>
  menu.allergenNote = REWORDED.allergenNote
  write('content/site/menu.json', menu)
})

type LoadedSite = {
  home: { hero: { heading: string | null }; featured: { note: string | null } }
  takeaway: { heading: string | null; ctaLabel: string; phoneNote: string | null }
  menu: { allergenNote: string | null }
}

const NO_BREAK_SPACE = String.fromCharCode(0xa0)

/**
 * What a tree loads to, asked once per tree. The probe is a separate process — it has
 * to be, because the loaders resolve their content from the working directory — so the
 * answers are kept rather than asked again for every assertion.
 */
const probed = new Map<string, string>()

function loadedOnce(root: string): string {
  const known = probed.get(root)
  if (known !== undefined) return known

  const json = loadedContent(root)
  probed.set(root, json)
  return json
}

const rewordedSite = () => JSON.parse(loadedOnce(REWORDED_TREE)) as LoadedSite

describe('an editable field the restaurant reworded', () => {
  it('is content check:content accepts', () => {
    expect(checkContent(REWORDED_TREE)).toEqual({ status: 0, stderr: '' })
  })

  it('reaches the pages as the words that were written, character for character', () => {
    const site = rewordedSite()

    expect(site.home.featured.note).toBe(REWORDED.featuredNote)
    expect(site.home.hero.heading).toBe(REWORDED.heroHeading)
    expect(site.takeaway.heading).toBe(REWORDED.takeawayHeading)
    expect(site.takeaway.ctaLabel).toBe(REWORDED.ctaLabel)
    expect(site.takeaway.phoneNote).toBe(REWORDED.phoneNote)
    expect(site.menu.allergenNote).toBe(REWORDED.allergenNote)
  })

  /**
   * The note states a price, and the loader leaves it alone. The one field rewritten on
   * the way out is the Burgere introduction, whose numbers are joined to "kr." with a
   * non-breaking space (`lib/content/load/text.ts`); the Forside's note is not that
   * field and keeps the ordinary space it was typed with. Asserted here rather than
   * against the tracked sentence, because it is a rule about the field and not about
   * today's wording.
   */
  it('keeps the ordinary space its price was typed with', () => {
    expect(rewordedSite().home.featured.note).not.toContain(NO_BREAK_SPACE)
  })

  /**
   * And nothing else moved. The strongest form of "a copy edit is a copy edit": the
   * whole site, as JSON, is the tracked site with exactly these six strings swapped for
   * the six they replaced — no menu re-ordered, no photograph re-resolved, no other
   * field defaulted into existence by a save that touched a neighbouring key.
   */
  it('changes those words and nothing else about the site', () => {
    const tracked = loadedOnce(process.cwd())
    const reworded = loadedOnce(REWORDED_TREE)

    expect(reworded).not.toBe(tracked)

    const site = JSON.parse(tracked) as LoadedSite
    const before: [string, string | null][] = [
      [REWORDED.featuredNote, site.home.featured.note],
      [REWORDED.heroHeading, site.home.hero.heading],
      [REWORDED.takeawayHeading, site.takeaway.heading],
      [REWORDED.ctaLabel, site.takeaway.ctaLabel],
      [REWORDED.phoneNote, site.takeaway.phoneNote],
      [REWORDED.allergenNote, site.menu.allergenNote],
    ]
    const restored = before.reduce(
      (json, [written, original]) =>
        json.split(JSON.stringify(written)).join(JSON.stringify(original)),
      reworded,
    )

    expect(restored).toBe(tracked)
  })
})

/**
 * The band beneath the three dishes prints the note it is handed — design 1g, 1l.
 *
 * The renderer is the other half of the path, and the half a content fixture cannot
 * see: a component that ignored its `note` and printed a sentence of its own would
 * satisfy every assertion above and still show the wrong line. So it is rendered, with a
 * note nothing has ever written, and with none at all.
 */
describe('the featured band', () => {
  const dish: DishView = {
    id: 'odin',
    name: 'Odin',
    description: null,
    secondaryNote: null,
    priceOre: 8900,
    labels: [],
    soldOutOn: null,
    featured: true,
    image: null,
    soldOut: false,
  }

  const band = (note: string | null) =>
    renderToStaticMarkup(<FeaturedDishes dishes={[dish]} note={note} />)

  it('prints the note it is given, not one of its own', () => {
    expect(band(REWORDED.featuredNote)).toContain(REWORDED.featuredNote)
  })

  /**
   * And draws no line at all without one. Counted as paragraphs rather than looked for
   * by class name: a class-pinned selector goes quietly true the next time the band is
   * restyled, and what the design says is that the band has one paragraph fewer.
   */
  it('draws no line at all when there is no note', () => {
    const withNote = band(REWORDED.featuredNote)
    const without = band(null)

    expect(without).toContain('Odin')
    expect(without).not.toContain(REWORDED.featuredNote)
    expect(without.split('<p').length).toBe(withNote.split('<p').length - 1)
  })
})
