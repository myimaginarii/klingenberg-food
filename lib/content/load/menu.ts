import type {
  Dish,
  DishLabel,
  MenuCategory,
  MenuCategoryKind,
  MonthlyBurger,
  TapasDetails,
  WeeklySpecial,
} from '@/lib/content/types'
import type { IsoDate } from '@/lib/time/calendar'

import { resolvePhoto } from './photo'
import { oreFromKroner } from './price'
import { listContentJson, readContentJson } from './source'

/**
 * The menu, read from the tracked JSON under `content/site/menu/`.
 *
 * **Two files, two jobs.** `categories.json` is the menu's *skeleton*: the nine
 * sections, their order, their wording and — as a list of dish ids — which dishes each
 * one holds and in which order. One JSON file per dish under
 * `dishes/<section>/<id>.json` holds what is actually editable about a dish: its name,
 * its price, its description, its small grey line, its labels and whether it is sold
 * out today.
 *
 * **The file name is the dish id**, so a stable id cannot drift from the thing it
 * identifies and no file has to repeat it. The same is true of a section: its `slug` is
 * its `id`, exactly as the TypeScript this replaced constructed it.
 *
 * **The set of dishes is fixed by `categories.json`.** Every id it lists must have a
 * file and every file must be listed — a mismatch fails the build, by name. That is
 * what makes "a dish may be edited, but not created, deleted or renamed" a property of
 * the repository rather than a convention somebody has to remember.
 *
 * **Prices are stored in kroner and used in øre.** The string on disk is what a person
 * writes on a menu ("89"); `./price.ts` turns it into the whole number of øre the
 * domain model has always carried, with no floating-point arithmetic anywhere.
 *
 * Nothing here decides anything the site renders. Whether a dish is sold out right now
 * and whether Månedens burger falls inside its window are read-time derivations, and
 * they stay in `lib/menu/view.ts` where both surfaces already read them.
 */

type CategoryFile = {
  categories: {
    slug: string
    name: string
    kind: MenuCategoryKind
    intro: string | null
    note: string | null
    dishes: string[]
  }[]
}

type DishFile = {
  name: string
  price: string | null
  description: string | null
  secondaryNote: string | null
  labels: DishLabel[]
  soldOutOn: IsoDate | null
  photo: string | null
  /** Present only for the Tapas board — three lists in one document (§4, decision 3). */
  tapas?: TapasDetails
}

type WeeklySpecialFile = {
  active: boolean
  isoYear: number | null
  isoWeek: number | null
  days: string[]
  name: string | null
  description: string | null
  priceSmall: string | null
  priceLarge: string | null
  soldOutOn: IsoDate | null
  photo: string | null
  saturday: {
    enabled: boolean
    name: string | null
    description: string | null
    price: string | null
    deadline: string | null
    soldOutOn: IsoDate | null
  }
}

type MonthlyBurgerFile = {
  active: boolean
  name: string | null
  description: string | null
  price: string | null
  startsOn: IsoDate | null
  endsOn: IsoDate | null
  soldOutOn: IsoDate | null
  showOnHomepage: boolean
  photo: string | null
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

function readDish(categorySlug: string, id: string): Dish {
  const where = `content/site/menu/dishes/${categorySlug}/${id}.json`
  const file = readContentJson<DishFile>('menu', 'dishes', categorySlug, `${id}.json`)

  return {
    id,
    name: file.name,
    description: file.description,
    secondaryNote: file.secondaryNote,
    priceOre: oreFromKroner(file.price, where),
    labels: file.labels,
    tapas: file.tapas ?? null,
    soldOutOn: file.soldOutOn,
    image: resolvePhoto(file.photo, where),
  }
}

/**
 * Refuse a section whose folder and whose dish list disagree.
 *
 * Both directions matter, for different reasons: a listed dish with no file would be a
 * hole in the menu, and a file nobody listed would be a dish that silently exists
 * without ever being rendered.
 */
function assertDishFilesMatch(categorySlug: string, listed: readonly string[]): void {
  const onDisk = new Set(listContentJson('menu', 'dishes', categorySlug))
  const missing = listed.filter((id) => !onDisk.has(id))
  const unlisted = [...onDisk].filter((id) => !listed.includes(id))

  if (missing.length === 0 && unlisted.length === 0) return

  throw new Error(
    `content/site/menu: section "${categorySlug}" does not match its dish files.` +
      (missing.length === 0 ? '' : ` Listed with no file: ${missing.join(', ')}.`) +
      (unlisted.length === 0 ? '' : ` File not listed in categories.json: ${unlisted.join(', ')}.`),
  )
}

export function loadMenuCategories(): MenuCategory[] {
  const { categories } = readContentJson<CategoryFile>('menu', 'categories.json')
  const seen = new Set<string>()

  return categories.map((category) => {
    assertDishFilesMatch(category.slug, category.dishes)

    for (const id of category.dishes) {
      if (seen.has(id)) {
        throw new Error(`content/site/menu: the dish id "${id}" is used more than once.`)
      }
      seen.add(id)
    }

    return {
      id: category.slug,
      slug: category.slug,
      name: category.name,
      intro: category.intro,
      note: category.note,
      kind: category.kind,
      dishes: category.dishes.map((id) => readDish(category.slug, id)),
    }
  })
}

export function loadWeeklySpecial(): WeeklySpecial {
  const file = readContentJson<WeeklySpecialFile>('weekly-special.json')
  if (!file.active) return NO_WEEKLY_SPECIAL

  const where = 'content/site/weekly-special.json'

  return {
    isoYear: file.isoYear,
    isoWeek: file.isoWeek,
    days: file.days,
    name: file.name,
    description: file.description,
    priceSmallOre: oreFromKroner(file.priceSmall, where),
    priceLargeOre: oreFromKroner(file.priceLarge, where),
    soldOutOn: file.soldOutOn,
    image: resolvePhoto(file.photo, where),
    saturday: {
      enabled: file.saturday.enabled,
      name: file.saturday.name,
      description: file.saturday.description,
      priceOre: oreFromKroner(file.saturday.price, `${where} (lørdagsmenu)`),
      deadline: file.saturday.deadline,
      soldOutOn: file.saturday.soldOutOn,
    },
  }
}

/**
 * Månedens burger, or `null` — which hides the card on the menu and the whole section
 * on the Forside, the state the site has been in since launch.
 *
 * A burger without a name is not a burger: the domain type requires one, so an active
 * file that has none is refused here rather than rendered as an empty card.
 */
export function loadMonthlyBurger(): MonthlyBurger | null {
  const file = readContentJson<MonthlyBurgerFile>('monthly-burger.json')
  if (!file.active) return null

  const where = 'content/site/monthly-burger.json'
  if (file.name === null) {
    throw new TypeError(`${where} is active but has no name. Set "active": false instead.`)
  }

  return {
    name: file.name,
    description: file.description,
    priceOre: oreFromKroner(file.price, where),
    startsOn: file.startsOn,
    endsOn: file.endsOn,
    soldOutOn: file.soldOutOn,
    showOnHomepage: file.showOnHomepage,
    image: resolvePhoto(file.photo, where),
  }
}

/** Everything the menu page and the Forside read about the menu. */
export function loadMenu(): {
  categories: MenuCategory[]
  weeklySpecial: WeeklySpecial
  monthlyBurger: MonthlyBurger | null
} {
  return {
    categories: loadMenuCategories(),
    weeklySpecial: loadWeeklySpecial(),
    monthlyBurger: loadMonthlyBurger(),
  }
}
