import type {
  Dish,
  MenuCategory,
  MenuCategoryKind,
  MenuContent,
  MonthlyBurger,
  TapasBoard,
  TapasGroup,
  WeeklySpecial,
} from '@/lib/content/types'
import { MONTHLY_BURGER_MENU_SECTION_SLUG } from '@/lib/menu/monthly'
import type { IsoDate } from '@/lib/time/calendar'

import {
  validateMenu,
  validateMonthlyBurger,
  validateTapas,
  validateWeeklySpecial,
} from '../validate/menu'
import { assertValid } from '../validate/problems'

import { stored } from './cleared'
import { resolvePhoto, type PhotoField } from './photo'
import { oreFromKroner } from './price'
import { contentPath, once, readContentJson } from './source'
import { keepPriceTogether, prose } from './text'

/**
 * The confirmed menu — `content/site/menu.json`, with Ugens ret in
 * `weekly-special.json` and Månedens burger in `monthly-burger.json` (design 1h, 1m;
 * frame 1ab).
 *
 * **One document for the menu.** The nine sections, in the order of the category bar,
 * each holding its dishes in their confirmed order — names, prices, descriptions, the
 * small grey line beneath a name, the labels the approved frames print, and the
 * `featured` flag that puts a dish on the Forside. A dish's `id` is its stable identity;
 * a section's `id` is also its slug and its anchor.
 *
 * **A section whose body is another document says so with its `kind`.** `weekly_special`
 * is Ugens ret and `tapas` is the tapas board; both carry no dishes of their own, and
 * the section is where the restaurant decides *whether* and *where* on the card that
 * body appears. Nothing here matches a section by name.
 *
 * **Three small documents beside the menu.** Ugens ret and Månedens burger each carry
 * an `active` flag: inactive is the state the confirmed content leaves the site in —
 * the approved "Ingen lørdagsmenu denne uge" card and the approved empty Månedens
 * burger card — and nothing is invented to fill them. The tapas board
 * (`tapas.json`) has no such flag, because a board that is not shown is a section the
 * restaurant removed, not a document in an empty state.
 *
 * **Prices are stored in kroner and used in øre.** The string on disk is what a person
 * writes on a menu ("89"); `./price.ts` turns it into the whole number of øre the
 * domain model has always carried, with no floating-point arithmetic anywhere.
 *
 * Nothing here decides anything the site renders. Whether a dish is sold out right now
 * and whether Månedens burger falls inside its window are read-time derivations, and
 * they stay in `lib/menu/view.ts` where both surfaces already read them.
 */

type TapasGroupFile = {
  id: TapasGroup['id']
  heading: string
  mode: TapasGroup['mode']
  choose?: number | '' | null
  items: string[]
}

type TapasFile = {
  price?: string | null
  secondaryNote?: string | null
  groups: TapasGroupFile[]
}

type DishFile = {
  id: string
  name: string
  price?: string | null
  description?: string | null
  secondaryNote?: string | null
  labels?: string[]
  soldOutOn?: IsoDate | null
  /** "Vis på forsiden" — absent and `false` both mean the Forside does not show it. */
  featured?: boolean
  photo?: PhotoField | null
}

type CategoryFile = {
  id: string
  name: string
  kind?: MenuCategoryKind
  intro?: string | null
  note?: string | null
  /** Absent is the same as `[]` — Pages CMS leaves an empty list out of the file. */
  dishes?: DishFile[]
}

type MenuFile = {
  allergenNote?: string | null
  categories: CategoryFile[]
}

type WeeklySpecialFile = {
  active: boolean
  isoYear?: number | '' | null
  isoWeek?: number | '' | null
  days?: string[]
  name?: string | null
  description?: string | null
  priceSmall?: string | null
  priceLarge?: string | null
  soldOutOn?: IsoDate | null
  photo?: PhotoField | null
  saturday?: {
    enabled: boolean
    name?: string | null
    description?: string | null
    price?: string | null
    deadline?: string | null
    soldOutOn?: IsoDate | null
  }
}

type MonthlyBurgerFile = {
  active: boolean
  name?: string | null
  description?: string | null
  price?: string | null
  startsOn?: IsoDate | null
  endsOn?: IsoDate | null
  soldOutOn?: IsoDate | null
  showOnHomepage?: boolean
  photo?: PhotoField | null
}

/**
 * Ugens ret and the Lørdagsmenu when nothing is published.
 *
 * The empty state is a real value rather than `null` because that is what the menu
 * page has always been handed: the section renders the approved "Ingen lørdagsmenu
 * denne uge" card (1af) and no dish. An inactive week produces exactly this.
 */
const NO_WEEKLY_SPECIAL: WeeklySpecial = {
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
}

function dishFrom(file: DishFile, where: string): Dish {
  return {
    id: file.id,
    name: file.name,
    description: prose(file.description),
    secondaryNote: prose(file.secondaryNote),
    priceOre: oreFromKroner(file.price, where),
    labels: file.labels ?? [],
    soldOutOn: stored(file.soldOutOn),
    featured: file.featured === true,
    image: resolvePhoto(file.photo, where),
  }
}

/** Refuse an id that appears twice: it is a React key, and an anchor names a section. */
function assertUnique(kind: string, ids: readonly string[], where: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${where}: the ${kind} id "${id}" is used more than once.`)
    seen.add(id)
  }
}

/**
 * The Burgere intro is the one prose field rendered with a non-breaking space between
 * each number and "kr." — approved typography from before the content lived in JSON
 * (`./text.ts` states the rule and its limits). Every other section's intro is the text
 * as written.
 */
function sectionIntro(sectionId: string, intro: string | null): string | null {
  if (intro === null || sectionId !== MONTHLY_BURGER_MENU_SECTION_SLUG) return intro
  return keepPriceTogether(intro)
}

export function menuCategoriesFrom(file: MenuFile, where: string): MenuCategory[] {
  assertUnique('section', file.categories.map((category) => category.id), where)
  assertUnique(
    'dish',
    file.categories.flatMap((category) => (category.dishes ?? []).map((dish) => dish.id)),
    where,
  )

  return file.categories.map(
    (category): MenuCategory => ({
      id: category.id,
      slug: category.id,
      name: category.name,
      intro: sectionIntro(category.id, prose(category.intro)),
      note: prose(category.note),
      kind: category.kind ?? 'dishes',
      dishes: (category.dishes ?? []).map((dish) => dishFrom(dish, `${where}: dish "${dish.id}"`)),
    }),
  )
}

export function weeklySpecialFrom(file: WeeklySpecialFile, where: string): WeeklySpecial {
  if (!file.active) return NO_WEEKLY_SPECIAL

  const saturday = file.saturday ?? { enabled: false }

  return {
    isoYear: stored(file.isoYear),
    isoWeek: stored(file.isoWeek),
    days: file.days ?? [],
    name: file.name ?? null,
    description: prose(file.description),
    priceSmallOre: oreFromKroner(file.priceSmall, where),
    priceLargeOre: oreFromKroner(file.priceLarge, where),
    soldOutOn: stored(file.soldOutOn),
    image: resolvePhoto(file.photo, where),
    saturday: {
      enabled: saturday.enabled,
      name: saturday.name ?? null,
      description: prose(saturday.description),
      priceOre: oreFromKroner(saturday.price, `${where} (lørdagsmenu)`),
      deadline: saturday.deadline ?? null,
      soldOutOn: stored(saturday.soldOutOn),
    },
  }
}

/**
 * Månedens burger, or `null` — which draws the approved empty card on the menu and on
 * the Forside, the state the site has been in since launch.
 *
 * A burger without a name is not a burger: the domain type requires one, so an active
 * file that has none is refused here rather than rendered as an empty card.
 */
export function monthlyBurgerFrom(file: MonthlyBurgerFile, where: string): MonthlyBurger | null {
  if (!file.active) return null

  if (!file.name) {
    throw new Error(`${where} is active but has no name. Set "active": false instead.`)
  }

  return {
    name: file.name,
    description: prose(file.description),
    priceOre: oreFromKroner(file.price, where),
    startsOn: stored(file.startsOn),
    endsOn: stored(file.endsOn),
    soldOutOn: stored(file.soldOutOn),
    showOnHomepage: file.showOnHomepage ?? true,
    image: resolvePhoto(file.photo, where),
  }
}

/**
 * The tapas board — `content/site/tapas.json` (§4, decision 3).
 *
 * One price, the line about each extra person, and the three lists, read as one
 * document because that is how the restaurant edits it: a board is not an ordinary
 * dish that happens to have lists attached, and no ordinary dish carries any part of
 * it. `TapasTable` draws exactly these three values.
 *
 * The group ids, their count and the two list modes are the schema's, held to it by
 * `lib/content/validate/menu.ts` before this runs; what is editable is the headings,
 * the items and how many are chosen.
 */
export function tapasBoardFrom(file: TapasFile, where: string): TapasBoard {
  return {
    priceOre: oreFromKroner(file.price, where),
    secondaryNote: prose(file.secondaryNote),
    groups: file.groups.map(
      (group): TapasGroup => ({
        id: group.id,
        heading: group.heading,
        mode: group.mode,
        choose: stored(group.choose),
        items: group.items,
      }),
    ),
  }
}

/**
 * Everything the menu page and the Forside read about the menu.
 *
 * The four files are held to `lib/content/validate/` before a single value is read
 * out of them, so a malformed menu stops the build with every mistake named in Danish
 * rather than with the first `TypeError` a conversion happens to hit. The conversions
 * below keep their own refusals — they are the second lock on the same door, in the
 * idiom this codebase already uses for a photograph's path.
 */
export const loadMenu = once((): MenuContent => {
  const menu = readContentJson<MenuFile>('menu.json')
  assertValid(validateMenu(menu, contentPath('menu.json')))

  const weekly = readContentJson<WeeklySpecialFile>('weekly-special.json')
  assertValid(validateWeeklySpecial(weekly, contentPath('weekly-special.json')))

  const monthly = readContentJson<MonthlyBurgerFile>('monthly-burger.json')
  assertValid(validateMonthlyBurger(monthly, contentPath('monthly-burger.json')))

  const tapas = readContentJson<TapasFile>('tapas.json')
  assertValid(validateTapas(tapas, contentPath('tapas.json')))

  return {
    allergenNote: prose(menu.allergenNote),
    categories: menuCategoriesFrom(menu, contentPath('menu.json')),
    weeklySpecial: weeklySpecialFrom(weekly, contentPath('weekly-special.json')),
    monthlyBurger: monthlyBurgerFrom(monthly, contentPath('monthly-burger.json')),
    tapas: tapasBoardFrom(tapas, contentPath('tapas.json')),
  }
})
