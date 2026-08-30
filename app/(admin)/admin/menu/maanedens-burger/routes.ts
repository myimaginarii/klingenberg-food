/**
 * The Månedens burger screen's addresses — design 1ah.
 *
 * The same rule the menu administration and the Ugens ret editor already follow
 * (`../routes.ts`, `../ugens-ret/routes.ts`): everything this screen is currently
 * showing is **in the URL**, not in a component's memory. That keeps the whole screen a
 * set of Server Components, lets a Server Action report by redirecting, makes every
 * state linkable and reloadable, and means the editor works with no JavaScript at all —
 * which matters on the phone §15 calls the primary admin device.
 *
 * Every link and every redirect in this folder is built here, so a parameter cannot be
 * spelled one way by a link and another way by the action that reads it.
 */

export const MONTHLY_PATH = '/admin/menu/maanedens-burger'

/** The query parameters this screen understands. Anything else is ignored. */
export const MONTHLY_PARAM = {
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
  /**
   * The ~10-second Fortryd after an immediate availability change (§6, 1ah).
   *
   * Two values, and neither is authority: the version token the undo must match, and
   * which state to put the burger back into. The Server Action re-authorizes and
   * re-validates both, so a hand-typed query string can produce a strip — and pressing
   * it is refused exactly as any other forged request is.
   *
   * Its own two names rather than the menu screen's or the weekly screen's, so a
   * `fortryd` that means "put Månedens burger back" and a `fortryd` that means "put a
   * dish back" are never one query string with two meanings.
   */
  undoVersion: 'fortryd_version',
  undoSoldOut: 'fortryd_udsolgt',
  /**
   * The publish confirmation for a window that has already ended (§7d).
   *
   * Present only as `'1'`, and it is a *request to be asked*, never a permission: the
   * confirmation is rendered from the row the server just read, and the publish itself
   * still refuses without an explicit `bekraeft` field in the submitted form.
   */
  confirmExpired: 'udloebet',
} as const

/**
 * The editor's anchor.
 *
 * A save redirects back to it, so the browser scrolls there and the tab order continues
 * from the card — the same "fragment instead of focus management" the menu screen uses
 * for its editor panel and the weekly screen for its two cards.
 */
export const EDITOR_ANCHOR = 'maanedens-burger'

/**
 * The Offentliggør control's anchor, and its confirmation's.
 *
 * Cancelling the confirmation navigates back to `#offentliggoer-knap`, which is the
 * control the person pressed to open it, so the browser puts them — and the keyboard —
 * back where they were. The same mechanism `DeleteDishDialog` and
 * `CopyPreviousWeekDialog` use, applied to this screen's one dialog.
 */
export const PUBLISH_BUTTON_ANCHOR = 'offentliggoer-knap'
export const PUBLISH_DIALOG_ANCHOR = 'offentliggoer-bekraeft'

export type MonthlyLocation = {
  /** A save, publish or availability outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** Come back to the editor card. */
  readonly focus?: boolean
  /** The Fortryd offer for an availability change that just went live (§6). */
  readonly undo?: {
    readonly version: string
    /** The state Fortryd would put the burger back into. */
    readonly soldOut: boolean
  } | null
  /** Ask before publishing a window that has already ended (§7d). Nothing has happened. */
  readonly confirmExpired?: boolean
}

/**
 * Build an address on this screen.
 *
 * `extra` carries the field errors and echoed values a refused save comes back with
 * (see `./forms.ts`); it is merged in rather than concatenated, so a caller cannot
 * produce a malformed query string by hand.
 */
export function monthlyHref(
  location: MonthlyLocation = {},
  extra?: URLSearchParams,
): string {
  const parameters = new URLSearchParams()

  if (location.status) parameters.set(MONTHLY_PARAM.status, location.status)
  if (location.confirmExpired === true) parameters.set(MONTHLY_PARAM.confirmExpired, '1')

  if (location.undo) {
    parameters.set(MONTHLY_PARAM.undoVersion, location.undo.version)
    parameters.set(MONTHLY_PARAM.undoSoldOut, location.undo.soldOut ? '1' : '0')
  }

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()

  // Most specific first: a confirmation is what the person just asked for, and it must
  // be what the browser lands on.
  const anchor =
    location.confirmExpired === true
      ? PUBLISH_DIALOG_ANCHOR
      : location.focus === true
        ? EDITOR_ANCHOR
        : null

  return `${MONTHLY_PATH}${query.length > 0 ? `?${query}` : ''}${anchor === null ? '' : `#${anchor}`}`
}
