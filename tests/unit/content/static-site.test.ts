import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolvePhoto } from '@/lib/content/load/photo'
import { readImageManifest } from '@/lib/images/manifest'
import { loadAnnouncement } from '@/lib/content/load/announcement'
import { loadAward } from '@/lib/content/load/award'
import { stored } from '@/lib/content/load/cleared'
import { loadContact } from '@/lib/content/load/contact'
import { loadOpeningHours } from '@/lib/content/load/hours'
import { loadMenu } from '@/lib/content/load/menu'
import { loadNews } from '@/lib/content/load/news'
import { loadAboutPage, loadHomePage, loadTakeawayPage } from '@/lib/content/load/pages'
import { listContentJson, readContentJson } from '@/lib/content/load/source'
import { keepPriceTogether } from '@/lib/content/load/text'
import { planDerivatives } from '@/lib/images/derivatives'
import { buildStaticPublicImage } from '@/lib/images/public'
import { buildMenuView, selectFeaturedDishes } from '@/lib/menu/view'

import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * The tracked public content — the static site's source of truth, held to the
 * confirmed facts (design 1ab; `content/launch/launch-copy.md`) — as the loaders in
 * `lib/content/load/` hand it to the pages.
 *
 * These are the numbers the conversion promised: nine sections, forty-five dishes and
 * the tapas board beside them, no "Salat efter sæson", and a photograph model whose
 * every URL names a rung the build actually renders.
 *
 * **What is deliberately not written down here is today's operating state.** A week, a
 * month, an announcement, an article and a sold-out sign are the five things the
 * restaurant publishes and withdraws from Pages CMS. This file used to assert that
 * there were none of them, which turned an ordinary publication into a red build — the
 * phase 4E/4F rehearsal on live content is what proved it. Each of those is now a
 * *correspondence* with the tracked documents instead: shown exactly where a document
 * says so, and never otherwise. That the same rule holds once something *is* published
 * is proved on real files in `tests/unit/content/authored-content.test.ts`.
 *
 * **And what is deliberately not written down here is the restaurant's own prose.** The
 * same lesson, learned a second time and the harder way. Every heading, introduction,
 * note and button label on the site is an ordinary Pages CMS field, and this file used
 * to quote several of them — which meant the first automatic publication, a save that
 * added one word to the Forside's menu-price note, failed CI and blocked its own
 * publication PR. A test that fails because the restaurant reworded its own page is not
 * protecting anything; it is this repository refusing its own editor. Those assertions
 * are now *correspondences* too: the page prints its document's words, never a default
 * and never words of its own. What stays quoted is what is not the restaurant's to
 * reword — the confirmed competition result (read-only in Pages CMS), the locked
 * address, the prices, the ids, and the shape of the documents themselves.
 *
 * That the words survive the whole path — saved, checked, loaded, rendered — is proved
 * on wording nothing in this repository has ever seen, in
 * `tests/unit/content/editable-copy.test.tsx`.
 *
 * **Forty-five, and it used to be written as forty-six.** The board was once a
 * forty-sixth "dish" carrying the three lists as a field; phase 4D moved it into
 * `content/site/tapas.json` and gave its section its own `kind`, so the menu document
 * now holds forty-five real dishes and the board is counted where it lives. Nothing on
 * the page changed: the board never rendered a dish heading or a dish card, which the
 * end-to-end suite has always asserted by counting forty-five headings on /menu.
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

  it('has exactly forty-five dishes, every one priced in whole øre', () => {
    expect(EVERY_DISH).toHaveLength(45)
    for (const dish of EVERY_DISH) {
      expect(Number.isInteger(dish.priceOre) && (dish.priceOre ?? 0) > 0, dish.name).toBe(true)
    }
  })

  /**
   * The one thing an ordinary dish must *not* have, stated as a fact about the loaded
   * menu rather than about one file: no dish carries the tapas board, or any part of
   * it, as a field. That is what keeps every dish's editor an ordinary dish form.
   */
  it('gives no dish a tapas field, in the domain or on disk', () => {
    for (const dish of EVERY_DISH) {
      expect(Object.keys(dish), dish.name).not.toContain('tapas')
    }

    const onDisk = JSON.parse(
      readFileSync(join(process.cwd(), 'content', 'site', 'menu.json'), 'utf8'),
    ) as { categories: { dishes?: Record<string, unknown>[] }[] }
    for (const category of onDisk.categories) {
      // Read off disk, so `dishes` may be missing rather than empty: that is how Pages
      // CMS writes a section holding none (`lib/content/load/menu.ts`). The loaded menu
      // above always has the list; the raw file is the one that may not.
      for (const dish of category.dishes ?? []) {
        expect(Object.keys(dish), String(dish.name)).not.toContain('tapas')
      }
    }
  })

  /** Every section says what it is, so nothing in the menu loads as an unset type. */
  it('names every section’s type explicitly, and only Ugens ret is the weekly one', () => {
    const onDisk = JSON.parse(
      readFileSync(join(process.cwd(), 'content', 'site', 'menu.json'), 'utf8'),
    ) as { categories: { id: string; kind?: string }[] }

    expect(onDisk.categories.map((category) => [category.id, category.kind])).toEqual([
      ['burgere', 'dishes'],
      ['ugens-ret', 'weekly_special'],
      ['andre-retter', 'dishes'],
      ['pommes-og-snacks', 'dishes'],
      ['boern', 'dishes'],
      ['drikkevarer', 'dishes'],
      ['dessert', 'dishes'],
      ['tapas', 'tapas'],
      ['varm-selv', 'dishes'],
    ])
  })

  /**
   * The one piece of typography the loaders apply, on the one field that gets it.
   *
   * The Burgere introduction is Pages CMS's "Indledning" — ordinary editable prose, and
   * the sentence itself is the restaurant's to reword. What is not theirs, and what this
   * asserts, is the join: the file stores ordinary spaces so nobody has to type U+00A0
   * into an editable document, and `keepPriceTogether` puts a non-breaking space between
   * each number and "kr." on the way out, so a narrow column never wraps to a line that
   * starts with "kr." (`lib/content/load/text.ts`). Stated against the stored sentence
   * rather than against a quotation of it, so rewording the line cannot fail CI.
   */
  it('joins each price to “kr.” in the Burgere intro, and nowhere else on the menu', () => {
    const burgers = MENU_CATEGORIES.find((category) => category.slug === 'burgere')
    const written = readContentJson<{ categories: { id: string; intro?: string | null }[] }>(
      'menu.json',
    ).categories.find((category) => category.id === 'burgere')?.intro

    expect(written).toBeTruthy()
    expect(written).not.toContain(NO_BREAK_SPACE)
    expect(burgers?.intro).toBe(keepPriceTogether(written as string))

    // On that field alone. Every other piece of menu prose is the text as written, so a
    // price stated anywhere else keeps the ordinary space it was typed with.
    const everythingElse = MENU_CATEGORIES.flatMap((category) => [
      ...(category.slug === 'burgere' ? [] : [category.intro]),
      category.note,
      ...category.dishes.flatMap((dish) => [dish.description, dish.secondaryNote]),
    ])
    expect(everythingElse.filter((text) => text?.includes(NO_BREAK_SPACE))).toEqual([])
  })

  /**
   * The confirmed burger prices, and the layout rule that goes with them: the menu price
   * is stated in the section's own introduction and no card repeats it, which is a card
   * carrying no second line rather than a sentence not being written twice.
   */
  it('prices the five burgers as confirmed, and gives no card a second line', () => {
    const burgers = MENU_CATEGORIES.find((category) => category.slug === 'burgere')
    expect(burgers?.dishes.map((dish) => [dish.name, dish.priceOre, dish.secondaryNote])).toEqual([
      ['Odin', 8900, null],
      ['Frigg', 8900, null],
      ['Ragnar', 9700, null],
      ['Thor', 8900, null],
      ['Glade Gris', 8900, null],
    ])
  })

  it('gives every dish and every section a unique id', () => {
    expect(new Set(EVERY_DISH.map((dish) => dish.id)).size).toBe(EVERY_DISH.length)
    expect(new Set(MENU_CATEGORIES.map((category) => category.id)).size).toBe(MENU_CATEGORIES.length)
  })

  it('does not carry "Salat efter sæson"', () => {
    expect(EVERY_DISH.some((dish) => /salat efter s/i.test(dish.name))).toBe(false)
  })

  /**
   * The board, in full — the price, the line beneath it, the three lists in their order
   * and every item in each. It is the whole confirmed board rather than a shape check,
   * because moving it out of `menu.json` had to change nothing a guest reads.
   */
  it('carries the tapas board as the one structured document', () => {
    const sections = MENU_CATEGORIES.filter((category) => category.kind === 'tapas')
    expect(sections.map((category) => category.slug)).toEqual(['tapas'])
    expect(sections[0]?.dishes).toEqual([])
    expect(sections[0]?.intro).toBe('Til to personer 295 kr. · hver ekstra person 148 kr.')

    const board = MENU.tapas
    expect(board.priceOre).toBe(29500)
    expect(board.secondaryNote).toBe('+148 kr. pr. ekstra person')
    expect(board.groups.map((group) => [group.id, group.heading, group.mode, group.choose])).toEqual([
      ['base', 'Altid med på bordet', 'fixed', null],
      ['choose7', 'I vælger 7', 'choose', 7],
      ['dressing', 'Og 3 dressinger', 'choose', 3],
    ])
    expect(board.groups.map((group) => group.items)).toEqual([
      [
        'Hjemmebagt brød',
        'Rugchips',
        'Grissini',
        'Saltmandler',
        'Syltede rødløg',
        'Syltet peberfrugt',
        'Kryddersmør',
        'Oliven',
        'Frugt',
      ],
      [
        'Laksetatar',
        'Stegte tigerrejer',
        'Krondyr-spegepølse med jalapeños',
        'Chorizo',
        'Serranoskinke',
        'Bresaola',
        'Hønsesalat',
        'Krebsehalesalat',
        'Ølpinde',
        'Mini porre/bacon-tærte',
        'Paté med hvidløg',
        'Gouda med brændenælde',
        'Gouda med chili',
        'Brie',
      ],
      ['Pesto', 'Hummus', 'Urtemayo', 'Estragonmayo', 'Chilimayo', 'Aioli'],
    ])
  })

  /**
   * "Udsolgt i dag" is a switch the kitchen flips from a phone, so what is asserted is
   * that the loaded menu says exactly what the tracked dish says — not that no dish is
   * ever sold out. `stored` is the loader's own reading of an emptied control
   * (`lib/content/load/cleared.ts`), asked rather than restated.
   */
  it('marks a dish sold out only where its own entry says so, and names one weekly section', () => {
    const onDisk = new Map(
      readContentJson<{
        categories: { dishes?: { id: string; soldOutOn?: string | '' | null }[] }[]
      }>('menu.json').categories.flatMap((category) =>
        // Raw again: a section Pages CMS saved with no dishes has no `dishes` key.
        (category.dishes ?? []).map((dish) => [dish.id, stored(dish.soldOutOn)] as const),
      ),
    )

    for (const dish of EVERY_DISH) {
      expect(dish.soldOutOn, dish.name).toBe(onDisk.get(dish.id) ?? null)
    }
    expect(MENU_CATEGORIES.find((category) => category.kind === 'weekly_special')?.slug).toBe('ugens-ret')
  })

  /**
   * The allergen line is an ordinary editable note (Pages CMS: "Note om allergener"), so
   * what is held is that the menu prints the one the document carries — the page draws
   * the line when there is one and draws none when there is not, and never writes its
   * own (`app/(site)/menu/page.tsx`).
   */
  it('prints the allergen line the menu document carries, and never one of its own', () => {
    const written = readContentJson<{ allergenNote?: string | null }>('menu.json').allergenNote
    expect(MENU.allergenNote).toBe(written ?? null)
  })

  /**
   * Nothing invented — as a correspondence with the tracked documents, rather than as
   * "there are none of them".
   *
   * The claim worth keeping is that the site shows a week, a month, an announcement or
   * an article **exactly where a tracked document says so**: no fallback week, no
   * placeholder burger, no announcement conjured out of the message fields that sit on
   * disk while the flag is off, and no article that is not a published file. Written the
   * other way round it also asserted that the restaurant had published nothing, which is
   * not a fact about this codebase and not one CI may hold it to.
   *
   * Today every flag is off, so each line below reads `false`. That is the point: the
   * day one of them is on, the assertion follows the document instead of failing. The
   * published side of the same rule is proved on real files in
   * `tests/unit/content/authored-content.test.ts`.
   */
  it('shows a week, a month, an announcement and news only where a document says so', () => {
    const weekly = readContentJson<{ active: boolean; saturday?: { enabled?: boolean } }>(
      'weekly-special.json',
    )
    const monthly = readContentJson<{ active: boolean }>('monthly-burger.json')
    const announcement = readContentJson<{ active: boolean }>('announcement.json')

    // An active week is held to having a name by `validateWeeklySpecial`, and an
    // inactive one loads as the approved empty card — so "there is a week" and "the
    // document is active" are the same question.
    expect(MENU.weeklySpecial.name !== null).toBe(weekly.active)
    expect(MENU.weeklySpecial.saturday.enabled).toBe(
      weekly.active && weekly.saturday?.enabled === true,
    )
    expect(MENU.monthlyBurger !== null).toBe(monthly.active)
    expect(loadAnnouncement() !== null).toBe(announcement.active)

    // Every published file and nothing else. Compared as a set: which articles exist is
    // this assertion's business, and the order they are listed in is the loader's own.
    const published = listContentJson('news').filter(
      (slug) => readContentJson<{ published?: boolean }>('news', `${slug}.json`).published === true,
    )
    expect(loadNews().map((article) => article.slug).sort()).toEqual([...published].sort())
  })

  /**
   * The confirmed Forside band, after phase 4B moved the choice onto the dishes: the
   * same three burgers, in the same order, now read off `menu.json`'s own "Vis på
   * forsiden" rather than a list of ids kept on the Forside.
   */
  it('resolves the three featured dishes, in menu order', () => {
    const view = buildMenuView(MENU, loadOpeningHours(), new Date('2026-09-09T16:00:00+02:00'))
    expect(selectFeaturedDishes(view.categories).map((dish) => dish.name)).toEqual([
      'Odin',
      'Frigg',
      'Ragnar',
    ])
  })

  it('marks those three dishes and no others in the tracked menu', () => {
    const featured = MENU.categories.flatMap((category) =>
      category.dishes.filter((dish) => dish.featured).map((dish) => dish.id),
    )
    expect(featured).toEqual(['odin', 'frigg', 'ragnar'])
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

  /**
   * The three pages' words, as a correspondence with their documents.
   *
   * These used to be quoted — "carries the launch copy headings verbatim" — and quoting
   * them was right while the launch copy was the source of truth and nobody could change
   * it. It is not right now: every heading, paragraph and section title below is an
   * ordinary Pages CMS field, and a build that went red because the restaurant reworded
   * its own page would be this repository refusing its own editor. That is not a
   * hypothetical — it is what happened to the Forside's featured note on the first
   * automatic publication.
   *
   * What CI may hold the pages to is the part that is not the restaurant's: **a page
   * prints its document's words and never words of its own.** Om os in particular has
   * two default headings for a document that sets none (`lib/site/defaults.ts`), so
   * "the page shows what the file says" is a claim with a real way to be false. That the
   * words also survive the loader and the renderer intact is proved on wording this
   * repository has never seen, in `tests/unit/content/editable-copy.test.tsx`.
   */
  it('prints each page’s own heading and story, never a default of its own', () => {
    const home = readContentJson<{ hero: { heading?: string | null } }>('pages', 'home.json')
    const about = readContentJson<{ heading?: string | null; story?: string[] }>(
      'pages',
      'about.json',
    )
    const takeaway = readContentJson<{
      heading?: string | null
      sections?: { id: string; heading?: string | null }[]
    }>('pages', 'takeaway.json')

    expect(HOME.hero.heading).toBe(home.hero.heading ?? null)
    expect(ABOUT.heading).toBe(about.heading ?? null)
    expect(ABOUT.storyBlocks).toEqual(about.story ?? [])
    expect(TAKEAWAY.heading).toBe(takeaway.heading ?? null)
    expect(TAKEAWAY.sections.map((section) => [section.id, section.heading])).toEqual(
      (takeaway.sections ?? []).map((section) => [section.id, section.heading ?? null]),
    )

    // And the scaffolding the renderers map over is there: Om os is a story in
    // paragraphs, and every takeaway section has the id that becomes its address.
    expect(ABOUT.storyBlocks.length).toBeGreaterThan(0)
    for (const paragraph of ABOUT.storyBlocks) expect(paragraph.trim()).not.toBe('')
    for (const section of TAKEAWAY.sections) expect(section.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('states one award, in the same words on the Forside and on Om os', () => {
    const award = loadAward()
    expect(award.title).toBe('Fyns bedste burger 2026 og nr. 4 i Danmark')
    expect(award.text).toContain('Danmarks Bedste Burger 2026')
    expect(HOME.award.title).toBe(award.title)
    expect(HOME.award.text).toBe(award.text)
  })

  /**
   * The takeaway button's label, its telephone line and the Forside's menu-price note —
   * three more editable fields, held to the two things about them that are not editable.
   *
   * The label is *required*: a button with nothing written on it is not a state the
   * design has, and `loadTakeawayPage` refuses a document without one. The Forside's
   * note states a price and keeps the ordinary space it was typed with — the
   * non-breaking join is the Burgere introduction's alone (`lib/content/load/text.ts`),
   * and this is the field that would notice if it ever stopped being.
   */
  it('carries its documents’ label and notes, with the button’s label never empty', () => {
    const takeaway = readContentJson<{ phoneNote?: string | null; ctaLabel?: string | null }>(
      'pages',
      'takeaway.json',
    )
    const home = readContentJson<{ featured?: { note?: string | null } }>('pages', 'home.json')

    expect(TAKEAWAY.ctaLabel).toBe(takeaway.ctaLabel?.trim())
    expect(TAKEAWAY.ctaLabel).not.toBe('')
    expect(TAKEAWAY.phoneNote).toBe(takeaway.phoneNote ?? null)
    expect(HOME.featured.note).toBe(home.featured?.note ?? null)
    expect(HOME.featured.note ?? '').not.toContain(NO_BREAK_SPACE)
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
    // (Ugens ret's frame is not listed here: whether there is a week at all is today's
    // operating state, and it is asserted where the rest of that state is.)
    expect(dish('thor')?.image).toBeNull()
    expect(HOME.award.image).toBeNull()
    expect(ABOUT.team.image).toBeNull()
    expect(ABOUT.method.image).toBeNull()
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
