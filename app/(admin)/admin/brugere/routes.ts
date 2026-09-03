/**
 * The user administration's addresses — technical plan §3, §15 (phase 11C).
 *
 * The route is the one §3 prescribes — `app/(admin)/admin/brugere/page.tsx`. The
 * same rule every section screen follows: everything the screen shows is in the
 * URL, so a Server Action reports by redirecting, a confirmation is a link that
 * has done nothing yet, and the whole screen works with no JavaScript.
 *
 * Every link and every redirect in this folder is built here, so a parameter cannot
 * be spelled one way by a link and another way by the action that reads it.
 */

export const USERS_ADMIN_PATH = '/admin/brugere'

/** The query parameters this screen understands. Anything else is ignored. */
export const USERS_PARAM = {
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
  /**
   * The account whose role-change confirmation is open, by id. A **link**, not a
   * button: pressing "Gør til ejer" navigates here and nothing has happened yet —
   * the change itself is a form inside the confirmation, carrying the version token
   * the server rendered. The id is not authority: the confirmation renders only for
   * an account the server resolved and a control the server offers, and the action
   * re-authorizes, re-resolves and re-checks the version regardless.
   */
  confirmRole: 'rolle',
  /** The account whose deactivation confirmation is open. */
  confirmDeactivate: 'deaktiver',
  /** The account whose reactivation confirmation is open. */
  confirmReactivate: 'genaktiver',
} as const

/** The invitation card's anchor, where a refused or completed invitation comes back to. */
export const INVITE_ANCHOR = 'inviter'

/** The list's anchor. */
export const LIST_ANCHOR = 'brugerliste'

export const ROLE_DIALOG_ANCHOR = 'rolle-bekraeft'
export const DEACTIVATE_DIALOG_ANCHOR = 'deaktiver-bekraeft'
export const REACTIVATE_DIALOG_ANCHOR = 'genaktiver-bekraeft'

export type RowControl = 'role' | 'deactivate' | 'reactivate'

/**
 * The id of one row's control, so a confirmation's way back — and `Esc` — lands
 * the keyboard on the control it was opened from, with or without JavaScript.
 */
export function rowControlId(userId: string, control: RowControl): string {
  return `bruger-${userId}-${control}`
}

export type UsersLocation = {
  readonly status?: string | null
  readonly confirmRole?: string | null
  readonly confirmDeactivate?: string | null
  readonly confirmReactivate?: string | null
  /** Land on the invitation card, or on one row's control. */
  readonly focus?: 'invite' | { readonly userId: string; readonly control: RowControl } | null
}

/**
 * Build an address on this screen. `extra` carries the field errors and echoed
 * values a refused invitation comes back with (see `./forms.ts`). The fragment is
 * derived from the location — most specific first — and never lets two redirect
 * targets differ only by their fragment.
 */
export function usersHref(location: UsersLocation = {}, extra?: URLSearchParams): string {
  const parameters = new URLSearchParams()

  if (location.status) parameters.set(USERS_PARAM.status, location.status)
  if (location.confirmRole) parameters.set(USERS_PARAM.confirmRole, location.confirmRole)
  if (location.confirmDeactivate) parameters.set(USERS_PARAM.confirmDeactivate, location.confirmDeactivate)
  if (location.confirmReactivate) parameters.set(USERS_PARAM.confirmReactivate, location.confirmReactivate)

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const anchor = location.confirmRole
    ? ROLE_DIALOG_ANCHOR
    : location.confirmDeactivate
      ? DEACTIVATE_DIALOG_ANCHOR
      : location.confirmReactivate
        ? REACTIVATE_DIALOG_ANCHOR
        : location.focus === 'invite'
          ? INVITE_ANCHOR
          : location.focus
            ? rowControlId(location.focus.userId, location.focus.control)
            : null

  const query = parameters.toString()

  return `${USERS_ADMIN_PATH}${query.length > 0 ? `?${query}` : ''}${anchor === null ? '' : `#${anchor}`}`
}
