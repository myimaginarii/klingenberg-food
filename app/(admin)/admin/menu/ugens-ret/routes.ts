/**
 * The Ugens ret screen's addresses — design 1ag.
 *
 * The same rule the menu administration already follows (`../routes.ts`): everything
 * this screen is currently showing is **in the URL**, not in a component's memory. That
 * keeps the whole screen a set of Server Components, lets a Server Action report by
 * redirecting, makes every state linkable and reloadable, and means the editor works
 * with no JavaScript at all — which matters on the phone §15 calls the primary admin
 * device.
 *
 * Every link and every redirect in this folder is built here, so a parameter cannot be
 * spelled one way by a link and another way by the action that reads it.
 */

export const WEEKLY_PATH = '/admin/menu/ugens-ret'

/** The query parameters this screen understands. Anything else is ignored. */
export const WEEKLY_PARAM = {
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
  /**
   * Which card the screen should come back to.
   *
   * A query parameter as well as a fragment, for the reason `../routes.ts` records
   * against `tapas_fokus`: **two redirect targets must never differ only by their
   * fragment.** Saving Ugens ret and then saving Lørdagsmenu would otherwise produce
   * `?status=gemt#ugens-ret` and `?status=gemt#loerdagsmenu`, which the router treats
   * as a hash change rather than a navigation — the write would happen and the screen
   * would keep showing the values from before it. With the target in the query the two
   * addresses genuinely differ, and two saves of the *same* card produce a
   * byte-identical address, which the router does re-fetch.
   */
  focus: 'felt',
  /**
   * The ~10-second Fortryd after an immediate availability change (§6, 1ag).
   *
   * Three values, and none of them is authority: which card the change was about, the
   * version token the undo must match, and which state to put it back into. The Server
   * Action re-authorizes and re-validates all three, so a hand-typed query string can
   * produce a strip — and pressing it is refused exactly as any other forged request is.
   *
   * Its own three names rather than the menu screen's, so a `fortryd` that means "put
   * Ugens ret back" and a `fortryd` that means "put a dish back" are never one query
   * string with two meanings.
   */
  undoTarget: 'fortryd_del',
  undoVersion: 'fortryd_version',
  undoSoldOut: 'fortryd_udsolgt',
  /**
   * The overwrite confirmation for "Kopiér sidste uge" (§6).
   *
   * Present only as `'1'`, and it is a *request to be asked*, never a permission: the
   * confirmation is rendered from the row the server just read, and the copy itself
   * still refuses without an explicit `bekraeft` field in the submitted form.
   */
  confirmCopy: 'kopier',
} as const

/**
 * The two editors' anchors.
 *
 * A save redirects back to the card it was about, so the browser scrolls there and the
 * tab order continues from it — the same "fragment instead of focus management" the
 * menu screen uses for its editor panel and its Tapas lists.
 */
export const WEEK_ANCHOR = 'ugens-ret'
export const SATURDAY_ANCHOR = 'loerdagsmenu'

/**
 * The copy control's anchor, and its confirmation's.
 *
 * Cancelling the confirmation navigates back to `#kopier-knap`, which is the control the
 * person pressed to open it, so the browser puts them — and the keyboard — back where
 * they were. The same mechanism `DeleteDishDialog` uses, applied to this screen's one
 * dialog.
 */
export const COPY_BUTTON_ANCHOR = 'kopier-knap'
export const COPY_DIALOG_ANCHOR = 'kopier-bekraeft'

export type WeeklyLocation = {
  /** A save, publish or copy outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** Which card to come back to. */
  readonly focus?: 'week' | 'saturday' | 'copy' | null
  /** The Fortryd offer for an availability change that just went live (§6). */
  readonly undo?: {
    readonly target: 'week' | 'saturday'
    readonly version: string
    /** The state Fortryd would put the card back into. */
    readonly soldOut: boolean
  } | null
  /** Ask before overwriting an existing draft with a copy (§6). Nothing has happened. */
  readonly confirmCopy?: boolean
}

const ANCHORS: Record<'week' | 'saturday' | 'copy', string> = {
  week: WEEK_ANCHOR,
  saturday: SATURDAY_ANCHOR,
  copy: COPY_BUTTON_ANCHOR,
}

/**
 * Build an address on this screen.
 *
 * `extra` carries the field errors and echoed values a refused save comes back with
 * (see `./forms.ts`); it is merged in rather than concatenated, so a caller cannot
 * produce a malformed query string by hand.
 */
export function weeklyHref(location: WeeklyLocation = {}, extra?: URLSearchParams): string {
  const parameters = new URLSearchParams()

  if (location.status) parameters.set(WEEKLY_PARAM.status, location.status)
  if (location.focus) parameters.set(WEEKLY_PARAM.focus, location.focus)
  if (location.confirmCopy === true) parameters.set(WEEKLY_PARAM.confirmCopy, '1')

  if (location.undo) {
    parameters.set(WEEKLY_PARAM.undoTarget, location.undo.target)
    parameters.set(WEEKLY_PARAM.undoVersion, location.undo.version)
    parameters.set(WEEKLY_PARAM.undoSoldOut, location.undo.soldOut ? '1' : '0')
  }

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()

  // Most specific first: a confirmation is what the person just asked for, and it must
  // be what the browser lands on.
  const anchor =
    location.confirmCopy === true
      ? COPY_DIALOG_ANCHOR
      : location.focus
        ? ANCHORS[location.focus]
        : null

  return `${WEEKLY_PATH}${query.length > 0 ? `?${query}` : ''}${anchor === null ? '' : `#${anchor}`}`
}
