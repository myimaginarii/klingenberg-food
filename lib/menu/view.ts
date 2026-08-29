import type { Dish, MenuCategory, MonthlyBurger, WeeklySpecial } from '@/lib/content/types'
import { formatWeekdayName } from '@/lib/hours/format'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { WEEKDAY_KEYS, type WeekdayKey } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

import { resolveSoldOut } from './availability'

/**
 * The menu as the public page renders it — technical plan §7b, §7d.
 *
 * Pure. It takes published content, the opening hours and an instant, and answers the
 * two questions the database deliberately does not store: *is this item sold out right
 * now*, and *is Månedens burger inside its window today*. Both are read-time
 * derivations (§4), and both are computed here rather than in a component so that the
 * public menu, and later the administration's helper text, cannot disagree.
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
 */
export function isMonthlyBurgerInWindow(burger: MonthlyBurger, now: Date): boolean {
  const today = copenhagenDateOf(now)

  if (burger.startsOn !== null && today < burger.startsOn) return false
  if (burger.endsOn !== null && today > burger.endsOn) return false

  return true
}

export function buildMenuView(
  content: { categories: MenuCategory[]; weeklySpecial: WeeklySpecial | null; monthlyBurger: MonthlyBurger | null },
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

  return { categories, weeklySpecial, monthlyBurger }
}

/**
 * The three burgers the Forside features, in the order the administration chose.
 *
 * A referenced dish that has since been deleted or unpublished simply drops out — the
 * design shows three cards, never a hole where one used to be (§7e, item 4).
 */
export function selectFeaturedDishes(
  categories: readonly MenuCategoryView[],
  featuredDishIds: readonly string[],
): DishView[] {
  const byId = new Map<string, DishView>()
  for (const category of categories) {
    for (const dish of category.dishes) byId.set(dish.id, dish)
  }

  return featuredDishIds
    .map((id) => byId.get(id))
    .filter((dish): dish is DishView => dish !== undefined)
}
