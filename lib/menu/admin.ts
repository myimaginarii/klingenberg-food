import { formatWeekdayTime } from '@/lib/hours/format'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { MENU_DRAFT_FIELDS, type MenuDraftField } from '@/lib/schemas/menu'
import type { IsoDate } from '@/lib/time/calendar'

import { resolveSoldOut } from './availability'

/**
 * The menu administration's domain rules — design 1r / 1y, technical plan §4, §6.
 *
 * Pure. Everything here takes the records the admin read layer produced and answers a
 * question the screen would otherwise answer inline, in React, where it could not be
 * tested and would quietly diverge from the server rule that enforces it:
 *
 *   * which section a dish belongs to **right now, including its draft** (§6);
 *   * how many dishes each section holds, for the counts in the desktop chips (1r);
 *   * which sections a dish may be moved into, and which are refused;
 *   * what a row's pending change should say — "Ny pris afventer offentliggørelse".
 *
 * The category restrictions are the important half. "Do not allow moving a normal dish
 * into Ugens ret" is a rule about the menu, not about a dropdown, so it is stated here
 * once and applied twice: the editor builds its options from `assignableCategories`,
 * and the Server Action re-decides the same question with `mayHoldDishes` before any
 * value reaches a draft. A dropdown is a suggestion, not a permission.
 */

/** `menu_categories.kind` — an ordinary list of dishes, or the Ugens ret section. */
export type AdminCategoryKind = 'dishes' | 'weekly_special'

/** One section as the administration sees it, drafts included. */
export type AdminCategory = {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly kind: AdminCategoryKind
  readonly hasDraft: boolean
}

/** The editable content of a dish, in database casing. What a draft is made of. */
export type DishDraftValues = {
  category_id: string
  name: string
  description: string | null
  secondary_note: string | null
  price_ore: number | null
  labels: string[]
}

/**
 * Written as a `Record` so the compiler insists on every key. `Object.keys` of an
 * exhaustive record cannot fall behind the type it is keyed by, which is the point:
 * a field added to `DishDraftValues` without being listed here is a compile error.
 */
const DISH_EDITOR_FIELD_SET: Record<keyof DishDraftValues, true> = {
  category_id: true,
  name: true,
  description: true,
  secondary_note: true,
  price_ore: true,
  labels: true,
}

/**
 * The draft fields the dish editor panel (1r) owns — and, just as importantly, the ones
 * it does not.
 *
 * `dishDraft` has nine fields; the panel renders six. The other three belong to other
 * interactions: `sort_order` to the reorder controls (phase 5E), `details` to the Tapas
 * list editor, `image_id` to the image library. A save from the panel must therefore
 * say *"these six are mine, and any of mine that no longer differ from the published
 * values should leave the draft"* — and say nothing at all about the other three.
 *
 * Getting this wrong is not a cosmetic mistake. Before this list existed the panel
 * saved with `mode: 'replace'`, which discards the whole stored draft and writes the
 * submission in its place; a colleague's pending reorder vanished the moment anybody
 * saved a price on the same dish, silently, leaving half a new order waiting to publish.
 */
export const DISH_EDITOR_FIELDS = Object.keys(DISH_EDITOR_FIELD_SET) as readonly (
  keyof DishDraftValues
)[]

/** One dish as the administration sees it, drafts included. */
export type AdminDish = {
  readonly id: string
  /** The section the dish is in — the draft's, when it carries one. */
  readonly categoryId: string
  readonly name: string
  readonly description: string | null
  readonly secondaryNote: string | null
  readonly priceOre: number | null
  readonly labels: readonly string[]
  /** The position the administration shows — the draft's, when it carries one. */
  readonly sortOrder: number
  /**
   * The **published** position. What a guest currently sees (phase 5E).
   *
   * Kept beside `sortOrder` rather than inside `live` for the same reason `sortOrder`
   * is not a field of `DishDraftValues`: the dish editor does not submit a position, so
   * it must not appear in the panel's delta. Reordering is the only editor that writes
   * it, and it needs both numbers — the one on screen, and the one to measure a real
   * change against (`lib/menu/reorder.ts`).
   */
  readonly liveSortOrder: number
  /** Display only in phase 5B; the Udsolgt action itself is phase 5C (§6). */
  readonly soldOutOn: string | null
  /** True while the dish has never been published and is invisible to guests (§4). */
  readonly isNewDraft: boolean
  readonly hasDraft: boolean
  /** The editable fields the stored draft actually changes, in schema order. */
  readonly draftFields: readonly MenuDraftField[]
  /** The version token the editor submits back with a save (§6). */
  readonly updatedAt: string
  /**
   * The published values, before the draft is applied — what a guest sees right now.
   *
   * The editor needs both: the overlaid values to show, and these to compare against.
   * A draft holds **only the changed fields** (§4), and "changed" can only mean
   * "different from what is live" — so the comparison has to be against something the
   * overlay has not already been applied to.
   */
  readonly live: DishDraftValues
}

/** A section with its dishes and its count, ready for the chips and the list. */
export type AdminMenuSection = {
  readonly category: AdminCategory
  readonly dishes: readonly AdminDish[]
  readonly dishCount: number
}

/**
 * Group the dishes under their sections, in the sections' own order.
 *
 * Grouping is by the **effective** category — a dish whose draft moves it to Dessert
 * is listed under Dessert here, because the administration shows what the next publish
 * will produce. The public menu keeps the dish where it is until somebody presses
 * Offentliggør, which is the whole point of a draft, and the row says so.
 *
 * Dishes are ordered by `sort_order`, then by name, which is the same ordering the
 * public menu's index uses, so the two lists never disagree about what comes first.
 * A dish whose category no longer exists is dropped rather than shown under a section
 * it is not in; the reference is `ON DELETE RESTRICT`, so this cannot happen without a
 * migration going wrong.
 */
export function groupDishesBySection(
  categories: readonly AdminCategory[],
  dishes: readonly AdminDish[],
): AdminMenuSection[] {
  const byCategory = new Map<string, AdminDish[]>()

  for (const dish of dishes) {
    const existing = byCategory.get(dish.categoryId)
    if (existing === undefined) {
      byCategory.set(dish.categoryId, [dish])
    } else {
      existing.push(dish)
    }
  }

  return categories.map((category) => {
    const found = [...(byCategory.get(category.id) ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'da-DK'),
    )

    return { category, dishes: found, dishCount: found.length }
  })
}

/**
 * May ordinary dishes live in this section?
 *
 * Two sections in the approved navigation are not ordinary lists, and both are refused
 * for the same reason: something else already owns their content.
 *
 *   * **Ugens ret** is `kind: 'weekly_special'`. Its content is the `weekly_special`
 *     singleton row, edited in its own screen (1ag) in phase 6. A dish placed in it
 *     would be a second, competing source for the same card.
 *   * **Månedens burger** is not a section at all. It is the `monthly_burger` singleton
 *     (§4, §7d) and has no row in `menu_categories`, so "move a dish into Månedens
 *     burger" has no category to name — which is why the guard below is written as
 *     "the target must be a section that holds dishes" rather than as a list of
 *     forbidden names. A slug that is not a section is refused by the same line.
 */
export function mayHoldDishes(category: Pick<AdminCategory, 'kind'>): boolean {
  return category.kind === 'dishes'
}

/** The sections a dish may be created in or moved to — the dropdown's only source. */
export function assignableCategories(
  categories: readonly AdminCategory[],
): readonly AdminCategory[] {
  return categories.filter(mayHoldDishes)
}

/**
 * Where a dish lands when it is moved into a section: at the end of that section's
 * order, as the phase brief requires.
 *
 * The value is written into the **draft**, so the dish keeps its published position
 * until the move is published — the same rule every other field follows.
 */
export function nextSortOrderIn(dishes: readonly AdminDish[]): number {
  return dishes.reduce((highest, dish) => Math.max(highest, dish.sortOrder), 0) + 1
}

/**
 * The Danish name of each editable field, for the row's pending-change line (1r draws
 * "Ny pris afventer offentliggørelse" beneath the dish name).
 *
 * Menu vocabulary, so it lives beside the menu rules rather than inside a component;
 * that also makes the wording assertable. `MENU_DRAFT_FIELDS` comes from the schema, so
 * a field added to `dishDraft` without a name here is a type error rather than a row
 * that silently says "Ændringer".
 */
const FIELD_NAMES: Record<MenuDraftField, string> = {
  category_id: 'sektion',
  name: 'navn',
  description: 'beskrivelse',
  secondary_note: 'ekstra linje',
  price_ore: 'pris',
  labels: 'mærkater',
  details: 'liste',
  image_id: 'billede',
  sort_order: 'rækkefølge',
}

/** A capitalised sentence, the way the design writes one. */
function sentence(text: string): string {
  return text.charAt(0).toLocaleUpperCase('da-DK') + text.slice(1)
}

/**
 * What this row's Kladde state should say, or `null` when there is nothing pending.
 *
 * Derived entirely from the stored draft — the fields it actually changes — so the
 * message cannot claim a change the database does not hold. Nothing about pending
 * state is remembered anywhere in the browser.
 *
 * A dish that has never been published is a different situation from a dish with a
 * pending edit, and gets a different sentence: it is not "a new price waiting", it is
 * an entire dish that no guest can see yet.
 */
export function describePendingChange(dish: AdminDish): string | null {
  if (dish.isNewDraft) return 'Ny ret — vises først på hjemmesiden, når den offentliggøres'
  if (!dish.hasDraft) return null

  const changed = MENU_DRAFT_FIELDS.filter((field) => dish.draftFields.includes(field))

  // Moving a dish to another section also writes its position in that section (the end
  // of it). That is the move's mechanics, not a second thing the person did, so the
  // sentence says "ny sektion" rather than "nye sektion og rækkefølge".
  const named = changed
    .filter((field) => !(field === 'sort_order' && changed.includes('category_id')))
    .map((field) => FIELD_NAMES[field])

  if (named.length === 0) return 'Ændringer afventer offentliggørelse'
  if (named.length === 1) return sentence(`ny ${named[0] ?? ''} afventer offentliggørelse`)

  const last = named[named.length - 1] ?? ''
  return sentence(`nye ${named.slice(0, -1).join(', ')} og ${last} afventer offentliggørelse`)
}

/**
 * What the availability control shows — technical plan §7b, design 1r / 1y.
 *
 * `soldOut` drives the switch and the word beside it; `resetText` is the helper line
 * beneath it. Both come from **one** call to `resolveSoldOut()`, the phase-2 function
 * the public menu already answers the same question with, so the administration and
 * the hjemmeside can never disagree about whether Thor is currently sold out or about
 * when the marking lifts.
 */
export type DishAvailability = {
  readonly soldOut: boolean
  /** The automatic-reset sentence, or `null` when the dish is available. */
  readonly resetText: string | null
}

/**
 * Describe one dish's availability, for a screen to render.
 *
 * The wording is §7b's, and the weekday and time in it are **computed, never written
 * down**: `clearsAt` is the opening instant the hours engine found, and
 * `formatWeekdayTime` turns it into Danish. Change the opening hours or publish an
 * override, and this sentence changes with them on the next request — which is the
 * whole reason no expiry instant is stored (§4).
 *
 * The second sentence is the honest end of the same rule. When no opening day exists
 * inside the engine's search window there is nothing to promise, so the screen says
 * so rather than leaving somebody waiting for a reset that will not come.
 *
 * An available dish gets no helper text at all. There is nothing pending about it.
 */
export function describeAvailability(
  soldOutOn: IsoDate | null,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
  now: Date,
): DishAvailability {
  const { soldOut, clearsAt } = resolveSoldOut(soldOutOn, schedule, overrides, now)

  if (!soldOut) return { soldOut: false, resetText: null }

  return {
    soldOut: true,
    resetText:
      clearsAt === null
        ? 'Nulstilles ikke automatisk — I har ingen åbningsdage planlagt'
        : `Nulstilles automatisk, når I åbner igen — ${formatWeekdayTime(clearsAt)}`,
  }
}

/**
 * The fields a submitted dish actually changes — technical plan §4.
 *
 * §4 describes the draft column as "holding **only the changed fields**", and that is a
 * property worth keeping literally true rather than approximately. A draft that also
 * carried the fields somebody left alone would be wrong in three ways at once: the
 * row's Kladde line would announce a new price when the price did not move, the audit
 * entry would record a change to a description nobody touched, and re-saving a dish
 * would resurrect values a colleague had meanwhile published.
 *
 * So the editor submits the whole dish — a form has to — and this reduces it to the
 * difference. An empty result means the person changed nothing, which is how a draft
 * gets cleared again when an edit is reverted (see `saveEntityDraft`'s `replace` mode).
 *
 * `labels` compares by position as well as by content, which is exactly right:
 * `buildDishLabels` preserves the order of labels a dish already had, so an unchanged
 * label set is an identical array and a reordered one is a real change.
 */
export function dishDraftDelta(
  submitted: DishDraftValues,
  live: DishDraftValues,
): Partial<DishDraftValues> {
  const delta: Partial<DishDraftValues> = {}

  if (submitted.category_id !== live.category_id) delta.category_id = submitted.category_id
  if (submitted.name !== live.name) delta.name = submitted.name
  if (submitted.description !== live.description) delta.description = submitted.description
  if (submitted.secondary_note !== live.secondary_note) {
    delta.secondary_note = submitted.secondary_note
  }
  if (submitted.price_ore !== live.price_ore) delta.price_ore = submitted.price_ore

  const sameLabels =
    submitted.labels.length === live.labels.length &&
    submitted.labels.every((label, index) => label === live.labels[index])
  if (!sameLabels) delta.labels = submitted.labels

  return delta
}
