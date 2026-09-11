import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  checkContent,
  contentFixture,
  loadedContent,
  removeContentFixtures,
  type ContentFiles,
} from '../../support/content-fixture'

/**
 * The site once the restaurant has published something — and the same site once it has
 * taken it down again.
 *
 * Four of the documents in `content/site/` are not launch copy but **today's operating
 * state**: an announcement, Ugens ret, Månedens burger and the articles under `news/`.
 * Each is switched on and off from Pages CMS, and each is a perfectly ordinary thing for
 * the restaurant to do on a Tuesday afternoon. The suites used to assert that all four
 * were empty, which meant the first real publication would have failed CI; the phase
 * 4E/4F rehearsal on live content is what showed it.
 *
 * The invariant those assertions were reaching for is a different one, and it is the one
 * proved here — **the site shows what the files say and nothing else**:
 *
 *   * with the flags on, every value on the page comes from the document, down to the
 *     expiry's Copenhagen instant and the øre a kroner string became;
 *   * with the flags off, and every one of those words still sitting on disk, the site
 *     shows nothing at all. No fallback week, no placeholder burger, no announcement
 *     conjured out of an unread message field, no draft article.
 *
 * Both fixtures also have to pass `check:content`, because a state the restaurant can
 * reach from the CMS that the gate then rejects is a broken deployment either way.
 *
 * The two trees are copies of the tracked content with these documents rewritten
 * (`tests/support/content-fixture.ts`); nothing here touches `content/site/`.
 */

afterAll(removeContentFixtures)

const ANNOUNCEMENT = {
  message: 'Vi holder lukket juleaften.',
  // A Copenhagen wall clock, as the editor writes it. December is CET, so midnight on
  // the 25th is 23:00Z the evening before — the conversion `loadAnnouncement` owns.
  expiresAt: '2026-12-25T00:00',
  // Written the way a Pages CMS form writes it: the controls of the other kind of link
  // are present and empty rather than absent.
  link: { type: 'page', page: '/find-os', url: '', label: '' },
}

const WEEK = {
  isoYear: 2026,
  isoWeek: 38,
  days: ['wed', 'thu', 'fri'],
  name: 'Stegt flæsk med persillesovs',
  description: 'Med hvide kartofler og rugbrød til.',
  priceSmall: '89',
  priceLarge: '109',
  soldOutOn: null,
  photo: { file: '/photos/dish-odin.png', alt: '', focus: 'center' },
  saturday: {
    enabled: true,
    name: 'Lørdagsmenu',
    description: null,
    price: '129',
    deadline: 'Bestil senest torsdag kl. 12',
    soldOutOn: null,
  },
}

const BURGER = {
  name: 'Septemberburgeren',
  description: 'Med syltede rødløg og chorizo.',
  price: '119',
  startsOn: '2026-09-01',
  endsOn: '2026-09-30',
  soldOutOn: null,
  showOnHomepage: true,
  photo: null,
}

/** Two articles, dated apart so the list's own order is visible. */
const ARTICLES = {
  'ny-burger-i-oktober': {
    title: 'Ny burger i oktober',
    publishedAt: '2026-10-01',
    body: ['Menu til 124 kr.'],
  },
  'aabent-i-efteraarsferien': {
    title: 'Åbent i efterårsferien',
    publishedAt: '2026-10-10',
    body: ['Vi har åbent hele ugen.'],
  },
}

/** A third article that is a draft in both trees: a draft never exists to the public. */
const DRAFT = {
  title: 'Kladde til december',
  publishedAt: '2026-12-01',
  body: ['Ikke færdig endnu.'],
}

/** The same four documents, written with every flag on or every flag off. */
const written = (live: boolean) => ({ write }: ContentFiles) => {
  write('content/site/announcement.json', { active: live, ...ANNOUNCEMENT })
  write('content/site/weekly-special.json', { active: live, ...WEEK })
  write('content/site/monthly-burger.json', { active: live, ...BURGER })

  for (const [slug, article] of Object.entries(ARTICLES)) {
    write(`content/site/news/${slug}.json`, { ...article, published: live })
  }
  write('content/site/news/kladde-til-december.json', { ...DRAFT, published: false })
}

const PUBLISHED = contentFixture(written(true))
const WITHDRAWN = contentFixture(written(false))

/** The part of the probe's JSON these suites read. */
type LoadedSite = {
  announcement: {
    message: string
    expiresAt: string
    link: { href: string; label: string; external: boolean } | null
  } | null
  menu: {
    weeklySpecial: {
      isoWeek: number | null
      name: string | null
      priceSmallOre: number | null
      image: { src: string } | null
      saturday: { enabled: boolean; name: string | null; priceOre: number | null }
    }
    monthlyBurger: { name: string; priceOre: number | null } | null
  }
  news: {
    slug: string
    title: string
    displayDate: string
    body: { blocks: { type: string; text: string }[] }
  }[]
}

/** What a fixture loads to — asked once per tree, because it is a separate process. */
const sites = new Map<string, LoadedSite>()

function siteOf(root: string): LoadedSite {
  const known = sites.get(root)
  if (known !== undefined) return known

  const site = JSON.parse(loadedContent(root)) as LoadedSite
  sites.set(root, site)
  return site
}

describe('an announcement, a week, a month and two articles the restaurant published', () => {
  it('is content check:content accepts', () => {
    expect(checkContent(PUBLISHED)).toEqual({ status: 0, stderr: '' })
  })

  it('shows the announcement, its link and its wall clock as a Copenhagen instant', () => {
    const { announcement } = siteOf(PUBLISHED)

    expect(announcement?.message).toBe(ANNOUNCEMENT.message)
    expect(announcement?.expiresAt).toBe('2026-12-24T23:00:00.000Z')
    expect(announcement?.link).toEqual({ href: '/find-os', label: 'Find os', external: false })
  })

  it('shows Ugens ret, its photograph and its Lørdagsmenu', () => {
    const { weeklySpecial } = siteOf(PUBLISHED).menu

    expect(weeklySpecial.name).toBe(WEEK.name)
    expect(weeklySpecial.isoWeek).toBe(38)
    expect(weeklySpecial.priceSmallOre).toBe(8900)
    expect(weeklySpecial.image?.src).toMatch(/^\/media\/dish-odin\/\d+\.webp$/)
    expect(weeklySpecial.saturday).toMatchObject({
      enabled: true,
      name: 'Lørdagsmenu',
      priceOre: 12900,
    })
  })

  it('shows Månedens burger', () => {
    expect(siteOf(PUBLISHED).menu.monthlyBurger).toMatchObject({
      name: BURGER.name,
      priceOre: 11900,
    })
  })

  it('lists both articles, newest first, and leaves the draft out', () => {
    const { news } = siteOf(PUBLISHED)

    expect(news.map((article) => article.slug)).toEqual([
      'aabent-i-efteraarsferien',
      'ny-burger-i-oktober',
    ])
    expect(news[0]?.title).toBe(ARTICLES['aabent-i-efteraarsferien'].title)
    expect(news[1]?.displayDate).toBe('2026-10-01')
    expect(news[1]?.body.blocks).toEqual([{ type: 'paragraph', text: 'Menu til 124 kr.' }])
  })
})

describe('the same four documents with every flag switched off', () => {
  it('is content check:content accepts', () => {
    expect(checkContent(WITHDRAWN)).toEqual({ status: 0, stderr: '' })
  })

  it('shows none of it, though every word of it is still on disk', () => {
    // The fixture is the published one with the flags flipped: the message, the dish
    // name and the burger are all still written down and simply not read.
    const onDisk = JSON.parse(
      readFileSync(join(WITHDRAWN, 'content', 'site', 'announcement.json'), 'utf8'),
    ) as { active: boolean; message: string }
    expect(onDisk).toMatchObject({ active: false, message: ANNOUNCEMENT.message })

    const site = siteOf(WITHDRAWN)
    expect(site.announcement).toBeNull()
    expect(site.menu.monthlyBurger).toBeNull()
    expect(site.menu.weeklySpecial.name).toBeNull()
    expect(site.menu.weeklySpecial.image).toBeNull()
    expect(site.menu.weeklySpecial.saturday.enabled).toBe(false)
    expect(site.news).toEqual([])
  })
})
