import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolvePhoto, type PhotoField } from '@/lib/content/load/photo'
import { readImageManifest } from '@/lib/images/manifest'
import { loadAnnouncement } from '@/lib/content/load/announcement'
import { loadAward } from '@/lib/content/load/award'
import { stored } from '@/lib/content/load/cleared'
import { loadContact } from '@/lib/content/load/contact'
import { loadOpeningHours } from '@/lib/content/load/hours'
import { loadMenu } from '@/lib/content/load/menu'
import { loadNews } from '@/lib/content/load/news'
import { loadAboutPage, loadHomePage, loadTakeawayPage } from '@/lib/content/load/pages'
import { oreFromKroner } from '@/lib/content/load/price'
import { listContentJson, readContentJson } from '@/lib/content/load/source'
import { keepPriceTogether } from '@/lib/content/load/text'
import { planDerivatives } from '@/lib/images/derivatives'
import { buildStaticPublicImage, IMAGE_FOCUSES } from '@/lib/images/public'
import { MONTHLY_BURGER_MENU_SECTION_SLUG } from '@/lib/menu/monthly'
import { buildMenuView, selectFeaturedDishes } from '@/lib/menu/view'
import { WEEKDAY_KEYS } from '@/lib/time/calendar'

/**
 * The tracked public content, as the loaders in `lib/content/load/` hand it to the
 * pages — held to what the site's own code depends on, and to nothing else.
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
 * **What is deliberately not written down here is the restaurant's own prose.** The
 * same lesson, learned a second time and the harder way. Every heading, introduction,
 * note and button label on the site is an ordinary Pages CMS field, and this file used
 * to quote several of them — which meant the first automatic publication, a save that
 * added one word to the Forside's menu-price note, failed CI and blocked its own
 * publication PR.
 *
 * **And what is deliberately not written down here is the menu.** The same lesson a
 * third time, found by audit rather than by another blocked publication. This file used
 * to state the nine sections and their order, the forty-five dishes, the five burger
 * names and their prices, the three burgers on the Forside, the tapas board item by
 * item, the two telephone numbers, the e-mail address, the whole week's opening hours
 * and which photograph each frame draws — every one of which `.pages.yml` hands the
 * restaurant as an ordinary field. `lib/content/validate/menu.ts` has said so from the
 * start: *"the restaurant is meant to add and remove dishes, add and remove sections,
 * change every price and reorder the whole card without asking anybody, so nothing
 * about today's menu is written down"*, and it deferred the launch snapshot to this
 * file. That snapshot was a migration regression test, it did its job, and the
 * migration is long published; what is left of it here would only reject the next
 * ordinary save.
 *
 * **So what is left is the shape of the claim, not its value.** Everything below is one
 * of three things:
 *
 *   * an **invariant** the renderer really depends on — a section id is an anchor, a
 *     dish id is a React key, a photograph path is a security boundary, `kind` is a
 *     closed set the renderer switches on, a price is whole øre;
 *   * a **correspondence** — the page prints what its document says, never a default of
 *     its own and never words of its own;
 *   * a **read-only fact** the restaurant cannot change and this repository may quote:
 *     the confirmed competition result and the locked venue address, both `readonly` in
 *     `.pages.yml`.
 *
 * That an edit survives the whole path — saved, checked, loaded, rendered — is proved
 * on values nothing in this repository has ever seen, in
 * `tests/unit/content/editable-copy.test.tsx` and
 * `tests/unit/content/cms-edits.test.tsx`.
 */

const NO_BREAK_SPACE = String.fromCharCode(0xa0)

const MENU = loadMenu()
const MENU_CATEGORIES = MENU.categories
const EVERY_DISH = MENU_CATEGORIES.flatMap((category) => category.dishes)
const HOME = loadHomePage()
const ABOUT = loadAboutPage()
const TAKEAWAY = loadTakeawayPage()

/** A slug: the grammar a section id has to satisfy to be an address, and a dish id to be a key. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The menu document as it sits on disk, for the correspondences below. */
type StoredDish = {
  id: string
  name: string
  price?: string | '' | null
  secondaryNote?: string | null
  featured?: boolean
  photo?: PhotoField | null
  soldOutOn?: string | '' | null
}
type StoredCategory = {
  id: string
  name: string
  kind?: string
  intro?: string | null
  note?: string | null
  dishes?: StoredDish[]
}

const STORED_MENU = readContentJson<{ allergenNote?: string | null; categories: StoredCategory[] }>(
  'menu.json',
)
/** Read off disk, so `dishes` may be missing rather than empty: that is how Pages CMS
 * writes a section holding none (`lib/content/load/menu.ts`). */
const STORED_DISHES = STORED_MENU.categories.flatMap((category) => category.dishes ?? [])

describe('the menu the pages read', () => {
  /**
   * The sections, as a correspondence with the document plus the rules the renderer
   * depends on.
   *
   * There used to be nine of them, named and in order. There is no longer a right
   * number: "Afsnit på menuen" is a Pages CMS list the restaurant adds to, removes from
   * and reorders, and a build that went red because a section moved would be this
   * repository refusing its own editor. What the site genuinely needs is that each
   * section's id is a usable anchor, that no two share one (the sticky bar would give
   * two chips one destination), and that the loaded card is the document's own order.
   */
  it('lists the document’s own sections, in its order, each with a usable anchor', () => {
    expect(MENU_CATEGORIES.map((category) => [category.id, category.slug, category.name])).toEqual(
      STORED_MENU.categories.map((category) => [category.id, category.id, category.name]),
    )

    expect(MENU_CATEGORIES.length).toBeGreaterThan(0)
    for (const category of MENU_CATEGORIES) {
      expect(category.slug, category.name).toMatch(SLUG)
      expect(category.name.trim(), category.id).not.toBe('')
    }
    expect(new Set(MENU_CATEGORIES.map((category) => category.id)).size).toBe(MENU_CATEGORIES.length)
  })

  /**
   * `kind` is the closed set `MenuCategorySection` switches on, and the two special
   * kinds each draw one whole document. A second `weekly_special` would print Ugens ret
   * twice and a second `tapas` would print the board twice, so *at most one of each* is
   * a real architectural limit — and zero is allowed, because removing a section is how
   * the restaurant takes that body off the card.
   */
  it('gives every section a kind from the closed set, with at most one of each special body', () => {
    const KINDS = ['dishes', 'weekly_special', 'tapas']

    for (const category of MENU_CATEGORIES) {
      expect(KINDS, category.id).toContain(category.kind)
    }

    // The stored value, defaulted the way the loader defaults it — so a hand-written
    // section with no `kind` is read as an ordinary one rather than as nothing.
    expect(MENU_CATEGORIES.map((category) => [category.id, category.kind])).toEqual(
      STORED_MENU.categories.map((category) => [category.id, category.kind ?? 'dishes']),
    )

    for (const kind of ['weekly_special', 'tapas'] as const) {
      const sections = MENU_CATEGORIES.filter((category) => category.kind === kind)
      expect(sections.length, kind).toBeLessThanOrEqual(1)
      // Such a section's body is another document, so a dish left in it is a dish
      // nobody would ever see.
      for (const section of sections) expect(section.dishes, section.id).toEqual([])
    }
  })

  /**
   * The dishes, likewise: a count and an order are the restaurant's, an id is the
   * site's. Every card on the menu and every card in the Forside's band is keyed by the
   * dish id, across the whole document rather than within one section.
   */
  it('gives every dish a unique, usable id, and lists them in the document’s order', () => {
    expect(EVERY_DISH.map((dish) => [dish.id, dish.name])).toEqual(
      STORED_DISHES.map((dish) => [dish.id, dish.name]),
    )

    for (const dish of EVERY_DISH) {
      expect(dish.id, dish.name).toMatch(SLUG)
      expect(dish.name.trim(), dish.id).not.toBe('')
    }
    expect(new Set(EVERY_DISH.map((dish) => dish.id)).size).toBe(EVERY_DISH.length)
  })

  /**
   * **Prices.** This file used to name the five burgers and their two prices, which is
   * Pages CMS's "Pris i kroner" — the single field a restaurant changes most often, and
   * the one an exact assertion would block soonest.
   *
   * What is not the restaurant's is the conversion. A price is stored as the kroner
   * string somebody writes on a card ("89", "12,50") and used as the whole number of øre
   * the domain has always carried, with no floating-point arithmetic between them
   * (`lib/content/load/price.ts`). So the rule is stated against whatever is written:
   * each loaded price *is* its own stored string converted, and it is whole øre. An
   * unpriced entry is a real state — an empty field prints no price — so `null` is
   * allowed and a price that exists is not negative.
   */
  it('carries each dish’s own price, as whole øre and never as a float', () => {
    const written = new Map(STORED_DISHES.map((dish) => [dish.id, dish.price]))

    for (const dish of EVERY_DISH) {
      const expected = oreFromKroner(written.get(dish.id) ?? null, `dish "${dish.id}"`)
      expect(dish.priceOre, dish.name).toBe(expected)

      if (dish.priceOre === null) continue
      expect(Number.isInteger(dish.priceOre), dish.name).toBe(true)
      expect(dish.priceOre, dish.name).toBeGreaterThanOrEqual(0)
    }

    // And the conversion is the one the loader uses, not a second reading of the string.
    expect(oreFromKroner('89', 'test')).toBe(8900)
    expect(oreFromKroner('12,50', 'test')).toBe(1250)
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

    for (const dish of STORED_DISHES) {
      expect(Object.keys(dish), String(dish.name)).not.toContain('tapas')
    }
  })

  /**
   * The one piece of typography the loaders apply, on the one field that gets it.
   *
   * The section's introduction is Pages CMS's "Indledning" — ordinary editable prose,
   * and the sentence itself is the restaurant's to reword. What is not theirs, and what
   * this asserts, is the join: the file stores ordinary spaces so nobody has to type
   * U+00A0 into an editable document, and `keepPriceTogether` puts a non-breaking space
   * between each number and "kr." on the way out, so a narrow column never wraps to a
   * line that starts with "kr." (`lib/content/load/text.ts`).
   *
   * Which section gets it is the loader's own answer — `MONTHLY_BURGER_MENU_SECTION_SLUG`
   * — asked rather than restated, so this cannot silently pass by naming a section the
   * loader no longer treats specially.
   */
  it('joins each price to “kr.” in one section’s intro, and nowhere else on the menu', () => {
    const joined = MENU_CATEGORIES.find(
      (category) => category.slug === MONTHLY_BURGER_MENU_SECTION_SLUG,
    )
    const written = STORED_MENU.categories.find(
      (category) => category.id === MONTHLY_BURGER_MENU_SECTION_SLUG,
    )?.intro

    if (joined !== undefined && written != null) {
      expect(written).not.toContain(NO_BREAK_SPACE)
      expect(joined.intro).toBe(keepPriceTogether(written))
    }

    // On that field alone. Every other piece of menu prose is the text as written, so a
    // price stated anywhere else keeps the ordinary space it was typed with.
    const everythingElse = MENU_CATEGORIES.flatMap((category) => [
      ...(category.slug === MONTHLY_BURGER_MENU_SECTION_SLUG ? [] : [category.intro]),
      category.note,
      ...category.dishes.flatMap((dish) => [dish.description, dish.secondaryNote]),
    ])
    expect(everythingElse.filter((text) => text?.includes(NO_BREAK_SPACE))).toEqual([])
  })

  /**
   * The tapas board — its own document since phase 4D, and the one place on the menu
   * where some fields really are structural.
   *
   * Editable, and therefore not written down: the price, the small line under it, the
   * three headings and every item in every list. `.pages.yml` hands the restaurant all
   * of them. Structural, and therefore held: the group `id` and `mode` and the `choose`
   * count are `readonly: true` in the CMS *because the renderer singles out `base` and
   * lays the other lists beside it* — a free-form id would silently draw the wrong
   * layout. `TapasTable` keys each item by its own text, so a repeated item is a real
   * fault rather than a duplicate word.
   */
  it('reads the board its document carries, with the layout’s own ids and modes intact', () => {
    const board = MENU.tapas
    const written = readContentJson<{
      price?: string | '' | null
      secondaryNote?: string | null
      groups: { id: string; heading: string; mode: string; choose?: number | '' | null; items?: string[] }[]
    }>('tapas.json')

    // The correspondence: every editable value is the document's, character for character.
    expect(board.priceOre).toBe(oreFromKroner(written.price ?? null, 'tapas.json'))
    expect(board.secondaryNote).toBe(written.secondaryNote ?? null)
    expect(board.groups.map((group) => [group.id, group.heading, group.items])).toEqual(
      written.groups.map((group) => [group.id, group.heading, group.items ?? []]),
    )

    // The structure: the closed vocabulary the renderer switches on.
    const IDS = ['base', 'choose7', 'dressing']
    const MODES = ['fixed', 'choose']

    expect(board.groups.length).toBeGreaterThan(0)
    expect(new Set(board.groups.map((group) => group.id)).size).toBe(board.groups.length)
    for (const group of board.groups) {
      expect(IDS, group.id).toContain(group.id)
      expect(MODES, group.id).toContain(group.mode)
      expect(group.heading.trim(), group.id).not.toBe('')
      // A list you choose from says how many; a list that is always on the table does not.
      if (group.mode === 'choose') {
        expect(Number.isInteger(group.choose), group.id).toBe(true)
        expect(group.choose, group.id).toBeGreaterThanOrEqual(1)
      } else {
        expect(group.choose, group.id).toBeNull()
      }
      // Each item is its own React key.
      expect(new Set(group.items).size, group.id).toBe(group.items.length)
    }

    // The board is drawn by the section whose `kind` says so, and by no dish.
    const sections = MENU_CATEGORIES.filter((category) => category.kind === 'tapas')
    expect(sections.length).toBeLessThanOrEqual(1)
    for (const section of sections) expect(section.dishes).toEqual([])
  })

  /**
   * "Udsolgt i dag" is a switch the kitchen flips from a phone, so what is asserted is
   * that the loaded menu says exactly what the tracked dish says — not that no dish is
   * ever sold out. `stored` is the loader's own reading of an emptied control
   * (`lib/content/load/cleared.ts`), asked rather than restated.
   */
  it('marks a dish sold out only where its own entry says so', () => {
    const onDisk = new Map(STORED_DISHES.map((dish) => [dish.id, stored(dish.soldOutOn)] as const))

    for (const dish of EVERY_DISH) {
      expect(dish.soldOutOn, dish.name).toBe(onDisk.get(dish.id) ?? null)
    }
  })

  /**
   * The allergen line is an ordinary editable note (Pages CMS: "Note om allergener"), so
   * what is held is that the menu prints the one the document carries — the page draws
   * the line when there is one and draws none when there is not, and never writes its
   * own (`app/(site)/menu/page.tsx`).
   */
  it('prints the allergen line the menu document carries, and never one of its own', () => {
    expect(MENU.allergenNote).toBe(STORED_MENU.allergenNote ?? null)
  })

  /** And every section's own prose, likewise: the document's words or none at all. */
  it('prints each section’s own intro and note, never words of its own', () => {
    const written = new Map(
      STORED_MENU.categories.map((category) => [category.id, category] as const),
    )

    for (const category of MENU_CATEGORIES) {
      const document = written.get(category.id)!
      if (category.slug !== MONTHLY_BURGER_MENU_SECTION_SLUG) {
        expect(category.intro, category.id).toBe(document.intro ?? null)
      }
      expect(category.note, category.id).toBe(document.note ?? null)
    }
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
   * The published side of the same rule is proved on real files in
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
   * The Forside's band — "Vis på forsiden" on each dish since phase 4B.
   *
   * This used to name Odin, Frigg and Ragnar, which is a boolean on three dishes: a
   * restaurant that promotes a different burger next month would have failed CI for it.
   * The rule that is actually the site's is the selection itself — *the band shows the
   * dishes the menu marked and no others, in the menu's own order* — and it is asserted
   * against whatever is marked today. Whether that is three dishes, none or a dozen is
   * the restaurant's business; how the band behaves at each of those counts is proved on
   * fixtures in `tests/unit/menu/view.test.ts`.
   */
  it('puts exactly the dishes marked “Vis på forsiden” in the band, in menu order', () => {
    const view = buildMenuView(MENU, loadOpeningHours(), new Date('2026-09-09T16:00:00+02:00'))
    const marked = MENU_CATEGORIES.flatMap((category) =>
      category.dishes.filter((dish) => dish.featured).map((dish) => dish.id),
    )

    expect(selectFeaturedDishes(view.categories).map((dish) => dish.id)).toEqual(marked)

    // And the mark is the document's own, not something the loader decided.
    expect(marked).toEqual(STORED_DISHES.filter((dish) => dish.featured === true).map((dish) => dish.id))
  })

  it('hands every caller the same value, so the shell and a page share one object', () => {
    expect(loadMenu()).toBe(MENU)
    expect(loadOpeningHours()).toBe(loadOpeningHours())
    expect(loadContact()).toBe(loadContact())
  })
})

describe('the confirmed facts', () => {
  /**
   * The address — the one contact block that is **not** the restaurant's to change.
   *
   * `.pages.yml` marks `venueName`, `addressLine1`, `postalCode` and `city`
   * `readonly: true`: the restaurant does not move, and a wrong address is the one
   * mistake on this site a guest cannot recover from. So these four are quoted, and
   * quoting them is the point rather than an oversight.
   */
  it('states the locked venue and address, which are not editable', () => {
    expect(loadContact()).toMatchObject({
      venueName: 'Carl Nielsen Hallen',
      addressLine1: 'Lumbyvej 62',
      postalCode: '5792',
      city: 'Nørre Lyndelse',
      // Not a Pages CMS field at all: the map carries its own attribution.
      mapAttribution: null,
    })
  })

  /**
   * The telephone numbers, the e-mail address and the Facebook page — all four editable
   * ("Telefon", "Ekstra telefon", "E-mail", "Facebook-side"), so all four are read off
   * the document rather than quoted. A restaurant that changes its number must not have
   * to change this repository too.
   *
   * What is held instead is what each field has to *be* for the page beside it to work:
   * the two required fields are present and non-empty, a number can be dialled, the
   * address can be mailed, and a Facebook link — optional — is an `https` link to
   * Facebook rather than to wherever a paste happened to land.
   */
  it('carries its document’s numbers, address and social link, each in a usable form', () => {
    const contact = loadContact()
    const written = readContentJson<{
      primaryPhone?: string | null
      secondaryPhone?: string | null
      email?: string | null
      facebookUrl?: string | null
    }>('contact.json')

    expect(contact.primaryPhone).toBe(written.primaryPhone ?? null)
    expect(contact.secondaryPhone).toBe(written.secondaryPhone ?? null)
    expect(contact.email).toBe(written.email ?? null)
    expect(contact.facebookUrl).toBe(written.facebookUrl ?? null)

    // Required by `check:content`, and by the design: a restaurant that takes its
    // orders on the telephone without a number on the page is not a state this has.
    expect(contact.primaryPhone?.trim()).toBeTruthy()
    expect(contact.email?.trim()).toBeTruthy()
    expect(contact.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)

    for (const number of [contact.primaryPhone, contact.secondaryPhone]) {
      if (number === null) continue
      expect(number.replace(/\D/g, '').length, number).toBeGreaterThanOrEqual(8)
    }

    // The host is a closed set rather than a suffix. `evilfacebook.com` ends with
    // "facebook.com" and is somebody else's site, which is the whole reason
    // `validateFacebook` compares against a list — this asks the same question.
    if (contact.facebookUrl !== null) {
      const url = new URL(contact.facebookUrl)
      expect(url.protocol).toBe('https:')
      expect(['facebook.com', 'www.facebook.com']).toContain(url.hostname)
    }
  })

  /**
   * The opening hours — Pages CMS's "Åbningstider", a form with seven days in it and a
   * list of special days beside them.
   *
   * This used to be `toEqual(CONFIRMED_SCHEDULE)` with `overrides: []` beside it, which
   * made the restaurant's own week a code invariant: moving Wednesday from 15:00 to
   * 16:00, or publishing a closure for Christmas Eve, would have gone red. Both are
   * exactly what that form is for.
   *
   * What the engine needs is a complete week in the shape it reads — all seven days,
   * each either closed or carrying both times, every time a real clock reading — and
   * the overrides the document lists, in the two states the page distinguishes. The
   * engine's own behaviour is proved against fixed schedules in
   * `tests/unit/hours/`, which is where a fixed schedule belongs.
   */
  it('reads the whole week its document carries, in the shape the engine reads', () => {
    const hours = loadOpeningHours()
    const written = readContentJson<{
      schedule: Record<string, { closed?: boolean; from?: string | null; to?: string | null }>
      overrides?: { date: string; kind: string; status: string }[]
    }>('hours.json')
    const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

    expect(Object.keys(hours.schedule)).toEqual([...WEEKDAY_KEYS])

    for (const weekday of WEEKDAY_KEYS) {
      const day = hours.schedule[weekday]
      const document = written.schedule[weekday]!
      const isClosed = document.closed === true

      if (isClosed) {
        expect(day, weekday).toEqual({ closed: true })
      } else {
        expect(day, weekday).toEqual({ from: document.from, to: document.to })
        expect(document.from, weekday).toMatch(CLOCK)
        expect(document.to, weekday).toMatch(CLOCK)
      }
    }

    // The special days, as the document lists them and in the order it lists them.
    expect(hours.overrides.map((entry) => [entry.date, entry.kind, entry.status])).toEqual(
      (written.overrides ?? []).map((entry) => [entry.date, entry.kind, entry.status]),
    )
    for (const entry of hours.overrides) {
      expect(entry.date, entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(['closed', 'custom'], entry.date).toContain(entry.kind)
      expect(['draft', 'published'], entry.date).toContain(entry.status)
      if (entry.kind === 'custom') {
        expect(entry.opensAt, entry.date).toMatch(CLOCK)
        expect(entry.closesAt, entry.date).toMatch(CLOCK)
      }
    }
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
   * "the page shows what the file says" is a claim with a real way to be false.
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
    for (const section of TAKEAWAY.sections) expect(section.id).toMatch(SLUG)
    expect(new Set(TAKEAWAY.sections.map((section) => section.id)).size).toBe(
      TAKEAWAY.sections.length,
    )
  })

  /**
   * The competition result — `readonly: true` on both fields in `.pages.yml`, and the
   * one piece of prose on this site the restaurant is deliberately not given.
   *
   * A confirmed third-party result is not copy: rewording it would misstate what a jury
   * decided. So it is quoted here, and that is the whole reason the other quotations
   * went.
   */
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
   * note keeps the ordinary space it was typed with — the non-breaking join is one
   * section intro's alone (`lib/content/load/text.ts`), and this is the field that would
   * notice if it ever stopped being.
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

/**
 * The photographs.
 *
 * Every frame on the site is a Pages CMS `foto` object — a file picked from the media
 * library, a description, and a crop from a two-value list — so which photograph a frame
 * draws, what a screen reader hears and where a crop is anchored are all the
 * restaurant's. This file used to name the file behind each frame, quote two alt
 * sentences, and state that Frigg was cropped high and Thor had no picture at all;
 * every one of those is a save away from red, and none of them is a fact about this
 * codebase.
 *
 * What the pipeline exists to guarantee is held instead, on whatever is selected today:
 * a frame draws its own field and never invents one, a description is the one that was
 * written or none at all, a crop is from the closed vocabulary, and every URL a page
 * would print names a derivative the build actually rendered.
 */
describe('the photographs', () => {
  /** Every frame on the site, as the pair the correspondence is between. */
  const SURFACES: readonly { name: string; loaded: unknown; written: unknown }[] = (() => {
    const home = readContentJson<{
      hero?: { photo?: PhotoField | null }
      award?: { photo?: PhotoField | null }
      aboutExcerpt?: { photo?: PhotoField | null }
    }>('pages', 'home.json')
    const about = readContentJson<{
      venuePhoto?: PhotoField | null
      team?: { photo?: PhotoField | null }
      method?: { photo?: PhotoField | null }
    }>('pages', 'about.json')
    const takeaway = readContentJson<{ photo?: PhotoField | null }>('pages', 'takeaway.json')
    const dishPhotos = new Map(STORED_DISHES.map((dish) => [dish.id, dish.photo ?? null]))

    return [
      { name: 'home.hero', loaded: HOME.hero.image, written: home.hero?.photo ?? null },
      { name: 'home.award', loaded: HOME.award.image, written: home.award?.photo ?? null },
      {
        name: 'home.aboutExcerpt',
        loaded: HOME.aboutExcerpt.image,
        written: home.aboutExcerpt?.photo ?? null,
      },
      { name: 'about.venue', loaded: ABOUT.venueImage, written: about.venuePhoto ?? null },
      { name: 'about.team', loaded: ABOUT.team.image, written: about.team?.photo ?? null },
      { name: 'about.method', loaded: ABOUT.method.image, written: about.method?.photo ?? null },
      { name: 'takeaway', loaded: TAKEAWAY.image, written: takeaway.photo ?? null },
      ...EVERY_DISH.map((dish) => ({
        name: `dish "${dish.id}"`,
        loaded: dish.image,
        written: dishPhotos.get(dish.id) ?? null,
      })),
    ]
  })()

  it('draws the file each frame’s own field selects, and no frame invents one', () => {
    expect(SURFACES.length).toBeGreaterThan(5)

    for (const surface of SURFACES) {
      expect(surface.loaded, surface.name).toEqual(
        resolvePhoto(surface.written as PhotoField | null, surface.name),
      )
    }

    // Something is selected: a suite where every frame happened to be empty would prove
    // nothing about the resolution above.
    expect(SURFACES.filter((surface) => surface.loaded !== null).length).toBeGreaterThan(0)
  })

  it('hears the description that was written, or nothing at all — never an invented one', () => {
    for (const surface of SURFACES) {
      const image = surface.loaded as { alt: string } | null
      if (image === null) continue

      const written = (surface.written as { alt?: unknown } | null)?.alt
      const expected = typeof written === 'string' ? written.trim() : ''
      expect(image.alt, surface.name).toBe(expected)
    }
  })

  it('anchors every crop on a value from the closed vocabulary', () => {
    for (const surface of SURFACES) {
      const image = surface.loaded as { focus: string } | null
      if (image === null) continue

      const written = (surface.written as { focus?: unknown } | null)?.focus
      expect(IMAGE_FOCUSES as readonly string[], surface.name).toContain(image.focus)
      expect(image.focus, surface.name).toBe(written ?? 'center')
    }
  })

  it('name only rungs the ladder plans for the measured size, under /media/', () => {
    const manifest = readImageManifest().photos
    expect(Object.keys(manifest).length).toBeGreaterThan(0)

    for (const [slot, measured] of Object.entries(manifest)) {
      const image = resolvePhoto({ file: `/photos/${measured.file}` }, slot)!
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
      ...SURFACES.map((surface) => surface.loaded),
      MENU.weeklySpecial.image,
      MENU.monthlyBurger?.image ?? null,
    ].filter((image): image is { src: string; candidates: { avifUrl: string; webpUrl: string }[] } =>
      image !== null && image !== undefined,
    )

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

    // Nothing an editor maintains reaches a page: no source directory and no original
    // extension, whichever photographs are selected today.
    const everything = JSON.stringify(SURFACES.map((surface) => surface.loaded))
    expect(everything).not.toContain('/photos/')
    for (const extension of ['.png', '.jpg', '.jpeg']) {
      expect(everything, extension).not.toContain(extension)
    }
  })
})
