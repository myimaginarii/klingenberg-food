import { renderToStaticMarkup } from 'react-dom/server'

import { afterAll, describe, expect, it } from 'vitest'

import { DishCard } from '@/components/site/menu/DishCard'
import { PhoneNumbers } from '@/components/site/contact/PhoneNumbers'
import { TapasTable } from '@/components/site/menu/TapasTable'
import type { TapasBoard } from '@/lib/content/types'
import { formatPrice } from '@/lib/format/danish'
import { formatDailyHours } from '@/lib/hours/format'
import type { WeeklySchedule } from '@/lib/hours/types'
import { readImageManifest } from '@/lib/images/manifest'
import type { DishView } from '@/lib/menu/view'

import {
  checkContent,
  contentFixture,
  loadedContent,
  removeContentFixtures,
} from '../../support/content-fixture'

/**
 * An ordinary afternoon in Pages CMS — every kind of edit the restaurant is given, made
 * at once, and proved to reach the site.
 *
 * `editable-copy.test.tsx` is the prose half of this and came first, out of a real
 * incident: a save reworded one sentence on the Forside and a unit test quoting that
 * sentence blocked the publication. The audit that followed found the same shape
 * everywhere else — the burger prices, the featured dishes, the section order, the whole
 * week's opening hours, the telephone numbers, the tapas board, the photograph behind
 * each frame — all frozen by required CI, all ordinary Pages CMS fields.
 *
 * Those quotations are gone (`./static-site.test.ts`, `tests/e2e/support/site.ts`), and
 * this is what stands in their place: **a valid edit is accepted, reaches the page, and
 * changes nothing it did not touch.** Eight of them, in one save, because a restaurant
 * does not edit one field at a time:
 *
 *   1. a dish's price               5. a photograph's description and crop
 *   2. a dish's name and description 6. the tapas price, a heading and an item
 *   3. which dishes are featured     7. a section's own prose, and the section order
 *   4. the opening hours             8. the telephone numbers and the e-mail address
 *
 * Every value below is one nothing in this repository has ever contained, so a path that
 * quietly depends on *which* value was written fails here on a value it has never seen.
 * It runs through the two entry points CI runs — `npm run check:content` and the loaders
 * — each in its own process over a copy of the tracked tree
 * (`tests/support/content-fixture.ts`), and then through the components that draw the
 * result. Nothing here writes to `content/site/`.
 *
 * The other direction is at the bottom: the edits that are *not* valid are still
 * refused, one fixture each, so none of this loosened a check.
 */

afterAll(removeContentFixtures)

/** A photograph that really is in `public/photos/`, whichever one that is. */
const A_PHOTO = `/photos/${Object.values(readImageManifest().photos)[0]!.file}`

/**
 * The edit, as values. A price nobody has charged, names in Danish that appear nowhere
 * in this repository, a week the restaurant has never kept, and a number no telephone
 * would dial here.
 */
const EDIT = {
  priceKroner: '163',
  priceOre: 16300,
  dishName: 'Skovsøster',
  dishDescription: 'Med bagte rodfrugter og en skefuld tyttebær.',
  sectionIntro: 'Vi skifter ud i afsnittet, når sæsonen skifter.',
  alt: 'En tallerken fotograferet lige oppefra på et træbord.',
  focus: 'upper',
  tapasPrice: '317',
  tapasPriceOre: 31700,
  tapasHeading: 'Det står altid fremme',
  tapasItem: 'Ristede græskarkerner',
  wednesdayFrom: '16:30',
  wednesdayTo: '21:15',
  primaryPhone: '+45 22 11 44 77',
  secondaryPhone: '+45 22 11 44 78',
  email: 'bestilling@klingenbergfood.example',
  facebookUrl: 'https://www.facebook.com/et-andet-opslag',
} as const

/** What the fixture actually chose to edit, filled in while the tree is written. */
type Chosen = {
  dishId: string
  dishIdWithPhoto: string
  sectionId: string
  featured: string[]
  sectionOrder: string[]
  dishOrder: string[]
}
const chosen: Chosen = {
  dishId: '',
  dishIdWithPhoto: '',
  sectionId: '',
  featured: [],
  sectionOrder: [],
  dishOrder: [],
}

type StoredPhoto = { file?: string | null; alt?: string | null; focus?: string | null }
type StoredDish = {
  id: string
  name: string
  price?: string | null
  description?: string | null
  featured?: boolean
  photo?: StoredPhoto | null
}
type StoredCategory = {
  id: string
  name: string
  kind?: string
  intro?: string | null
  dishes?: StoredDish[]
}

const EDITED = contentFixture(({ read, write }) => {
  // ---- the menu: a price, a name, a description, the featured mark, an order -------
  const menu = read('content/site/menu.json') as { categories: StoredCategory[] }

  const ordinary = menu.categories.filter(
    (category) => (category.kind ?? 'dishes') === 'dishes' && (category.dishes?.length ?? 0) > 1,
  )
  const section = ordinary[0]!
  chosen.sectionId = section.id

  // 1 & 2 — the first dish of that section is renamed, redescribed and repriced.
  const dish = section.dishes![0]!
  chosen.dishId = dish.id
  dish.name = EDIT.dishName
  dish.description = EDIT.dishDescription
  dish.price = EDIT.priceKroner

  // 3 — the mark moves: every existing "Vis på forsiden" is cleared and the last dish
  // of this section takes it instead.
  for (const category of menu.categories) {
    for (const entry of category.dishes ?? []) entry.featured = false
  }
  const promoted = section.dishes![section.dishes!.length - 1]!
  promoted.featured = true
  chosen.featured = [promoted.id]

  // 5 — a photograph's description and crop, on a dish that has one (or is given one).
  const illustrated = menu.categories
    .flatMap((category) => category.dishes ?? [])
    .find((entry) => typeof entry.photo?.file === 'string' && entry.photo.file !== '')
  const framed = illustrated ?? dish
  framed.photo = { file: framed.photo?.file ?? A_PHOTO, alt: EDIT.alt, focus: EDIT.focus }
  chosen.dishIdWithPhoto = framed.id

  // 7 — the section's own prose, its dishes reordered, and the sections reordered.
  section.intro = EDIT.sectionIntro
  section.dishes = [...section.dishes!].reverse()
  chosen.dishOrder = section.dishes.map((entry) => entry.id)

  menu.categories = [...menu.categories.slice(1), menu.categories[0]!]
  chosen.sectionOrder = menu.categories.map((category) => category.id)

  write('content/site/menu.json', menu)

  // ---- the tapas board: the price, a heading, an item -------------------------------
  const tapas = read('content/site/tapas.json') as {
    price?: string | null
    groups: { id: string; heading: string; items?: string[] }[]
  }
  tapas.price = EDIT.tapasPrice
  tapas.groups[0]!.heading = EDIT.tapasHeading
  tapas.groups[0]!.items = [...(tapas.groups[0]!.items ?? []), EDIT.tapasItem]
  write('content/site/tapas.json', tapas)

  // ---- 4: the opening hours — a changed day and a published closure ----------------
  const hours = read('content/site/hours.json') as {
    schedule: Record<string, { closed?: boolean; from?: string | null; to?: string | null }>
    overrides?: unknown[]
  }
  hours.schedule.wed = { closed: false, from: EDIT.wednesdayFrom, to: EDIT.wednesdayTo }
  hours.overrides = [
    { date: '2026-12-24', kind: 'closed', opensAt: '', closesAt: '', status: 'published' },
  ]
  write('content/site/hours.json', hours)

  // ---- 8: the contact fields that are not readonly ---------------------------------
  const contact = read('content/site/contact.json') as Record<string, unknown>
  contact.primaryPhone = EDIT.primaryPhone
  contact.secondaryPhone = EDIT.secondaryPhone
  contact.email = EDIT.email
  contact.facebookUrl = EDIT.facebookUrl
  write('content/site/contact.json', contact)
})

type LoadedSite = {
  announcement: unknown
  award: unknown
  about: unknown
  news: unknown
  contact: {
    primaryPhone: string | null
    secondaryPhone: string | null
    email: string | null
    facebookUrl: string | null
    venueName: string | null
    addressLine1: string | null
    postalCode: string | null
    city: string | null
  }
  hours: {
    schedule: WeeklySchedule
    overrides: { date: string; kind: string; status: string }[]
  }
  menu: {
    allergenNote: string | null
    categories: {
      id: string
      slug: string
      intro: string | null
      dishes: DishView[]
    }[]
    tapas: TapasBoard
  }
}

/** What a tree loads to, asked once per tree: the probe is a separate process. */
const probed = new Map<string, string>()
function loadedOnce(root: string): string {
  const known = probed.get(root)
  if (known !== undefined) return known
  const json = loadedContent(root)
  probed.set(root, json)
  return json
}

const site = () => JSON.parse(loadedOnce(EDITED)) as LoadedSite
const tracked = () => JSON.parse(loadedOnce(process.cwd())) as LoadedSite
const dishesOf = (loaded: LoadedSite) => loaded.menu.categories.flatMap((category) => category.dishes)
const dishById = (loaded: LoadedSite, id: string) =>
  dishesOf(loaded).find((entry) => entry.id === id)!

describe('the save itself', () => {
  it('is content check:content accepts', () => {
    expect(checkContent(EDITED)).toEqual({ status: 0, stderr: '' })
  })

  it('changed something — otherwise the rest of this file proves nothing', () => {
    expect(loadedOnce(EDITED)).not.toBe(loadedOnce(process.cwd()))
    expect(chosen.dishId).not.toBe('')
    expect(chosen.featured).toHaveLength(1)
  })
})

describe('a price, a name and a description the restaurant changed', () => {
  it('reaches the menu as whole øre, and as the words that were written', () => {
    const dish = dishById(site(), chosen.dishId)

    expect(dish.name).toBe(EDIT.dishName)
    expect(dish.description).toBe(EDIT.dishDescription)
    expect(dish.priceOre).toBe(EDIT.priceOre)
  })

  it('is what the card prints — the new name, the new price, and no old one', () => {
    const dish = dishById(site(), chosen.dishId)
    const before = dishById(tracked(), chosen.dishId)
    const html = renderToStaticMarkup(<DishCard dish={dish} />)

    expect(html).toContain(EDIT.dishName)
    expect(html).toContain(EDIT.dishDescription)
    expect(html).toContain(formatPrice(EDIT.priceOre))
    expect(html).not.toContain(before.name)
    if (before.priceOre !== null && before.priceOre !== EDIT.priceOre) {
      expect(html).not.toContain(formatPrice(before.priceOre))
    }
  })
})

describe('the dishes the restaurant chose for the Forside', () => {
  it('are exactly the ones now marked, and none of the ones that were', () => {
    const marked = dishesOf(site())
      .filter((dish) => dish.featured)
      .map((dish) => dish.id)

    expect(marked).toEqual(chosen.featured)

    // And the mark really moved: the dishes that used to carry it no longer do.
    const before = dishesOf(tracked())
      .filter((dish) => dish.featured)
      .map((dish) => dish.id)
    expect(before).not.toEqual(marked)
    for (const id of before.filter((id) => !chosen.featured.includes(id))) {
      expect(dishById(site(), id).featured, id).toBe(false)
    }
  })
})

describe('a section the restaurant reworded and rearranged', () => {
  it('keeps its new order, its new prose, and its dishes in the order they were left', () => {
    const loaded = site()

    expect(loaded.menu.categories.map((category) => category.id)).toEqual(chosen.sectionOrder)
    expect(loaded.menu.categories.map((category) => category.id)).not.toEqual(
      tracked().menu.categories.map((category) => category.id),
    )

    const section = loaded.menu.categories.find((category) => category.id === chosen.sectionId)!
    expect(section.intro).toBe(EDIT.sectionIntro)
    expect(section.dishes.map((dish) => dish.id)).toEqual(chosen.dishOrder)
    // The section is still addressable: its anchor follows its id, not its position.
    expect(section.slug).toBe(chosen.sectionId)
  })
})

describe('a photograph the restaurant redescribed and recropped', () => {
  it('carries the new description and the new crop, and still a rendered derivative', () => {
    const image = dishById(site(), chosen.dishIdWithPhoto).image!

    expect(image.alt).toBe(EDIT.alt)
    expect(image.focus).toBe(EDIT.focus)
    expect(image.src).toMatch(/^\/media\/[a-z0-9-]+\/\d+\.webp$/)
  })

  it('is what the card prints — the description as alt, the crop as its class', () => {
    const html = renderToStaticMarkup(
      <DishCard dish={dishById(site(), chosen.dishIdWithPhoto)} />,
    )

    expect(html).toContain(`alt="${EDIT.alt}"`)
    expect(html).toContain('object-[50%_20%]')
    expect(html).not.toContain('/photos/')
  })
})

describe('the tapas board the restaurant repriced and added to', () => {
  it('carries the new price, the new heading and the new item', () => {
    const board = site().menu.tapas

    expect(board.priceOre).toBe(EDIT.tapasPriceOre)
    expect(board.groups[0]?.heading).toBe(EDIT.tapasHeading)
    expect(board.groups[0]?.items).toContain(EDIT.tapasItem)
    // The structural fields are readonly in Pages CMS and untouched by an edit to them.
    expect(board.groups.map((group) => [group.id, group.mode, group.choose])).toEqual(
      tracked().menu.tapas.groups.map((group) => [group.id, group.mode, group.choose]),
    )
  })

  it('is what the table prints', () => {
    const html = renderToStaticMarkup(<TapasTable board={site().menu.tapas} />)

    expect(html).toContain(EDIT.tapasHeading)
    expect(html).toContain(EDIT.tapasItem)
    expect(html).not.toContain(tracked().menu.tapas.groups[0]!.heading)
  })
})

describe('the opening hours the restaurant changed', () => {
  it('reads the new Wednesday and the published closure', () => {
    const { schedule, overrides } = site().hours

    expect(schedule.wed).toEqual({ from: EDIT.wednesdayFrom, to: EDIT.wednesdayTo })
    expect(overrides).toEqual([
      {
        date: '2026-12-24',
        kind: 'closed',
        // The two emptied time controls a Pages CMS form writes as `""`.
        opensAt: null,
        closesAt: null,
        status: 'published',
      },
    ])
  })

  it('is what the hours table prints, on the row for that day', () => {
    const rows = formatDailyHours(site().hours.schedule)
    const wednesday = rows.find((row) => row.day.toLowerCase().startsWith('onsdag'))!

    expect(wednesday.hours).toContain(EDIT.wednesdayFrom)
    expect(wednesday.hours).toContain(EDIT.wednesdayTo)
    expect(rows).toHaveLength(7)
  })
})

describe('the contact details the restaurant changed', () => {
  it('carries the new numbers, address and social link — and the locked address unchanged', () => {
    const { contact } = site()

    expect(contact.primaryPhone).toBe(EDIT.primaryPhone)
    expect(contact.secondaryPhone).toBe(EDIT.secondaryPhone)
    expect(contact.email).toBe(EDIT.email)
    expect(contact.facebookUrl).toBe(EDIT.facebookUrl)

    // `venueName`, `addressLine1`, `postalCode` and `city` are `readonly: true`.
    const before = tracked().contact
    expect({
      venueName: contact.venueName,
      addressLine1: contact.addressLine1,
      postalCode: contact.postalCode,
      city: contact.city,
    }).toEqual({
      venueName: before.venueName,
      addressLine1: before.addressLine1,
      postalCode: before.postalCode,
      city: before.city,
    })
  })

  it('is what the telephone block prints, dialling the new number', () => {
    const { contact } = site()
    const html = renderToStaticMarkup(
      <PhoneNumbers
        primaryPhone={contact.primaryPhone!}
        secondaryPhone={contact.secondaryPhone}
        size="prominent"
      />,
    )

    expect(html).toContain(EDIT.primaryPhone)
    expect(html).toContain('href="tel:+4522114477"')
    // The second line is "eller" followed by the number; on Find os the number itself
    // is set in bold, so the two are asserted separately rather than as one string.
    expect(html).toContain('eller ')
    expect(html).toContain(EDIT.secondaryPhone)
    expect(html).not.toContain(tracked().contact.primaryPhone!)
  })
})

/**
 * And the documents nobody opened are the documents nobody opened.
 *
 * The strongest form of "an edit is an edit": a save that touches the menu, the board,
 * the hours and the contact card changes those four and leaves the rest of the site
 * exactly as it was — no announcement conjured into being, no article, no award
 * reworded, no Om os paragraph defaulted into existence by a neighbouring key.
 */
describe('everything the save did not touch', () => {
  it.each(['announcement', 'award', 'about', 'news'] as const)('is unchanged: %s', (key) => {
    expect(site()[key]).toEqual(tracked()[key])
  })

  it('leaves the allergen note and the other sections’ dishes alone', () => {
    const loaded = site()
    const before = tracked()

    expect(loaded.menu.allergenNote).toBe(before.menu.allergenNote)

    for (const category of loaded.menu.categories) {
      if (category.id === chosen.sectionId) continue
      const was = before.menu.categories.find((entry) => entry.id === category.id)!
      expect(
        category.dishes.map((dish) => ({ ...dish, featured: false })),
        category.id,
      ).toEqual(was.dishes.map((dish) => ({ ...dish, featured: false })))
    }
  })
})

/**
 * The other direction — nothing above loosened a check.
 *
 * Each of these is a thing Pages CMS's own form makes hard and `check:content` refuses
 * outright, because the renderer really cannot survive it: an anchor that is not a slug,
 * an id used twice, a price that is not a price, a crop outside the vocabulary, a
 * photograph path that leaves `public/photos/`, a second section drawing the same
 * document, a clock reading that is not one, and the two required contact fields.
 */
describe('an edit that is not valid is still refused', () => {
  const refused = (name: string, edit: Parameters<typeof contentFixture>[0]) => {
    it(`refuses ${name}`, () => {
      const result = checkContent(contentFixture(edit))
      expect(result.status, result.stderr).not.toBe(0)
    })
  }

  const withMenu = (change: (menu: { categories: StoredCategory[] }) => void) =>
    ({ read, write }: Parameters<Parameters<typeof contentFixture>[0]>[0]) => {
      const menu = read('content/site/menu.json') as { categories: StoredCategory[] }
      change(menu)
      write('content/site/menu.json', menu)
    }

  const anyDish = (menu: { categories: StoredCategory[] }) =>
    menu.categories.flatMap((category) => category.dishes ?? [])[0]!

  refused(
    'a price that is not a price',
    withMenu((menu) => {
      anyDish(menu).price = '89 kroner'
    }),
  )

  refused(
    'a dish id used twice',
    withMenu((menu) => {
      const dishes = menu.categories.flatMap((category) => category.dishes ?? [])
      dishes[1]!.id = dishes[0]!.id
    }),
  )

  refused(
    'a section id that is not a slug — an anchor has to be an address',
    withMenu((menu) => {
      menu.categories[0]!.id = 'Nyt Afsnit'
    }),
  )

  refused(
    'a dish with no name',
    withMenu((menu) => {
      anyDish(menu).name = ''
    }),
  )

  refused(
    'a crop outside the closed vocabulary',
    withMenu((menu) => {
      anyDish(menu).photo = { file: A_PHOTO, alt: '', focus: 'top left' }
    }),
  )

  refused(
    'a photograph that would leave public/photos/',
    withMenu((menu) => {
      anyDish(menu).photo = { file: '../../etc/passwd.png', alt: '', focus: 'center' }
    }),
  )

  refused(
    'a second section drawing the tapas board',
    withMenu((menu) => {
      const board = menu.categories.find((category) => category.kind === 'tapas')
      if (board === undefined) throw new Error('the tracked menu draws no tapas board')
      menu.categories.push({ id: 'tapas-igen', name: 'Tapas igen', kind: 'tapas' })
    }),
  )

  refused('a clock reading that is not one', ({ read, write }) => {
    const hours = read('content/site/hours.json') as {
      schedule: Record<string, unknown>
    }
    hours.schedule.wed = { closed: false, from: '16.30', to: '21:15' }
    write('content/site/hours.json', hours)
  })

  refused('an e-mail address that is not one', ({ read, write }) => {
    const contact = read('content/site/contact.json') as Record<string, unknown>
    contact.email = 'skriv til os'
    write('content/site/contact.json', contact)
  })

  refused('a telephone field left empty, which is required', ({ read, write }) => {
    const contact = read('content/site/contact.json') as Record<string, unknown>
    contact.primaryPhone = ''
    write('content/site/contact.json', contact)
  })

  refused('a takeaway button with nothing written on it', ({ read, write }) => {
    const page = read('content/site/pages/takeaway.json') as Record<string, unknown>
    page.ctaLabel = ''
    write('content/site/pages/takeaway.json', page)
  })
})
