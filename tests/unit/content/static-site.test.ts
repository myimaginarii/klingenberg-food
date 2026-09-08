import { describe, expect, it } from 'vitest'

import { SITE_ANNOUNCEMENT } from '@/content/site/announcement'
import { SITE_CONTACT } from '@/content/site/contact'
import { OPENING_HOURS } from '@/content/site/hours'
import { launchPhoto } from '@/content/site/images'
import { MENU, MENU_CATEGORIES, MONTHLY_BURGER, WEEKLY_SPECIAL } from '@/content/site/menu'
import { NEWS_ARTICLES } from '@/content/site/news'
import { ABOUT_PAGE, HOME_PAGE, TAKEAWAY_PAGE } from '@/content/site/pages'
import photos from '@/content/site/photos.json'
import { buildMenuView, selectFeaturedDishes } from '@/lib/menu/view'
import { planDerivatives } from '@/lib/images/derivatives'
import { buildStaticPublicImage } from '@/lib/images/public'

import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * The tracked public content — the static rebuild's source of truth, held to the
 * confirmed facts (design 1ab; `content/launch/launch-copy.md`).
 *
 * These are the numbers and the absences the conversion promised: nine sections,
 * forty-six dishes, no "Salat efter sæson", nothing invented for the week, the month,
 * the news or the announcement — and a photograph model whose every URL names a rung
 * the build actually renders.
 */

const EVERY_DISH = MENU_CATEGORIES.flatMap((category) => category.dishes)

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

    // The document is tracked TypeScript, so its shape is a compile-time fact; what
    // is worth asserting is that every group it holds is renderable — a heading, a
    // mode, and items for the reader to choose from.
    const document = tapas[0]!.tapas!
    expect(document.kind).toBe('tapas')
    expect(document.groups.length).toBeGreaterThan(0)
    for (const group of document.groups) {
      expect(group.heading.length).toBeGreaterThan(0)
      expect(['fixed', 'choose']).toContain(group.mode)
      expect(group.items.length).toBeGreaterThan(0)
      expect(group.mode === 'choose' ? group.choose : null).not.toBe(0)
    }
  })

  it('marks nothing sold out and names only the confirmed Ugens ret note', () => {
    expect(EVERY_DISH.every((dish) => dish.soldOutOn === null)).toBe(true)
    expect(MENU_CATEGORIES.find((category) => category.kind === 'weekly_special')?.slug).toBe('ugens-ret')
  })

  it('has no week, no month and no announcement — nothing invented', () => {
    expect(WEEKLY_SPECIAL.name).toBeNull()
    expect(WEEKLY_SPECIAL.saturday.enabled).toBe(false)
    expect(MONTHLY_BURGER).toBeNull()
    expect(SITE_ANNOUNCEMENT).toBeNull()
    expect(NEWS_ARTICLES).toEqual([])
  })

  it('resolves the three featured dishes the Forside names', () => {
    const view = buildMenuView(MENU, OPENING_HOURS, new Date('2026-09-09T16:00:00+02:00'))
    expect(selectFeaturedDishes(view.categories, HOME_PAGE.featuredDishIds).map((dish) => dish.name)).toEqual([
      'Odin',
      'Frigg',
      'Ragnar',
    ])
    expect(view.monthlyBurger).toBeNull()
  })
})

describe('the confirmed facts', () => {
  it('states the address, the two numbers, the e-mail address and the Facebook page', () => {
    expect(SITE_CONTACT).toMatchObject({
      addressLine1: 'Lumbyvej 62',
      postalCode: '5792',
      city: 'Nørre Lyndelse',
      primaryPhone: '+45 63 90 83 00',
      secondaryPhone: '+45 51 79 45 66',
      email: 'soebylarsen@gmail.com',
      facebookUrl: 'https://www.facebook.com/carlnielsencafeen',
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
    expect(EVERY_DISH.find((dish) => dish.id === 'frigg')?.image).toEqual(launchPhoto('dish-frigg'))
    // The other frames have no supplied photograph and stay their no-image state.
    expect(HOME_PAGE.award.image).toBeNull()
    expect(ABOUT_PAGE.team.image).toBeNull()
    expect(ABOUT_PAGE.method.image).toBeNull()
    expect(EVERY_DISH.filter((dish) => dish.image !== null)).toHaveLength(3)
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
