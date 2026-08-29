import 'server-only'

import { cache } from 'react'

import type { IsoDate } from '@/lib/time/calendar'

import { field, numberField, objectArrayField, stringArrayField, stringField } from './document'
import { assertNoQueryError, publicDatabase } from './source'
import type {
  Dish,
  MenuCategory,
  MenuCategoryKind,
  MonthlyBurger,
  TapasDetails,
  TapasGroup,
  WeeklySpecial,
} from './types'

/**
 * The menu — technical plan §4, §7d.
 *
 * Four queries, never one per category: the categories and the dishes are read in
 * parallel and joined in memory, which is what keeps a nine-section menu at a fixed
 * cost rather than N+1. The two singletons — Ugens ret and Månedens burger — are read
 * alongside them.
 *
 * The rows a public page may see are decided by RLS, not by this file: invisible
 * categories, soft-deleted dishes, dishes that have never been published and a Månedens
 * burger outside its date window are all unreadable to `anon`. Two of those rules are
 * not even restatable here — `deleted_at` and `is_new_draft` are deliberately outside
 * the `anon` column grants (§8), so a public query cannot name them, let alone forget
 * them. `visible` is granted and is restated, because a reader of this file should be
 * able to see at least where the boundary is.
 *
 * No decision about *display* is made here. Whether an item is currently sold out, and
 * whether the monthly burger falls inside its window today, are resolved by the pure
 * functions in `lib/menu` from the same hours engine the rest of the site uses.
 */

type CategoryRow = {
  id: string
  slug: string
  name: string
  intro: string | null
  note: string | null
  kind: MenuCategoryKind
  sort_order: number
}

type DishRow = {
  id: string
  category_id: string
  name: string
  description: string | null
  secondary_note: string | null
  price_ore: number | null
  labels: string[] | null
  details: unknown
  sold_out_on: string | null
  sort_order: number
}

type WeeklySpecialRow = {
  iso_year: number | null
  iso_week: number | null
  days: string[] | null
  name: string | null
  description: string | null
  price_small_ore: number | null
  price_large_ore: number | null
  sold_out_on: string | null
  sat_enabled: boolean
  sat_name: string | null
  sat_description: string | null
  sat_price_ore: number | null
  sat_deadline: string | null
  sat_sold_out_on: string | null
}

type MonthlyBurgerRow = {
  name: string | null
  description: string | null
  price_ore: number | null
  starts_on: string | null
  ends_on: string | null
  sold_out_on: string | null
  show_on_homepage: boolean
}

/** Everything the menu page and the Forside's featured burgers need, in one read. */
export type MenuContent = {
  categories: MenuCategory[]
  weeklySpecial: WeeklySpecial | null
  monthlyBurger: MonthlyBurger | null
}

const TAPAS_GROUP_IDS = ['base', 'choose7', 'dressing'] as const

/**
 * Read `dishes.details` as the Tapas document, or `null`.
 *
 * The group ids and their order are fixed by the schema (§4, decision 3); a document
 * with any other shape is simply not a Tapas document, and the entry then renders as an
 * ordinary dish rather than throwing on a visitor.
 */
function readTapasDetails(details: unknown): TapasDetails | null {
  if (field(details, 'kind') !== 'tapas') return null

  const groups: TapasGroup[] = []

  for (const raw of objectArrayField(details, 'groups')) {
    const id = stringField(raw, 'id')
    if (id === null || !TAPAS_GROUP_IDS.includes(id as TapasGroup['id'])) continue

    const mode = stringField(raw, 'mode') === 'choose' ? 'choose' : 'fixed'

    groups.push({
      id: id as TapasGroup['id'],
      heading: stringField(raw, 'heading') ?? '',
      mode,
      choose: mode === 'choose' ? numberField(raw, 'choose') : null,
      items: stringArrayField(raw, 'items'),
    })
  }

  return groups.length > 0 ? { kind: 'tapas', groups } : null
}

function toDish(row: DishRow): Dish {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    secondaryNote: row.secondary_note,
    priceOre: row.price_ore,
    labels: row.labels ?? [],
    tapas: readTapasDetails(row.details),
    soldOutOn: row.sold_out_on as IsoDate | null,
  }
}

function groupDishesByCategory(rows: DishRow[]): Map<string, Dish[]> {
  const byCategory = new Map<string, Dish[]>()

  for (const row of rows) {
    const dishes = byCategory.get(row.category_id)
    if (dishes === undefined) {
      byCategory.set(row.category_id, [toDish(row)])
    } else {
      dishes.push(toDish(row))
    }
  }

  return byCategory
}

function toWeeklySpecial(row: WeeklySpecialRow | null | undefined): WeeklySpecial | null {
  if (!row) return null

  return {
    isoYear: row.iso_year,
    isoWeek: row.iso_week,
    days: row.days ?? [],
    name: row.name,
    description: row.description,
    priceSmallOre: row.price_small_ore,
    priceLargeOre: row.price_large_ore,
    soldOutOn: row.sold_out_on as IsoDate | null,
    saturday: {
      enabled: row.sat_enabled,
      name: row.sat_name,
      description: row.sat_description,
      priceOre: row.sat_price_ore,
      deadline: row.sat_deadline,
      soldOutOn: row.sat_sold_out_on as IsoDate | null,
    },
  }
}

function toMonthlyBurger(row: MonthlyBurgerRow | null | undefined): MonthlyBurger | null {
  if (!row || row.name === null) return null

  return {
    name: row.name,
    description: row.description,
    priceOre: row.price_ore,
    startsOn: row.starts_on as IsoDate | null,
    endsOn: row.ends_on as IsoDate | null,
    soldOutOn: row.sold_out_on as IsoDate | null,
    showOnHomepage: row.show_on_homepage,
  }
}

/** Deduplicated per request: the Forside's featured burgers come from the same read. */
export const readMenuContent = cache(async (): Promise<MenuContent> => {
  const database = publicDatabase()

  const [categoriesResult, dishesResult, weeklyResult, monthlyResult] = await Promise.all([
    database
      .from('menu_categories')
      .select('id, slug, name, intro, note, kind, sort_order')
      .eq('visible', true)
      .order('sort_order', { ascending: true })
      .returns<CategoryRow[]>(),
    // No `deleted_at` / `is_new_draft` filter: the columns are not granted to `anon`,
    // and `dishes_select_public` already excludes both.
    database
      .from('dishes')
      .select(
        'id, category_id, name, description, secondary_note, price_ore, labels, details, sold_out_on, sort_order',
      )
      .order('sort_order', { ascending: true })
      .returns<DishRow[]>(),
    database
      .from('weekly_special')
      .select(
        'iso_year, iso_week, days, name, description, price_small_ore, price_large_ore, sold_out_on, sat_enabled, sat_name, sat_description, sat_price_ore, sat_deadline, sat_sold_out_on',
      )
      .maybeSingle<WeeklySpecialRow>(),
    database
      .from('monthly_burger')
      .select('name, description, price_ore, starts_on, ends_on, sold_out_on, show_on_homepage')
      .maybeSingle<MonthlyBurgerRow>(),
  ])

  assertNoQueryError('the menu sections', categoriesResult.error)
  assertNoQueryError('the dishes', dishesResult.error)
  assertNoQueryError('Ugens ret', weeklyResult.error)
  assertNoQueryError('Månedens burger', monthlyResult.error)

  const dishesByCategory = groupDishesByCategory(dishesResult.data ?? [])

  return {
    categories: (categoriesResult.data ?? []).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      intro: row.intro,
      note: row.note,
      kind: row.kind,
      dishes: dishesByCategory.get(row.id) ?? [],
    })),
    weeklySpecial: toWeeklySpecial(weeklyResult.data),
    monthlyBurger: toMonthlyBurger(monthlyResult.data),
  }
})
