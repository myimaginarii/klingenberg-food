import type { Dish, MenuCategory, MonthlyBurger, TapasBoard, WeeklySpecial } from '@/lib/content/types'
import { formatWeekdayName } from '@/lib/hours/format'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { WEEKDAY_KEYS, type WeekdayKey } from '@/lib/time/calendar'

import { resolveSoldOut } from './availability'
import { isMonthlyWindowOpen, monthlyWindowPhase } from './monthly'

/**
 * The menu as the public page renders it — technical plan §7b, §7d.
 *
 * Pure. It takes published content, the opening hours and an instant, and answers the
 * two questions the database deliberately does not store: *is this item sold out right
 * now*, and *is Månedens burger inside its window today*. Both are read-time
 * derivations (§4), and both are computed here rather than in a component so that the
 * menu page and the Forside cannot disagree.
 *
 * The sold-out rule itself is not restated. It lives in `./availability.ts`, which
 * phase 2 built and tested against every row of the §7b table; this module only applies
 * it to each item that can carry a sold-out date.
 */

/** A dish plus the answer to "can I order this right now?". */
export type DishView = Dish & { soldOut: boolean }

export type MenuCategoryView = Omit<MenuCategory, 'dishes'> & {
  /** The `id` the category heading carries, and the fragment its chip links to. */
  anchorId: string
  dishes: DishView[]
}

export type WeeklySpecialView = Omit<WeeklySpecial, 'saturday'> & {
  soldOut: boolean
  /** "Onsdag · torsdag · fredag" — the days line the card shows (1h, 1af). */
  daysLabel: string | null
  saturday: WeeklySpecial['saturday'] & { soldOut: boolean }
}

export type MonthlyBurgerView = MonthlyBurger & { soldOut: boolean }

export type MenuView = {
  categories: MenuCategoryView[]
  weeklySpecial: WeeklySpecialView | null
  /** The published burger when today falls inside its window, otherwise `null`. */
  monthlyBurger: MonthlyBurgerView | null
  /**
   * The tapas board, carried through unchanged.
   *
   * Nothing about it is time-dependent — a board is not sold out and has no window —
   * so there is no `TapasBoardView`. It travels here so the menu page hands its
   * sections one value rather than reaching past the view for the section that draws it.
   */
  tapas: TapasBoard
}

type Hours = {
  schedule: WeeklySchedule
  overrides: readonly OpeningHoursOverride[]
}

/** The fragment id a category section and its navigation chip share. */
export function categoryAnchorId(slug: string): string {
  return `menu-${slug}`
}

function isSoldOut(soldOutOn: string | null, hours: Hours, now: Date): boolean {
  return resolveSoldOut(soldOutOn, hours.schedule, hours.overrides, now).soldOut
}

/**
 * "Onsdag · torsdag · fredag".
 *
 * Rendered from the stored weekday keys in schedule order rather than in the order they
 * happen to be stored, so a row edited out of sequence still reads correctly. Danish
 * capitalises only the first word of such a list.
 */
export function formatServingDays(days: readonly string[]): string | null {
  const ordered = WEEKDAY_KEYS.filter((weekday) => days.includes(weekday))
  if (ordered.length === 0) return null

  return ordered
    .map((weekday: WeekdayKey, index) => {
      const name = formatWeekdayName(weekday, 'long')
      return index === 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name
    })
    .join(' · ')
}

/**
 * Is a published Månedens burger shown today? Inclusive at both ends, in Copenhagen
 * local dates (§7d). An open end means "no boundary on that side".
 *
 * The comparison itself is `monthlyWindowPhase` in `lib/menu/monthly.ts` (§7d). One
 * rule, one place: a boundary date the menu page and the Forside disagreed about would
 * be the single most confusing bug this feature could have.
 */
export function isMonthlyBurgerInWindow(burger: MonthlyBurger, now: Date): boolean {
  return isMonthlyWindowOpen(monthlyWindowPhase(burger.startsOn, burger.endsOn, now))
}

export function buildMenuView(
  content: {
    categories: MenuCategory[]
    weeklySpecial: WeeklySpecial | null
    monthlyBurger: MonthlyBurger | null
    tapas: TapasBoard
  },
  hours: Hours,
  now: Date,
): MenuView {
  const categories = content.categories.map((category) => ({
    ...category,
    anchorId: categoryAnchorId(category.slug),
    dishes: category.dishes.map((dish) => ({
      ...dish,
      soldOut: isSoldOut(dish.soldOutOn, hours, now),
    })),
  }))

  const weekly = content.weeklySpecial
  const weeklySpecial: WeeklySpecialView | null =
    weekly === null
      ? null
      : {
          ...weekly,
          soldOut: isSoldOut(weekly.soldOutOn, hours, now),
          daysLabel: formatServingDays(weekly.days),
          saturday: {
            ...weekly.saturday,
            soldOut: isSoldOut(weekly.saturday.soldOutOn, hours, now),
          },
        }

  const burger = content.monthlyBurger
  const monthlyBurger: MonthlyBurgerView | null =
    burger !== null && isMonthlyBurgerInWindow(burger, now)
      ? { ...burger, soldOut: isSoldOut(burger.soldOutOn, hours, now) }
      : null

  return { categories, weeklySpecial, monthlyBurger, tapas: content.tapas }
}

/**
 * The dishes the Forside features — "Tre fra menuen" (1g).
 *
 * The answer is read off the menu itself: a dish carries `featured` ("Vis på
 * forsiden"), and the band shows every dish that does, in the order the menu is
 * written. Nothing points across documents, so a dish that is deleted or un-featured
 * simply stops appearing and cannot leave a card missing without saying why.
 *
 * **How many is the restaurant's choice.** Three is what the confirmed menu marks and
 * what the design was drawn around, but nothing here counts: none is an empty band,
 * four is four cards.
 *
 * These slots are the ordinary menu dishes and nothing else. Månedens burger has its
 * own Forside section and never takes one of them: publishing it does not push a
 * normal featured dish off the page.
 */
export function selectFeaturedDishes(categories: readonly MenuCategoryView[]): DishView[] {
  return categories.flatMap((category) => category.dishes.filter((dish) => dish.featured))
}

/**
 * Månedens burger as the Forside shows it — or `null`, which hides the whole section.
 *
 * The Forside has a dedicated Månedens burger section beside its featured dishes,
 * not instead of one of them, so this is a second, independent question and not a
 * variation on {@link selectFeaturedDishes}.
 *
 * Three conditions have to hold, and each is already owned by the layer that knows it,
 * so nothing is decided twice:
 *
 *  * **It has content.** `lib/content/menu.ts` returns `null` for an unfilled row — a
 *    burger without a name is not a burger.
 *  * **Today is inside its window.** {@link buildMenuView} has already applied
 *    `starts_on` / `ends_on` as a read-time Copenhagen date comparison (§7d).
 *  * **The content asked for it.** `showOnHomepage`, the only part of the question
 *    that is about the Forside rather than about the burger — which is the whole
 *    reason this function exists and the menu page does not call it.
 *
 * When it returns `null` the Forside renders nothing at all: a guest is never told
 * that a burger they have not heard of is missing.
 *
 * Sold out is deliberately *not* a condition. An active burger that ran out today stays
 * on the Forside carrying "Udsolgt i dag", exactly as it does on the menu (§7b).
 */
export function selectHomepageMonthlyBurger(
  monthlyBurger: MonthlyBurgerView | null,
): MonthlyBurgerView | null {
  if (monthlyBurger === null) return null

  return monthlyBurger.showOnHomepage ? monthlyBurger : null
}

/**
 * What the Forside's Månedens burger section draws — the burger, the empty card, or
 * nothing at all.
 *
 * Three answers, because the section has to be honest in three different situations:
 *
 *  * **`burger`** — an active burger the administration put on the Forside. The full
 *    promotional section, with its real name, photograph and price.
 *  * **`empty`** — no burger is inside its window today (unfilled, not yet started, or
 *    expired). The Forside draws the same dashed card the menu page draws
 *    (`MonthlyBurgerEmptyCard`): a guest is told there is no monthly burger right now,
 *    in the words the design already approved, and nothing is invented.
 *  * **`hidden`** — a burger *is* active but "Vis på forsiden" is off. Nothing renders:
 *    the empty card would say there is no burger while the menu shows one, and that
 *    flag means "keep it off the Forside", not "say there is none".
 *
 * The window and the flag are still {@link buildMenuView} and
 * {@link selectHomepageMonthlyBurger}'s decisions; this only names the third state.
 */
export type HomepageMonthlyBurgerSection =
  | { kind: 'burger'; burger: MonthlyBurgerView }
  | { kind: 'empty' }
  | { kind: 'hidden' }

export function selectHomepageMonthlyBurgerSection(
  monthlyBurger: MonthlyBurgerView | null,
): HomepageMonthlyBurgerSection {
  if (monthlyBurger === null) return { kind: 'empty' }

  const burger = selectHomepageMonthlyBurger(monthlyBurger)
  return burger === null ? { kind: 'hidden' } : { kind: 'burger', burger }
}
