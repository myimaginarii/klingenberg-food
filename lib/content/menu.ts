import 'server-only'

import { cache } from 'react'

import { CACHE_TAGS } from '@/lib/cache/tags'
import { overlayDraft } from '@/lib/drafts/overlay'
import { readTapasDocument } from '@/lib/menu/tapas'
import { dishDraft, menuCategoryDraft } from '@/lib/schemas/menu'
import { monthlyBurgerDraft, weeklySpecialDraft } from '@/lib/schemas/specials'
import type { IsoDate } from '@/lib/time/calendar'

import { assertNoQueryError, columns, definePublicRead, type ContentAccess } from './source'
import type {
  Dish,
  MenuCategory,
  MenuCategoryKind,
  MonthlyBurger,
  WeeklySpecial,
} from './types'

/**
 * The menu — technical plan §4, §6, §7d.
 *
 * Three independently cached reads rather than one, because §6 gives them three
 * different tags: `menu` for the sections and dishes, `weekly` for Ugens ret and
 * `monthly` for Månedens burger. Publishing next week's dish must not expire the
 * whole menu, and this is where that becomes true rather than aspirational.
 *
 * Within the `menu` read, the categories and the dishes are still read in parallel and
 * joined in memory, which is what keeps a nine-section menu at a fixed cost rather
 * than N+1.
 *
 * The rows a public page may see are decided by RLS, not by this file: invisible
 * categories, soft-deleted dishes, dishes that have never been published and a
 * Månedens burger outside its date window are all unreadable to `anon`. A staff member
 * in preview reads through their own JWT and therefore sees more, so the two rules
 * that are genuinely about *display* rather than privilege — a dish is not deleted,
 * and a section is visible — are restated in the query for both paths.
 *
 * No decision about display is made here. Whether an item is currently sold out, and
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
  draft?: unknown
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
  draft?: unknown
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
  draft?: unknown
}

type MonthlyBurgerRow = {
  name: string | null
  description: string | null
  price_ore: number | null
  starts_on: string | null
  ends_on: string | null
  sold_out_on: string | null
  show_on_homepage: boolean
  draft?: unknown
}

/** Everything the menu page and the Forside's featured burgers need. */
export type MenuContent = {
  categories: MenuCategory[]
  weeklySpecial: WeeklySpecial | null
  monthlyBurger: MonthlyBurger | null
}

const CATEGORY_COLUMNS = 'id, slug, name, intro, note, kind, sort_order'
const DISH_COLUMNS =
  'id, category_id, name, description, secondary_note, price_ore, labels, details, sold_out_on, sort_order'
const WEEKLY_COLUMNS =
  'iso_year, iso_week, days, name, description, price_small_ore, price_large_ore, sold_out_on, sat_enabled, sat_name, sat_description, sat_price_ore, sat_deadline, sat_sold_out_on'
const MONTHLY_COLUMNS =
  'name, description, price_ore, starts_on, ends_on, sold_out_on, show_on_homepage'

/*
 * The Tapas document is read by `readTapasDocument` (`lib/menu/tapas.ts`), which the
 * administration's editor uses too.
 *
 * One reader rather than two, deliberately. The ids, the order, the `mode` and the
 * `choose` counts are structural rules stated once in `TAPAS_GROUP_RULES`; a second
 * reader here would be a second place for them to be stated, and the first place they
 * would drift. A document with any other shape is simply not a Tapas document, and the
 * entry then renders as an ordinary dish rather than throwing on a visitor.
 */

function toDish(row: DishRow): Dish {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    secondaryNote: row.secondary_note,
    priceOre: row.price_ore,
    labels: row.labels ?? [],
    tapas: readTapasDocument(row.details),
    soldOutOn: row.sold_out_on as IsoDate | null,
  }
}

/**
 * The dishes a request may see.
 *
 * `deleted_at` and `is_new_draft` are not granted to `anon` at all, so the published
 * path cannot name them; `dishes_select_public` already excludes both. A preview reads
 * through a staff JWT and sees everything, so the soft-delete rule — which is about
 * display rather than privilege — is restated for that path only.
 */
function dishQuery(access: ContentAccess) {
  const query = access.database.from('dishes').select(columns(access, DISH_COLUMNS))

  return access.includeDrafts ? query.is('deleted_at', null) : query
}

/**
 * Order by the position each row *ends up with*, not the one it was fetched by.
 *
 * The query already asks the database for `sort_order` ascending, and for the published
 * path that is the whole answer — the overlay is a no-op there, so this sort reproduces
 * exactly the order the database returned. It matters for the **preview**: a draft may
 * carry a new `sort_order` (phase 5E), and a draft that changes a value the SQL sorted
 * by has to change the sort too, or Forhåndsvis would show the new order's *contents*
 * in the old order's *sequence* — a preview that is not a preview.
 *
 * The tie-break is by name, in Danish, which is the same rule `groupDishesBySection`
 * applies in the administration. Two dishes never share a position in practice, but if
 * they ever did, the administration, the preview and the public menu would still agree
 * about which came first instead of each taking the database's word for it.
 */
function byPosition(a: { sort_order: number; name: string }, b: { sort_order: number; name: string }) {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'da-DK')
}

function groupDishesByCategory(rows: DishRow[], includeDrafts: boolean): Map<string, Dish[]> {
  const byCategory = new Map<string, DishRow[]>()

  for (const raw of rows) {
    // Overlay first, group second: a draft may move the dish to another section as well
    // as to another position, and both are answered by the merged row.
    const { row } = overlayDraft<DishRow>(raw, includeDrafts ? raw.draft : null, dishDraft)
    const dishes = byCategory.get(row.category_id)

    if (dishes === undefined) {
      byCategory.set(row.category_id, [row])
    } else {
      dishes.push(row)
    }
  }

  return new Map(
    [...byCategory].map(([categoryId, dishes]) => [
      categoryId,
      [...dishes].sort(byPosition).map(toDish),
    ]),
  )
}

/** The nine sections with their dishes. Tag: `menu`. */
const readMenuSections = definePublicRead(
  'menu-sections',
  [CACHE_TAGS.menu],
  async (access: ContentAccess): Promise<MenuCategory[]> => {
    const [categoriesResult, dishesResult] = await Promise.all([
      access.database
        .from('menu_categories')
        .select(columns(access, CATEGORY_COLUMNS))
        .eq('visible', true)
        .order('sort_order', { ascending: true })
        .returns<CategoryRow[]>(),
      dishQuery(access).order('sort_order', { ascending: true }).returns<DishRow[]>(),
    ])

    assertNoQueryError('the menu sections', categoriesResult.error)
    assertNoQueryError('the dishes', dishesResult.error)

    const dishesByCategory = groupDishesByCategory(dishesResult.data ?? [], access.includeDrafts)

    const categories = (categoriesResult.data ?? []).map(
      (raw) =>
        overlayDraft<CategoryRow>(raw, access.includeDrafts ? raw.draft : null, menuCategoryDraft)
          .row,
    )

    // The same rule for the sections themselves, for the same reason: a section's
    // position is a draft field too (§4), so the sequence has to follow the overlay
    // rather than the query. Nothing writes a section position yet — the editor for it
    // is not phase 5E's — but a read that only half-applies a draft is the kind of
    // incoherence that is found much later and blamed on something else.
    return [...categories].sort(byPosition).map((row) => {
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        intro: row.intro,
        note: row.note,
        kind: row.kind,
        dishes: dishesByCategory.get(row.id) ?? [],
      }
    })
  },
)

/** Ugens ret and the optional Lørdagsmenu, one singleton row. Tag: `weekly`. */
const readWeeklySpecial = definePublicRead(
  'weekly-special',
  [CACHE_TAGS.weekly],
  async (access: ContentAccess): Promise<WeeklySpecial | null> => {
    const { data, error } = await access.database
      .from('weekly_special')
      .select(columns(access, WEEKLY_COLUMNS))
      .maybeSingle<WeeklySpecialRow>()

    assertNoQueryError('Ugens ret', error)
    if (data === null) return null

    const { row } = overlayDraft<WeeklySpecialRow>(
      data,
      access.includeDrafts ? data.draft : null,
      weeklySpecialDraft,
    )

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
  },
)

/** Månedens burger, one singleton row. Tag: `monthly`. */
const readMonthlyBurger = definePublicRead(
  'monthly-burger',
  [CACHE_TAGS.monthly],
  async (access: ContentAccess): Promise<MonthlyBurger | null> => {
    const { data, error } = await access.database
      .from('monthly_burger')
      .select(columns(access, MONTHLY_COLUMNS))
      .maybeSingle<MonthlyBurgerRow>()

    assertNoQueryError('Månedens burger', error)
    if (data === null) return null

    const { row } = overlayDraft<MonthlyBurgerRow>(
      data,
      access.includeDrafts ? data.draft : null,
      monthlyBurgerDraft,
    )

    // An unfilled burger is not a burger. The date window is applied later, at read
    // time, by `lib/menu/view.ts` (§7d).
    if (row.name === null) return null

    return {
      name: row.name,
      description: row.description,
      priceOre: row.price_ore,
      startsOn: row.starts_on as IsoDate | null,
      endsOn: row.ends_on as IsoDate | null,
      soldOutOn: row.sold_out_on as IsoDate | null,
      showOnHomepage: row.show_on_homepage,
    }
  },
)

/** Deduplicated per request: the Forside's featured burgers come from the same reads. */
export const readMenuContent = cache(async (): Promise<MenuContent> => {
  const [categories, weeklySpecial, monthlyBurger] = await Promise.all([
    readMenuSections(),
    readWeeklySpecial(),
    readMonthlyBurger(),
  ])

  return { categories, weeklySpecial, monthlyBurger }
})
