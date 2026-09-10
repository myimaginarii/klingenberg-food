import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolvePhoto } from '@/lib/content/load/photo'
import { readImageManifest } from '@/lib/images/manifest'
import { loadAnnouncement } from '@/lib/content/load/announcement'
import { loadAward } from '@/lib/content/load/award'
import { loadContact } from '@/lib/content/load/contact'
import { loadOpeningHours } from '@/lib/content/load/hours'
import { loadMenu } from '@/lib/content/load/menu'
import { loadNews } from '@/lib/content/load/news'
import { loadAboutPage, loadHomePage, loadTakeawayPage } from '@/lib/content/load/pages'
import { planDerivatives } from '@/lib/images/derivatives'
import { buildStaticPublicImage } from '@/lib/images/public'
import { buildMenuView, selectFeaturedDishes } from '@/lib/menu/view'

import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * The tracked public content — the static site's source of truth, held to the
 * confirmed facts (design 1ab; `content/launch/launch-copy.md`) — as the loaders in
 * `lib/content/load/` hand it to the pages.
 *
 * These are the numbers and the absences the conversion promised: nine sections,
 * forty-six dishes, no "Salat efter sæson", nothing invented for the week, the month,
 * the news or the announcement — and a photograph model whose every URL names a rung
 * the build actually renders.
 */

const NO_BREAK_SPACE = String.fromCharCode(0xa0)

const MENU = loadMenu()
const MENU_CATEGORIES = MENU.categories
const EVERY_DISH = MENU_CATEGORIES.flatMap((category) => category.dishes)
const HOME = loadHomePage()
const ABOUT = loadAboutPage()
const TAKEAWAY = loadTakeawayPage()

/** One dish by id — the menu names four of them in the photograph assertions below. */
const dish = (id: string) => EVERY_DISH.find((entry) => entry.id === id)

describe('the confirmed menu', () => {
  it('has exactly the nine sections, in the approved order', () => {
    expect(MENU_CATEGORIES.map((category) => category.slug)).toEqual([
      'burgere',
      'ugens-ret',
      'andre-retter',
      'pommes-og-snacks',
      'boern',
      'drikkevarer',
      'dessert',
      'tapas',
      'varm-selv',
    ])
  })

  it('has exactly forty-six dishes, every one priced in whole øre', () => {
    expect(EVERY_DISH).toHaveLength(46)
    for (const dish of EVERY_DISH) {
      expect(Number.isInteger(dish.priceOre) && (dish.priceOre ?? 0) > 0, dish.name).toBe(true)
    }
  })

  it('states the burger menu price once, under Burgere, and on no card', () => {
    const burgers = MENU_CATEGORIES.find((category) => category.slug === 'burgere')
    // The editor writes ordinary spaces; for this one field the loader joins each number
    // to "kr." with a non-breaking space so the price never wraps. This is the rendered
    // result — and the only prose on the site that gets it.
    expect(burgers?.intro).toBe(
      `Alle burgere serveres i briochebolle. Som menu med pommes frites og sodavand: 124${NO_BREAK_SPACE}kr., Ragnar 132${NO_BREAK_SPACE}kr.`,
    )
    // The confirmed prices, and no per-card note repeating the menu price.
    expect(burgers?.dishes.map((dish) => [dish.name, dish.priceOre, dish.secondaryNote])).toEqual([
      ['Odin', 8900, null],
      ['Frigg', 8900, null],
      ['Ragnar', 9700, null],
      ['Thor', 8900, null],
      ['Glade Gris', 8900, null],
    ])
    // Once across the whole menu: no section text and no dish text repeats it.
    const mentions = MENU_CATEGORIES.flatMap((category) => [
      category.intro,
      category.note,
      ...category.dishes.flatMap((dish) => [dish.description, dish.secondaryNote]),
    ]).filter((text) => text !== null && /som menu/i.test(text))
    expect(mentions).toHaveLength(1)
  })

  it('gives every dish and every section a unique id', () => {
    expect(new Set(EVERY_DISH.map((dish) => dish.id)).size).toBe(EVERY_DISH.length)
    expect(new Set(MENU_CATEGORIES.map((category) => category.id)).size).toBe(MENU_CATEGORIES.length)
  })

  it('does not carry "Salat efter sæson"', () => {
    expect(EVERY_DISH.some((dish) => /salat efter s/i.test(dish.name))).toBe(false)
  })

  it('carries the tapas board as the one structured document', () => {
    const tapas = EVERY_DISH.filter((dish) => dish.tapas !== null)
    expect(tapas.map((dish) => dish.name)).toEqual(['Tapas'])

    const document = tapas[0]!.tapas!
    expect(document.kind).toBe('tapas')
    expect(document.groups.map((group) => [group.id, group.mode, group.choose])).toEqual([
      ['base', 'fixed', null],
      ['choose7', 'choose', 7],
      ['dressing', 'choose', 3],
    ])
    for (const group of document.groups) {
      expect(group.heading.length).toBeGreaterThan(0)
      expect(group.items.length).toBeGreaterThan(0)
    }
  })

  it('marks nothing sold out and names only the confirmed Ugens ret note', () => {
    expect(EVERY_DISH.every((dish) => dish.soldOutOn === null)).toBe(true)
    expect(MENU_CATEGORIES.find((category) => category.kind === 'weekly_special')?.slug).toBe('ugens-ret')
  })

  it('prints the allergen line under the menu title', () => {
    expect(MENU.allergenNote).toBe('Spørg os gerne om allergener.')
  })

  it('has no week, no month and no announcement — nothing invented', () => {
    expect(MENU.weeklySpecial.name).toBeNull()
    expect(MENU.weeklySpecial.saturday.enabled).toBe(false)
    expect(MENU.monthlyBurger).toBeNull()
    expect(loadAnnouncement()).toBeNull()
    expect(loadNews()).toEqual([])
  })

  it('resolves the three featured dishes the Forside names', () => {
    const view = buildMenuView(MENU, loadOpeningHours(), new Date('2026-09-09T16:00:00+02:00'))
    expect(selectFeaturedDishes(view.categories, HOME.featured.dishIds).map((dish) => dish.name)).toEqual([
      'Odin',
      'Frigg',
      'Ragnar',
    ])
    expect(view.monthlyBurger).toBeNull()
  })

  it('hands every caller the same value, so the shell and a page share one object', () => {
    expect(loadMenu()).toBe(MENU)
    expect(loadOpeningHours()).toBe(loadOpeningHours())
    expect(loadContact()).toBe(loadContact())
  })
})

describe('the confirmed facts', () => {
  it('states the address, the two numbers, the e-mail address and the Facebook page', () => {
    expect(loadContact()).toEqual({
      venueName: 'Carl Nielsen Hallen',
      addressLine1: 'Lumbyvej 62',
      postalCode: '5792',
      city: 'Nørre Lyndelse',
      primaryPhone: '+45 63 90 83 00',
      secondaryPhone: '+45 51 79 45 66',
      email: 'soebylarsen@gmail.com',
      facebookUrl: 'https://www.facebook.com/carlnielsencafeen',
      mapAttribution: null,
    })
  })

  it('is the confirmed schedule the engine suites are written against, with no overrides', () => {
    expect(loadOpeningHours().schedule).toEqual(CONFIRMED_SCHEDULE)
    expect(loadOpeningHours().overrides).toEqual([])
  })

  it('carries the launch copy headings verbatim', () => {
    expect(HOME.hero.heading).toBe('Burgeren der vandt Fyn')
    expect(ABOUT.heading).toBe('Mad fra Carl Nielsen Hallen')
    expect(ABOUT.storyBlocks).toHaveLength(4)
    expect(TAKEAWAY.heading).toBe('Mad ud af huset')
    expect(TAKEAWAY.sections.map((section) => section.heading)).toEqual([
      'Til selskaber og sammenkomster',
    ])
  })

  it('states one award, in the same words on the Forside and on Om os', () => {
    const award = loadAward()
    expect(award.title).toBe('Fyns bedste burger 2026 og nr. 4 i Danmark')
    expect(award.text).toContain('Danmarks Bedste Burger 2026')
    expect(HOME.award.title).toBe(award.title)
    expect(HOME.award.text).toBe(award.text)
  })

  it('carries the takeaway button label, the phone line and the featured menu-price line', () => {
    expect(TAKEAWAY.ctaLabel).toBe('Ring og hør mere')
    expect(TAKEAWAY.phoneNote).toBe('Bestilling og aftaler klarer vi over telefonen.')
    // An ordinary space before "kr.": only the Burgere intro carries the non-breaking one.
    expect(HOME.featured.note).toBe(
      'Alle burgere kan bestilles som menu med pommes frites og sodavand fra 124 kr.',
    )
  })

  it('invents no catering term', () => {
    const text = [TAKEAWAY.intro, ...TAKEAWAY.sections.map((section) => section.body)]
      .join(' ')
      .toLowerCase()
    for (const invented of ['minimum', 'kuverter', 'levering', 'depositum', 'senest 48']) {
      expect(text, invented).not.toContain(invented)
    }
  })
})

describe('the content files', () => {
  function* jsonFiles(directory: string): Generator<string> {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry)
      if (statSync(full).isDirectory()) yield* jsonFiles(full)
      else if (entry.endsWith('.json')) yield full
    }
  }

  it('are written with ordinary spaces — no editor has to type a non-breaking space', () => {
    const files = [...jsonFiles(join(process.cwd(), 'content', 'site'))]
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(NO_BREAK_SPACE)
    }
  })
})

describe('the photographs', () => {
  /** The image a content field would produce for this file — the loader, not a copy of it. */
  function photo(file: string, alt = '', focus = 'center') {
    return resolvePhoto({ file, alt, focus }, 'tests/unit/content/static-site.test.ts')
  }

  it('are the files the content selects, and no frame invents one', () => {
    expect(HOME.hero.image).toEqual(photo('/photos/home-hero.png', 'Burger med bacon og spejlæg'))
    expect(HOME.aboutExcerpt.image).toEqual(
      photo('/photos/about-venue.png', 'Spisesalen hos Klingenberg Food'),
    )
    expect(ABOUT.venueImage).toEqual(
      photo('/photos/about-venue.png', 'Spisesalen hos Klingenberg Food'),
    )
    expect(TAKEAWAY.image).toEqual(photo('/photos/takeaway.png', 'Tre sandwiches'))
    expect(dish('odin')?.image).toEqual(photo('/photos/dish-odin.png'))
    expect(dish('ragnar')?.image).toEqual(photo('/photos/dish-ragnar.png'))
    expect(dish('glade-gris')?.image).toEqual(photo('/photos/dish-glade-gris.png'))

    // Frigg's photograph is a portrait whose subject stands high on the plate, so the
    // menu's square frame keeps its top rather than its centre (see ImageFocus). The
    // Forside's featured card anchors its own 3:2 frame; the selected crop is the
    // dish's, once, and each frame is free to hold it where its shape needs.
    expect(dish('frigg')?.image).toEqual(photo('/photos/dish-frigg.png', '', 'upper'))
    expect(dish('frigg')?.image?.focus).toBe('upper')

    // Thor has no supplied photograph and renders the menu's reserved "Retfoto" frame;
    // the other empty frames are text-only by design. Nothing is faked to fill them.
    expect(dish('thor')?.image).toBeNull()
    expect(HOME.award.image).toBeNull()
    expect(ABOUT.team.image).toBeNull()
    expect(ABOUT.method.image).toBeNull()
    expect(MENU.weeklySpecial.image).toBeNull()
    expect(EVERY_DISH.filter((entry) => entry.image !== null)).toHaveLength(4)
  })

  it('hear their tracked description, or nothing at all — never an invented one', () => {
    // The dish photographs sit beside the heading that already names the dish, so an
    // empty description is the correct answer and renders alt="".
    for (const id of ['odin', 'frigg', 'ragnar', 'glade-gris']) {
      expect(dish(id)?.image?.alt, id).toBe('')
    }
    expect(HOME.hero.image?.alt).toBe('Burger med bacon og spejlæg')
    expect(ABOUT.venueImage?.alt).toBe('Spisesalen hos Klingenberg Food')
    expect(TAKEAWAY.image?.alt).toBe('Tre sandwiches')
  })

  it('name only rungs the ladder plans for the measured size, under /media/', () => {
    const manifest = readImageManifest().photos
    expect(Object.keys(manifest).length).toBeGreaterThan(0)

    for (const [slot, measured] of Object.entries(manifest)) {
      const image = photo(`/photos/${measured.file}`)!
      const planned = planDerivatives(measured.width, measured.height)

      expect(image.candidates.map((candidate) => [candidate.width, candidate.height])).toEqual(
        planned.map((size) => [size.width, size.height]),
      )
      for (const candidate of image.candidates) {
        expect(candidate.avifUrl).toBe(`/media/${slot}/${candidate.width}.avif`)
        expect(candidate.webpUrl).toBe(`/media/${slot}/${candidate.width}.webp`)
      }
      expect(image.width).toBe(planned[planned.length - 1]!.width)
      expect(image.src).toMatch(/\.webp$/)
    }
  })

  /**
   * The promise the whole pipeline exists to keep: a page never names a file the build
   * did not write. Every URL the site would print is checked against the directory the
   * prebuild step rendered — which is also what proves the reconciliation is honest,
   * because a stale folder cannot satisfy a URL nothing emits.
   */
  it('emit only URLs that exist as rendered derivatives', () => {
    const rendered = [
      HOME.hero.image,
      HOME.award.image,
      HOME.aboutExcerpt.image,
      ABOUT.venueImage,
      ABOUT.team.image,
      ABOUT.method.image,
      TAKEAWAY.image,
      MENU.weeklySpecial.image,
      MENU.monthlyBurger?.image ?? null,
      ...EVERY_DISH.map((entry) => entry.image),
    ].filter((image) => image !== null)

    const urls = new Set<string>()
    for (const image of rendered) {
      urls.add(image.src)
      for (const candidate of image.candidates) {
        urls.add(candidate.avifUrl)
        urls.add(candidate.webpUrl)
      }
    }

    expect(urls.size).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url.startsWith('/media/'), url).toBe(true)
      expect(existsSync(join(process.cwd(), 'public', ...url.split('/'))), url).toBe(true)
    }
  })

  it('never upscales and never falls back to the source file', () => {
    const image = buildStaticPublicImage({ slot: 'small', alt: null, width: 300, height: 200 })
    expect(image.candidates).toEqual([
      { width: 300, height: 200, avifUrl: '/media/small/300.avif', webpUrl: '/media/small/300.webp' },
    ])
    expect(image.src).toBe('/media/small/300.webp')
    expect(image.avifSrcSet).toBe('/media/small/300.avif 300w')

    const everything = JSON.stringify([HOME.hero.image, dish('odin')?.image])
    expect(everything).not.toContain('/photos/')
    expect(everything).not.toContain('.png')
  })
})
