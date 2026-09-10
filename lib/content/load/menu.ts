import type {
  Dish,
  MenuCategory,
  MenuCategoryKind,
  MenuContent,
  MonthlyBurger,
  TapasGroup,
  WeeklySpecial,
} from '@/lib/content/types'
import { MONTHLY_BURGER_MENU_SECTION_SLUG } from '@/lib/menu/monthly'
import type { IsoDate } from '@/lib/time/calendar'

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
 * small grey line beneath a name, the labels the approved frames print, and the tapas
 * board's three lists. A dish's `id` is its stable identity (the Forside's featured
 * dishes name three of them); a section's `id` is also its slug and its anchor.
 *
 * **Two small documents for what changes every week and every month.** Ugens ret and
 * Månedens burger each carry an `active` flag: inactive is the state the confirmed
 * content leaves the site in — the approved "Ingen lørdagsmenu denne uge" card and
 * the approved empty Månedens burger card — and nothing is invented to fill them.
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
  choose?: number | null
  items: string[]
}

type DishFile = {
  id: string
  name: string
  price?: string | null
  description?: string | null
  secondaryNote?: string | null
  labels?: string[]
  soldOutOn?: IsoDate | null
  photo?: PhotoField | null
  /** Present only for the Tapas board — three lists in one document (§4, decision 3). */
  tapas?: { groups: TapasGroupFile[] } | null
}

type CategoryFile = {
  id: string
  name: string
  kind?: MenuCategoryKind
  intro?: string | null
  note?: string | null
  dishes: DishFile[]
}

type MenuFile = {
  allergenNote?: string | null
  categories: CategoryFile[]
}

type WeeklySpecialFile = {
  active: boolean
  isoYear?: number | null
  isoWeek?: number | null
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
    tapas:
      file.tapas === null || file.tapas === undefined
        ? null
        : {
            kind: 'tapas',
            groups: file.tapas.groups.map(
              (group): TapasGroup => ({
                id: group.id,
                heading: group.heading,
                mode: group.mode,
                choose: group.choose ?? null,
                items: group.items,
              }),
            ),
          },
    soldOutOn: file.soldOutOn ?? null,
    image: resolvePhoto(file.photo, where),
  }
}

/** Refuse an id that appears twice: the Forside names dishes by id, and an anchor names a section. */
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
    file.categories.flatMap((category) => category.dishes.map((dish) => dish.id)),
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
      dishes: category.dishes.map((dish) => dishFrom(dish, `${where}: dish "${dish.id}"`)),
    }),
  )
}

export function weeklySpecialFrom(file: WeeklySpecialFile, where: string): WeeklySpecial {
  if (!file.active) return NO_WEEKLY_SPECIAL

  const saturday = file.saturday ?? { enabled: false }

  return {
    isoYear: file.isoYear ?? null,
    isoWeek: file.isoWeek ?? null,
    days: file.days ?? [],
    name: file.name ?? null,
    description: prose(file.description),
    priceSmallOre: oreFromKroner(file.priceSmall, where),
    priceLargeOre: oreFromKroner(file.priceLarge, where),
    soldOutOn: file.soldOutOn ?? null,
    image: resolvePhoto(file.photo, where),
    saturday: {
      enabled: saturday.enabled,
      name: saturday.name ?? null,
      description: prose(saturday.description),
      priceOre: oreFromKroner(saturday.price, `${where} (lørdagsmenu)`),
      deadline: saturday.deadline ?? null,
      soldOutOn: saturday.soldOutOn ?? null,
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
    startsOn: file.startsOn ?? null,
    endsOn: file.endsOn ?? null,
    soldOutOn: file.soldOutOn ?? null,
    showOnHomepage: file.showOnHomepage ?? true,
    image: resolvePhoto(file.photo, where),
  }
}

/** Everything the menu page and the Forside read about the menu. */
export const loadMenu = once((): MenuContent => {
  const menu = readContentJson<MenuFile>('menu.json')

  return {
    allergenNote: prose(menu.allergenNote),
    categories: menuCategoriesFrom(menu, contentPath('menu.json')),
    weeklySpecial: weeklySpecialFrom(
      readContentJson<WeeklySpecialFile>('weekly-special.json'),
      contentPath('weekly-special.json'),
    ),
    monthlyBurger: monthlyBurgerFrom(
      readContentJson<MonthlyBurgerFile>('monthly-burger.json'),
      contentPath('monthly-burger.json'),
    ),
  }
})
