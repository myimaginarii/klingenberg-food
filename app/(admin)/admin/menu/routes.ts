/**
 * The menu administration's addresses — design 1r / 1y.
 *
 * Which section is open and which dish is being edited are **in the URL**, not in a
 * component's memory. That is not a stylistic preference:
 *
 *   * the screen stays a set of Server Components with no client state to keep in step
 *     with the server (the phase brief's "no unnecessary client state");
 *   * a Server Action can report where it went by redirecting, which is how the rest of
 *     this administration already reports;
 *   * the editor panel can be linked to, reloaded and gone back to, and the browser's
 *     own back button does what a person expects;
 *   * and it works with no JavaScript at all, which matters on the phone the plan calls
 *     the primary admin device (§15, phase 12).
 *
 * Every link and every redirect in this folder is built here, so a parameter cannot be
 * spelled one way by a link and another way by the action that reads it.
 */

export const MENU_PATH = '/admin/menu'

/** The query parameters this screen understands. Anything else is ignored. */
export const MENU_PARAM = {
  /** The open section, by slug. */
  section: 'sektion',
  /** The dish whose editor panel is open, by id. */
  dish: 'ret',
  /** Present when the panel is open for a dish that does not exist yet. */
  creating: 'ny',
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
} as const

/**
 * The editor panel's anchor.
 *
 * Opening the panel is a navigation, so the browser moves to this fragment and the
 * panel is both scrolled to and the next thing in the tab order — which is the
 * keyboard behaviour the design's side panel needs, with no focus management to write
 * and nothing to restore on close.
 */
export const EDITOR_ANCHOR = 'ret-editor'

export type MenuLocation = {
  /** The section slug to open. */
  readonly section?: string | null
  /** The dish to open the editor for. */
  readonly dish?: string | null
  /** Open the editor for a new dish in `section`. */
  readonly creating?: boolean
  /** A save or publish outcome, from the closed set each action defines. */
  readonly status?: string | null
}

/**
 * Build a menu-administration address.
 *
 * `extra` carries the field errors and the echoed values a refused save comes back
 * with (see `dish-form.ts`); it is merged in rather than concatenated, so a caller
 * cannot produce a malformed query string by hand.
 */
export function menuHref(location: MenuLocation = {}, extra?: URLSearchParams): string {
  const parameters = new URLSearchParams()

  if (location.section) parameters.set(MENU_PARAM.section, location.section)
  if (location.dish) parameters.set(MENU_PARAM.dish, location.dish)
  if (location.creating === true) parameters.set(MENU_PARAM.creating, '1')
  if (location.status) parameters.set(MENU_PARAM.status, location.status)

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()
  const editorOpen = Boolean(location.dish) || location.creating === true
  const fragment = editorOpen ? `#${EDITOR_ANCHOR}` : ''

  return `${MENU_PATH}${query.length > 0 ? `?${query}` : ''}${fragment}`
}
