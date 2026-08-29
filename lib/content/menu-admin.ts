import 'server-only'

import { cache } from 'react'

import { overlayDraft } from '@/lib/drafts/overlay'
import type { AdminCategory, AdminDish } from '@/lib/menu/admin'
import { readTapasDocument } from '@/lib/menu/tapas'
import type { MenuDraftField } from '@/lib/schemas/menu'
import { dishDraft, menuCategoryDraft } from '@/lib/schemas/menu'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The menu as staff edit it — technical plan §4, §6; design 1r / 1y.
 *
 * A **separate read from the public one, on purpose.** `lib/content/menu.ts` answers
 * "what should a guest see": it goes through `definePublicRead`, which caches the
 * result under the `menu` tag, maps rows down to the domain types the site renders,
 * and reads through the anonymous client on every request that is not a preview. Every
 * one of those properties is wrong for an editor:
 *
 *   * **Never cached.** An editor that showed a cached menu would show a colleague's
 *     save five minutes late, and — worse — would hand the *stale* `updated_at` to the
 *     next save, turning optimistic concurrency (§6) into a lottery. Editor data is
 *     read fresh, every time, and carries no cache tag at all, so nothing a publish
 *     expires can affect it and nothing here can pollute a public entry.
 *   * **Through the staff member's own JWT.** RLS then decides what exists: an
 *     unpublished dish (`is_new_draft`), an invisible section and a draft column are
 *     all readable to staff and to nobody else. The administration never uses the
 *     anonymous client, and never the service-role key.
 *   * **Drafts merged in, and reported.** The list shows what the next publish will
 *     produce, together with which fields are pending, so the Kladde badge and its
 *     sentence are derived from the stored draft rather than remembered anywhere.
 *
 * `cache()` deduplicates within one render pass — the page, the chips and the editor
 * panel ask the same question — and expires with the request. That is memoisation, not
 * caching: two requests never share an answer.
 *
 * The overlay itself is not reimplemented. `overlayDraft` is the same function the
 * preview and the public menu use, so an editor and a preview can never disagree about
 * what a draft currently says.
 */

type CategoryRow = {
  id: string
  slug: string
  name: string
  kind: 'dishes' | 'weekly_special'
  sort_order: number
  visible: boolean
  draft: unknown
}

/** A soft-deleted dish, for the ten seconds its Fortryd is on offer (phase 5D). */
export type DeletedDish = {
  readonly id: string
  readonly name: string
  readonly isNewDraft: boolean
  /** The version token the Fortryd submits back (§6). */
  readonly updatedAt: string
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
  sort_order: number
  sold_out_on: string | null
  is_new_draft: boolean
  updated_at: string
  draft: unknown
}

const CATEGORY_COLUMNS = 'id, slug, name, kind, sort_order, visible, draft'
const DISH_COLUMNS =
  'id, category_id, name, description, secondary_note, price_ore, labels, details, sort_order, sold_out_on, is_new_draft, updated_at, draft'

export type AdminMenuContent = {
  readonly categories: readonly AdminCategory[]
  readonly dishes: readonly AdminDish[]
}

function toAdminCategory(raw: CategoryRow): AdminCategory {
  const { row } = overlayDraft<CategoryRow>(raw, raw.draft, menuCategoryDraft)

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    // `kind` is structure rather than content and is not a draft field (§4), so it is
    // read from the live row whatever the draft says.
    kind: raw.kind,
    hasDraft: raw.draft !== null && raw.draft !== undefined,
  }
}

function toAdminDish(raw: DishRow): AdminDish {
  const { row, changedFields } = overlayDraft<DishRow>(raw, raw.draft, dishDraft)

  return {
    live: {
      category_id: raw.category_id,
      name: raw.name,
      description: raw.description,
      secondary_note: raw.secondary_note,
      price_ore: raw.price_ore,
      labels: raw.labels ?? [],
    },
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    secondaryNote: row.secondary_note,
    priceOre: row.price_ore,
    labels: row.labels ?? [],
    sortOrder: row.sort_order,
    liveSortOrder: raw.sort_order,
    // The Tapas document, overlaid and published side by side — the same pair the
    // position keeps, and for the same reason: the editor shows the first and measures
    // a real change against the second (phase 5F, `lib/menu/tapas.ts`). `null` for
    // every ordinary dish, which is what keeps the Tapas editor off them.
    tapas: readTapasDocument(row.details),
    liveTapas: readTapasDocument(raw.details),
    // Read for display. Marking a dish Udsolgt is the immediate path with a 10 s
    // Fortryd (§6, `lib/menu/sold-out.ts`); nothing here writes it.
    soldOutOn: raw.sold_out_on,
    isNewDraft: raw.is_new_draft,
    hasDraft: raw.draft !== null && raw.draft !== undefined,
    draftFields: changedFields as readonly MenuDraftField[],
    updatedAt: raw.updated_at,
  }
}

/**
 * Every section and every live dish, with drafts merged in.
 *
 * Sections include the ones a guest cannot see — an invisible section still holds
 * dishes somebody has to be able to find — and include Ugens ret, which the approved
 * navigation lists (1r) even though its content is edited elsewhere.
 *
 * Soft-deleted dishes are excluded. A deleted dish is on its way out rather than
 * waiting to go live, which is the same rule `pending_changes` applies (§4). Bringing
 * one back is `readDeletedDish()` below, which is the only read in this file that
 * reaches past that exclusion — and it reaches exactly one row, by id.
 */
export const readAdminMenuContent = cache(async (): Promise<AdminMenuContent> => {
  const supabase = await createSupabaseServerClient()

  const [categories, dishes] = await Promise.all([
    supabase
      .from('menu_categories')
      .select(CATEGORY_COLUMNS)
      .order('sort_order', { ascending: true })
      .returns<CategoryRow[]>(),
    supabase
      .from('dishes')
      .select(DISH_COLUMNS)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .returns<DishRow[]>(),
  ])

  if (categories.error !== null) {
    throw new Error(`Could not read the menu sections for editing: ${categories.error.message}`)
  }
  if (dishes.error !== null) {
    throw new Error(`Could not read the dishes for editing: ${dishes.error.message}`)
  }

  return {
    categories: (categories.data ?? []).map(toAdminCategory),
    dishes: (dishes.data ?? []).map(toAdminDish),
  }
})

/**
 * One soft-deleted dish, by id — phase 5D.
 *
 * `readAdminMenuContent()` excludes deleted dishes, and rightly: a deleted dish is not
 * part of the menu anybody is editing. But the Fortryd strip has to *name* the dish it
 * offers to bring back, and the query string carries an id rather than a sentence —
 * exactly as the availability strip does, and for the same reason: a name in the URL is
 * a name somebody could type.
 *
 * So this is a targeted read of the one row, performed only while the strip is on
 * offer. It answers `null` for an id that names nothing, for a dish RLS hides, and for
 * a dish that is **not** deleted — which is what makes a hand-built query string
 * produce no strip at all rather than an offer to "restore" a dish that is already
 * there. It reads through the staff member's own JWT, uncached, like everything else
 * the administration reads.
 */
export async function readDeletedDish(dishId: string): Promise<DeletedDish | null> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('dishes')
    .select('id, name, is_new_draft, updated_at')
    .eq('id', dishId)
    .not('deleted_at', 'is', null)
    .maybeSingle<{ id: string; name: string; is_new_draft: boolean; updated_at: string }>()

  if (error !== null) {
    throw new Error(`Could not read the deleted dish: ${error.message}`)
  }

  if (data === null) return null

  return {
    id: data.id,
    name: data.name,
    isNewDraft: data.is_new_draft,
    updatedAt: data.updated_at,
  }
}

/**
 * Which dishes the **published** Forside currently features — technical plan §7e item 4.
 *
 * Read here, on the server, from the Forside document itself. The browser is never
 * asked whether a dish is featured, and could not be believed if it were: a submitted
 * `featured=true` would let anyone put a warning on the screen, and — worse — a
 * submitted `featured=false` would take a true one off it.
 *
 * It is **information, not authority**. Nothing downstream of this decides whether the
 * deletion may proceed; the answer only chooses whether the confirmation carries the
 * Forside sentence. Deleting the dish leaves `pages.home` exactly as the Owner wrote it
 * either way, and this function has no write path of any kind — it is a `select` of one
 * column of one row.
 *
 * `published`, deliberately, and not the draft: a Forside the Owner is midway through
 * rewriting is not what a guest currently sees, and the warning is about what a guest
 * currently sees. Staff may read `pages` (`pages_select_staff`), which is the whole of
 * the access this needs — they may not update the `home` row, and this function does
 * not widen that by a single privilege.
 */
export async function readHomeFeaturedDishIds(): Promise<readonly string[]> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('pages')
    .select('published')
    .eq('key', 'home')
    .maybeSingle<{ published: unknown }>()

  if (error !== null) {
    throw new Error(`Could not read the Forside document: ${error.message}`)
  }

  const published = data?.published
  if (typeof published !== 'object' || published === null) return []

  const ids = (published as Record<string, unknown>)['featured_dish_ids']

  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}
