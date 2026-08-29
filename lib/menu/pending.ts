import type { EntityKey } from '@/lib/publishing/entities'

/**
 * What the menu screen is responsible for publishing — design 1r, technical plan §6.
 *
 * §6: "Section screens publish their own scope; the dashboard's 'Offentliggør
 * ændringer' publishes everything currently pending." So "the menu's scope" has to be
 * stated somewhere, and it is stated here rather than inside the Server Action, for
 * two reasons: the pending banner and the publish button must agree about what they
 * are counting, and a scope that lives in an action cannot be unit-tested.
 *
 * WHAT IS IN, AND WHAT IS NOT
 *
 *   * `dish` and `menu_category` — the content of 1r's list and its section chips.
 *   * **`weekly_special` is not.** Ugens ret appears in the navigation (1r draws its
 *     chip) but is edited and published in its own screen (1ag), in phase 6. Publishing
 *     it from here would put a colleague's half-finished week live from a screen that
 *     never showed it to them.
 *   * **`monthly_burger` is not**, for the same reason: it is its own entity with its
 *     own editor (1ah) and its own date window (§7d), not a dish.
 *
 * Both are still reachable from the dashboard, which publishes everything pending and
 * lists it per item — that is what the dashboard is for.
 */
export const MENU_PUBLISHABLE_ENTITIES: readonly EntityKey[] = ['dish', 'menu_category']

/** True when a pending change belongs to the menu screen's Offentliggør button. */
export function isMenuPublishable(entity: EntityKey): boolean {
  return MENU_PUBLISHABLE_ENTITIES.includes(entity)
}
