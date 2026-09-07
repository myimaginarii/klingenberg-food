import { describe, expect, it } from 'vitest'

import { launchPhoto } from '@/content/site/images'
import { ABOUT_PAGE, HOME_PAGE, TAKEAWAY_PAGE } from '@/content/site/pages'
import photos from '@/content/site/photos.json'
import { loadAnnouncement } from '@/lib/content/load/announcement'
import { loadContact } from '@/lib/content/load/contact'
import { loadOpeningHours } from '@/lib/content/load/hours'
import {
  loadMenu,
  loadMenuCategories,
  loadMonthlyBurger,
  loadWeeklySpecial,
} from '@/lib/content/load/menu'
import { loadNews } from '@/lib/content/load/news'
import { planDerivatives } from '@/lib/images/derivatives'
import { buildStaticPublicImage } from '@/lib/images/public'
import { buildMenuView, selectFeaturedDishes } from '@/lib/menu/view'

import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * The tracked public content — the JSON under `content/site/`, read through the
 * loaders the site itself reads through, and held to the confirmed facts (design 1ab;
 * `content/launch/launch-copy.md`).
 *
 * These are the numbers and the absences the conversion promised: nine sections,
 * forty-six dishes at the confirmed prices and in the confirmed order, no "Salat efter
 * sæson", nothing invented for the week, the month, the news or the announcement — and
 * a photograph model whose every URL names a rung the build actually renders.
 *
 * The suite deliberately asserts the *loaded* values rather than the files. A price is
 * stored in kroner and used in øre, and what matters is what the page is handed.
 */

const MENU_CATEGORIES = loadMenuCategories()
const MENU = loadMenu()
const SITE_CONTACT = loadContact()
const OPENING_HOURS = loadOpeningHours()
const NEWS_ARTICLES = loadNews()
const SITE_ANNOUNCEMENT = loadAnnouncement()

const EVERY_DISH = MENU_CATEGORIES.flatMap((category) => category.dishes)

/**
 * The confirmed menu, in full: every section in its approved order, every dish in its
 * approved order inside it, by stable id and price in øre.
 *
 * One table, because the three things it pins are the same fact — this is the menu the
 * restaurant confirmed (1h, 1m; frame 1ab). A dish that moves, is renamed, gains or
 * loses an id, or is repriced fails here with the name of what changed.
 */
const CONFIRMED_MENU: readonly (readonly [string, readonly (readonly [string, number])[]])[] = [
  ['burgere', [
    ['odin', 8900],
    ['frigg', 8900],
    ['ragnar', 9700],
    ['thor', 8900],
    ['glade-gris', 8900],
  ]],
  ['ugens-ret', []],
  ['andre-retter', [
    ['fish-n-chips', 8500],
    ['ekstra-fisk', 4200],
    ['halv-grillkylling', 8500],
    ['duerum', 6600],
    ['chiliolie-hvidloegsolie', 500],
    ['sandwich-kylling-bacon', 5300],
    ['sandwich-frikadelle', 5300],
  ]],
  ['pommes-og-snacks', [
    ['stor-pommes-frites', 2400],
    ['lille-pommes-frites', 1700],
    ['poelse-med-broed', 2600],
    ['poelse-uden-broed', 1900],
    ['poelsebroed', 800],
    ['fransk-hotdog', 2800],
    ['poelsemix', 4600],
    ['kebabmix', 5100],
    ['pariser-toast', 2200],
    ['nuggets-med-pommes-frites', 4800],
    ['snackkurv', 5200],
    ['dip', 1000],
  ]],
  ['boern', [['boerneburger', 5600], ['boernenuggets', 4800]]],
  ['drikkevarer', [
    ['alm-oel', 2000],
    ['specialoel', 2600],
    ['shaker', 2500],
    ['sodavand-aqua-dor', 2400],
    ['cocio-40', 2300],
    ['cocio-27', 1900],
    ['kildevand', 1200],
    ['brikjuice', 1200],
    ['kop-kaffe-te', 1500],
    ['genopfyld-kaffe', 1000],
    ['kande-kaffe', 6500],
    ['kande-te', 4500],
    ['varm-kakao', 2200],
  ]],
  ['dessert', [['vaniljeparfait', 3500], ['aeblekage', 3500], ['chokoladekage', 3500]]],
  ['tapas', [['tapas', 29500]]],
  ['varm-selv', [['moerbradgryde', 10800], ['lasagne', 10800], ['tarteletfyld', 10800]]],
]

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

  it('gives every section an id, and it is the slug the anchors are built from', () => {
    for (const category of MENU_CATEGORIES) {
      expect(category.id).toBe(category.slug)
      expect(category.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
    expect(new Set(MENU_CATEGORIES.map((category) => category.id)).size).toBe(MENU_CATEGORIES.length)
  })

  it('carries every dish at its confirmed id, order and price', () => {
    expect(
      MENU_CATEGORIES.map((category) => [
        category.slug,
        category.dishes.map((dish) => [dish.id, dish.priceOre]),
      ]),
    ).toEqual(CONFIRMED_MENU.map(([slug, dishes]) => [slug, dishes.map(([id, ore]) => [id, ore])]))
  })

  it('has exactly forty-six dishes, every one priced in whole øre', () => {
    expect(EVERY_DISH).toHaveLength(46)
    for (const dish of EVERY_DISH) {
      expect(Number.isInteger(dish.priceOre) && (dish.priceOre ?? 0) > 0, dish.name).toBe(true)
    }
  })

  it('gives every dish a unique, stable id', () => {
    expect(new Set(EVERY_DISH.map((dish) => dish.id)).size).toBe(EVERY_DISH.length)
    for (const dish of EVERY_DISH) {
      expect(dish.id, dish.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('keeps the confirmed names, descriptions and small grey lines', () => {
    const odin = EVERY_DISH.find((dish) => dish.id === 'odin')
    expect(odin?.name).toBe('Odin')
    expect(odin?.description).toBe(
      '200 g dry aged bøf, sennepsmayo, bacon, cheddar, karameliserede løg, bøftomat, iceberg og briochebolle.',
    )
    expect(odin?.secondaryNote).toBe('Som menu med pommes frites og sodavand 124 kr.')
    expect(odin?.labels).toEqual(['Populær'])

    // Ragnar is the one burger with its own menu price, and Varm selv the one section
    // whose grey line is a weight rather than a menu offer.
    expect(EVERY_DISH.find((dish) => dish.id === 'ragnar')?.secondaryNote).toBe(
      'Som menu med pommes frites og sodavand 132 kr.',
    )
    expect(EVERY_DISH.find((dish) => dish.id === 'lasagne')?.secondaryNote).toBe(
      '1.500 g · nok til 2–3 personer · frost',
    )
  })

  it('keeps the sections that carry an intro or a note', () => {
    const bySlug = new Map(MENU_CATEGORIES.map((category) => [category.slug, category]))
    expect(bySlug.get('burgere')?.intro).toBe(
      'Alle burgere serveres i briochebolle. Kan bestilles som menu med pommes frites og sodavand.',
    )
    expect(bySlug.get('tapas')?.intro).toBe('Til to personer 295 kr. · hver ekstra person 148 kr.')
    expect(bySlug.get('varm-selv')?.intro).toBe('Frostvarer til at tage med hjem.')
    expect(bySlug.get('ugens-ret')?.note).toBe(
      'Alle ugens retter kan også laves glutenfrie og laktosefrie. Sig til, når du bestiller.',
    )
  })

  it('does not carry "Salat efter sæson"', () => {
    expect(EVERY_DISH.some((dish) => /salat efter s/i.test(dish.name))).toBe(false)
  })

  it('carries the tapas board as the one structured document', () => {
    const tapas = EVERY_DISH.filter((dish) => dish.tapas !== null)
    expect(tapas.map((dish) => dish.name)).toEqual(['Tapas'])

    const document = tapas[0]!.tapas!
    expect(document.kind).toBe('tapas')
    expect(document.groups.map((group) => group.id)).toEqual(['base', 'choose7', 'dressing'])
    expect(document.groups.map((group) => group.choose)).toEqual([null, 7, 3])
    for (const group of document.groups) {
      expect(group.heading.length).toBeGreaterThan(0)
      expect(['fixed', 'choose']).toContain(group.mode)
      expect(group.items.length).toBeGreaterThan(0)
    }
  })

  it('marks nothing sold out and names only the confirmed Ugens ret section', () => {
    expect(EVERY_DISH.every((dish) => dish.soldOutOn === null)).toBe(true)
    expect(MENU_CATEGORIES.find((category) => category.kind === 'weekly_special')?.slug).toBe(
      'ugens-ret',
    )
  })

  it('resolves the three featured dishes the Forside names', () => {
    const view = buildMenuView(MENU, OPENING_HOURS, new Date('2026-09-09T16:00:00+02:00'))
    expect(
      selectFeaturedDishes(view.categories, HOME_PAGE.featuredDishIds).map((dish) => dish.name),
    ).toEqual(['Odin', 'Frigg', 'Ragnar'])
    expect(view.monthlyBurger).toBeNull()
  })
})

/**
 * Nothing is published for the week, the month, the news or the bar. Each of those is
 * a file with `"active": false`, and what matters is that the loader answers with the
 * same empty state the site rendered before the content moved — not with an empty card
 * or an invented placeholder.
 */
describe('nothing invented', () => {
  it('leaves Ugens ret and the Lørdagsmenu empty', () => {
    const weekly = loadWeeklySpecial()
    expect(weekly).toEqual({
      isoYear: null,
      isoWeek: null,
      days: [],
      name: null,
      description: null,
      priceSmallOre: null,
      priceLargeOre: null,
      soldOutOn: null,
      image: null,
      saturday: {
        enabled: false,
        name: null,
        description: null,
        priceOre: null,
        deadline: null,
        soldOutOn: null,
      },
    })
    expect(MENU.weeklySpecial).toEqual(weekly)
  })

  it('publishes no Månedens burger at all', () => {
    expect(loadMonthlyBurger()).toBeNull()
    expect(MENU.monthlyBurger).toBeNull()
  })

  it('publishes no announcement, so the bar is not in the page', () => {
    expect(SITE_ANNOUNCEMENT).toBeNull()
  })

  it('has no news articles', () => {
    expect(NEWS_ARTICLES).toEqual([])
  })
})

describe('the confirmed facts', () => {
  it('states the address, the two numbers, the e-mail address and the Facebook page', () => {
    expect(SITE_CONTACT).toEqual({
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
    expect(OPENING_HOURS.schedule).toEqual(CONFIRMED_SCHEDULE)
    expect(OPENING_HOURS.overrides).toEqual([])
  })

  it('carries the launch copy headings verbatim', () => {
    expect(HOME_PAGE.hero.heading).toBe('Burgeren der vandt Fyn')
    expect(ABOUT_PAGE.heading).toBe('Mad fra Carl Nielsen Hallen')
    expect(ABOUT_PAGE.storyBlocks).toHaveLength(4)
    expect(TAKEAWAY_PAGE.heading).toBe('Mad ud af huset')
    expect(TAKEAWAY_PAGE.sections.map((section) => section.heading)).toEqual([
      'Til selskaber og sammenkomster',
      'Ring og hør mere',
    ])
  })

  it('invents no catering term', () => {
    const text = [TAKEAWAY_PAGE.intro, ...TAKEAWAY_PAGE.sections.map((section) => section.body)]
      .join(' ')
      .toLowerCase()
    for (const invented of ['minimum', 'kuverter', 'levering', 'depositum', 'senest 48']) {
      expect(text, invented).not.toContain(invented)
    }
  })
})

describe('the photographs', () => {
  it('fill exactly the slots the launch record names', () => {
    expect(HOME_PAGE.hero.image).toEqual(launchPhoto('home-hero'))
    expect(HOME_PAGE.aboutExcerpt.image).toEqual(launchPhoto('about-venue'))
    expect(ABOUT_PAGE.venueImage).toEqual(launchPhoto('about-venue'))
    expect(TAKEAWAY_PAGE.image).toEqual(launchPhoto('takeaway'))
    expect(EVERY_DISH.find((dish) => dish.id === 'odin')?.image).toEqual(launchPhoto('dish-odin'))
    expect(EVERY_DISH.find((dish) => dish.id === 'ragnar')?.image).toEqual(launchPhoto('dish-ragnar'))
    // The other frames have no supplied photograph and stay their no-image state.
    expect(HOME_PAGE.award.image).toBeNull()
    expect(ABOUT_PAGE.team.image).toBeNull()
    expect(ABOUT_PAGE.method.image).toBeNull()
    expect(EVERY_DISH.filter((dish) => dish.image !== null)).toHaveLength(2)
  })

  it('name only rungs the ladder plans for the recorded size, under /media/', () => {
    for (const [slot, photo] of Object.entries(photos.photos)) {
      const image = launchPhoto(slot as keyof typeof photos.photos)
      const planned = planDerivatives(photo.width, photo.height)

      expect(image.candidates.map((candidate) => [candidate.width, candidate.height])).toEqual(
        planned.map((size) => [size.width, size.height]),
      )
      for (const candidate of image.candidates) {
        expect(candidate.avifUrl).toBe(`/media/${slot}/${candidate.width}.avif`)
        expect(candidate.webpUrl).toBe(`/media/${slot}/${candidate.width}.webp`)
      }
      expect(image.width).toBe(planned[planned.length - 1]!.width)
      expect(image.src).toMatch(/\.webp$/)
      expect(image.alt).toBe(photo.alt ?? '')
    }
  })

  it('never upscales and never falls back to the source file', () => {
    const image = buildStaticPublicImage({ slot: 'small', alt: null, width: 300, height: 200 })
    expect(image.candidates).toEqual([
      { width: 300, height: 200, avifUrl: '/media/small/300.avif', webpUrl: '/media/small/300.webp' },
    ])
    expect(image.src).toBe('/media/small/300.webp')
    expect(image.avifSrcSet).toBe('/media/small/300.avif 300w')
  })
})
