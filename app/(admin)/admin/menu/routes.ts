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
  /**
   * The ~10-second Fortryd offer after an immediate availability change (§6, 1r).
   *
   * Three values, and none of them is authority: the dish, the version token the undo
   * must match, and which state to put the dish back into. The Server Action
   * re-authorizes and re-validates all three, so a hand-typed query string can produce
   * a strip that offers an undo — and the undo itself is refused exactly as any other
   * forged request would be.
   */
  undoDish: 'fortryd',
  undoVersion: 'fortryd_version',
  undoSoldOut: 'fortryd_udsolgt',
  /**
   * The dish whose deletion is being confirmed (phase 5D, design 1r).
   *
   * Slet ret is a **link**, not a button: pressing it navigates here and nothing has
   * happened yet. That is what makes an accidental one-click deletion impossible
   * without any JavaScript being involved in preventing it — the destructive step is a
   * separate form, on a separate screen state, with its own submit.
   *
   * The id is not authority either. The confirmation is rendered from the dish the
   * *server* looked up, and the version token in its form is the one the server just
   * read — so a hand-typed id produces either a real confirmation for a real dish this
   * person may already delete, or nothing at all.
   */
  confirmDelete: 'slet',
  /**
   * The ~10-second Fortryd after a deletion went live (§6).
   *
   * Its own two parameters rather than the availability strip's, so the two offers can
   * never be confused for one another — a `fortryd` that means "put the dish back" and
   * a `fortryd` that means "make it available again" would be one query string with two
   * meanings. Neither is authority: the action re-authorizes, re-parses and hands the
   * version to the database, which refuses a stale one.
   */
  undoDeleteDish: 'fortryd_slet',
  undoDeleteVersion: 'fortryd_slet_version',
  /**
   * The dish a reorder just moved (phase 5E, design 1r / 1y).
   *
   * One parameter, and it is neither authority nor a record of anything: the move is
   * already saved as a draft, and this only decides two presentational things on the
   * page that comes back — which sentence the polite live region carries, and which
   * handle gets the keyboard back if the browser dropped it (see `ReorderHandle`).
   *
   * There is deliberately **no `fortryd` for a reorder.** Moving a dish is an ordinary
   * draft change (§6), not one of the two immediate paths, so nothing about it is on the
   * hjemmeside to undo — the way back is to move it again, or to leave the draft
   * unpublished.
   */
  movedDish: 'flyttet',
  /**
   * Which Tapas control the screen should come back to (phase 5F).
   *
   * The value is an element id built by `tapasGroupAnchor` / `tapasNewItemAnchor`; the
   * fragment is derived from it rather than the other way round. See the note above the
   * anchors for why it is a parameter and not only a fragment.
   */
  tapasFocus: 'tapas_fokus',
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

/**
 * The Slet ret control's anchor, and the confirmation's.
 *
 * Cancelling the confirmation navigates back to `#slet-ret`, which is the control the
 * person pressed to open it — so the browser puts them back where they were rather than
 * at the top of the screen, with no focus management to write and nothing to restore.
 * It is the same mechanism the editor panel already uses for `#ret-editor`, applied to
 * the one dialog this screen has.
 */
export const DELETE_BUTTON_ANCHOR = 'slet-ret'
export const DELETE_DIALOG_ANCHOR = 'slet-bekraeft'

/**
 * The Tapas editor's anchors — phase 5F.
 *
 * Every Tapas edit is a form submission that redirects, so the browser has to be put
 * back where the person was working. That is done the way the rest of this screen does
 * it — with a fragment, not with focus management: the group's own `<section>` for a
 * save, a removal or a move, and the new-item field itself after Tilføj punkt, so the
 * person can type the next item straight away. An `<input>` is focusable, so that one is
 * a real focus rather than only a scroll.
 *
 * WHY THE TARGET IS ALSO A QUERY PARAMETER, AND NOT ONLY A FRAGMENT
 *
 * Two Tapas edits in a row produce two addresses that are otherwise identical — same
 * section, same dish, same `status=tapas_gemt`. If the *only* difference between them
 * were the fragment, the router would treat the second redirect as a **hash change**
 * rather than as a navigation: nothing is re-fetched, and the screen keeps showing the
 * lists as they were before the save. The write still happens, which is the worst
 * version of the problem — a person edits Vælg 7 straight after saving Fast indhold,
 * the draft is stored, and the field springs back to its old text in front of them.
 *
 * So `tapas_fokus` carries the target as a parameter and the fragment is derived from
 * it. Two consecutive edits of *different* lists then differ in the query, and two
 * consecutive edits of the *same* list produce a byte-identical address, which the
 * router does re-fetch. It is not a cache-busting token: it is where the screen should
 * come back to, which is exactly what makes the address restorable on a reload.
 *
 * The rule this states for the rest of the screen: **never let two redirect targets
 * differ only by their fragment.**
 */
export const TAPAS_ANCHOR = 'tapas-indhold'

export function tapasGroupAnchor(groupId: string): string {
  return `tapas-${groupId}`
}

export function tapasNewItemAnchor(groupId: string): string {
  return `tapas-${groupId}-nyt`
}

export type MenuLocation = {
  /** The section slug to open. */
  readonly section?: string | null
  /** The dish to open the editor for. */
  readonly dish?: string | null
  /** Open the editor for a new dish in `section`. */
  readonly creating?: boolean
  /** A save or publish outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** The Fortryd offer for an availability change that just went live (§6). */
  readonly undo?: {
    readonly dishId: string
    readonly version: string
    /** The state Fortryd would put the dish back into. */
    readonly soldOut: boolean
  } | null
  /** Open the deletion confirmation for this dish. Nothing has happened yet. */
  readonly confirmDelete?: string | null
  /** The Fortryd offer for a deletion that just went live (§6). */
  readonly undoDelete?: {
    readonly dishId: string
    readonly version: string
  } | null
  /**
   * Land on the Slet ret control rather than on the editor panel.
   *
   * Used by the confirmation's own Behold-knap, so cancelling returns the person — and
   * the keyboard — to the control they opened it from.
   */
  readonly focusDelete?: boolean
  /** The dish a reorder just moved, for the live region and the keyboard (phase 5E). */
  readonly movedDish?: string | null
  /**
   * The element a Tapas edit should come back to (phase 5F).
   *
   * Built by `tapasGroupAnchor` / `tapasNewItemAnchor`, never by hand, and only ever set
   * together with `dish` — the group exists on the screen only while that dish's editor
   * is open. It becomes both a query parameter and the fragment; see the note above the
   * anchors for why both.
   */
  readonly tapasFocus?: string | null
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

  if (location.undo) {
    parameters.set(MENU_PARAM.undoDish, location.undo.dishId)
    parameters.set(MENU_PARAM.undoVersion, location.undo.version)
    parameters.set(MENU_PARAM.undoSoldOut, location.undo.soldOut ? '1' : '0')
  }

  if (location.confirmDelete) parameters.set(MENU_PARAM.confirmDelete, location.confirmDelete)
  if (location.movedDish) parameters.set(MENU_PARAM.movedDish, location.movedDish)
  if (location.tapasFocus) parameters.set(MENU_PARAM.tapasFocus, location.tapasFocus)

  if (location.undoDelete) {
    parameters.set(MENU_PARAM.undoDeleteDish, location.undoDelete.dishId)
    parameters.set(MENU_PARAM.undoDeleteVersion, location.undoDelete.version)
  }

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()
  const editorOpen = Boolean(location.dish) || location.creating === true

  // Most specific first: a confirmation is what the person just asked for, and coming
  // back from one should land on the control rather than at the top of the panel.
  const anchor = location.confirmDelete
    ? DELETE_DIALOG_ANCHOR
    : location.focusDelete === true
      ? DELETE_BUTTON_ANCHOR
      : location.tapasFocus
        ? location.tapasFocus
        : editorOpen
          ? EDITOR_ANCHOR
          : null

  return `${MENU_PATH}${query.length > 0 ? `?${query}` : ''}${anchor === null ? '' : `#${anchor}`}`
}
