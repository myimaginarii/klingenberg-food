import 'server-only'

import { readAdminMenuContent } from '@/lib/content/menu-admin'
import {
  assignableCategories,
  groupDishesBySection,
  nextSortOrderIn,
  type AdminCategory,
  type AdminDish,
} from '@/lib/menu/admin'

/**
 * What both dish actions need to know before they trust anything — design 1r.
 *
 * Saving a dish and creating one ask the server the same four questions, and asking
 * them twice in two files is how the answers drift apart:
 *
 *   * **which sections may hold a dish** — the rule from `lib/menu/admin.ts`, applied
 *     to the sections the *server* just read rather than to whatever the form named;
 *   * **which dish is being edited**, by the id the form carried;
 *   * **where a dish lands** when it joins a section — the end of that section's order;
 *   * **which section slug to redirect back to**, so the screen reopens where the work
 *     actually is.
 *
 * The point of gathering them here is that `categoryAllows` is built from the read, not
 * passed in. An action cannot accidentally check a submitted section against a list the
 * browser also supplied, because there is no such list to reach for.
 *
 * This is a read, not a rule. Every rule it applies lives in `lib/menu/admin.ts` and is
 * unit-tested there; this module only puts the current menu behind them.
 */

export type MenuEditContext = {
  readonly categories: readonly AdminCategory[]
  readonly dishes: readonly AdminDish[]
  /** The dish with this id, or `undefined`. */
  readonly dish: (dishId: string) => AdminDish | undefined
  /** May a dish live in this section? Answered from the sections the server read. */
  readonly categoryAllows: (categoryId: string) => boolean
  /** The slug to send the browser back to, or `null` when the section is unknown. */
  readonly slugOf: (categoryId: string) => string | null
  /** The position a dish takes when it joins this section: the end of its order. */
  readonly endOfCategory: (categoryId: string) => number
}

export async function readMenuEditContext(): Promise<MenuEditContext> {
  const { categories, dishes } = await readAdminMenuContent()
  const sections = groupDishesBySection(categories, dishes)
  const allowed = new Set(assignableCategories(categories).map((category) => category.id))

  return {
    categories,
    dishes,
    dish: (dishId) => dishes.find((candidate) => candidate.id === dishId),
    categoryAllows: (categoryId) => allowed.has(categoryId),
    slugOf: (categoryId) =>
      categories.find((category) => category.id === categoryId)?.slug ?? null,
    endOfCategory: (categoryId) =>
      nextSortOrderIn(sections.find((section) => section.category.id === categoryId)?.dishes ?? []),
  }
}
