/**
 * The Åbningstider screen's addresses — design 1t; technical plan §3, §15 (phase 8).
 *
 * The route is the one §3 prescribes — `app/(admin)/admin/aabningstider/page.tsx` — and no
 * new admin hierarchy is invented around it: the dashboard links here, the bar links back,
 * and that is the whole of the navigation.
 *
 * The same rule every section screen in this administration follows (`../menu/routes.ts`,
 * `../menu/ugens-ret/routes.ts`, `../menu/maanedens-burger/routes.ts`, `../besked/routes.ts`):
 * everything the screen is currently showing is **in the URL**, not in a component's
 * memory. That keeps the whole screen a set of Server Components, lets a Server Action
 * report by redirecting, makes every state linkable and reloadable, and means the editor
 * works with no JavaScript at all — which matters on the phone §15 calls the primary admin
 * device.
 *
 * Every link and every redirect in this folder is built here, so a parameter cannot be
 * spelled one way by a link and another way by the action that reads it.
 *
 * WHAT THIS SCREEN HAS NO ADDRESS FOR
 *
 * There is no undo parameter, because neither card has an immediate path with a Fortryd:
 * §6 names exactly four immediate operations and neither the weekly schedule nor a
 * one-off override is one of them. There is no **conflict address** — 1ae's sheet belongs
 * to the generated announcement of **phase 8C**, and nothing in this folder can reach an
 * announcement at all.
 *
 * WHAT PHASE 8B ADDED
 *
 * `dato` — which calendar date the one-off card is showing. It is a *selector*, not
 * authority: the server re-reads that date's row for itself and decides everything from
 * what it found, so a hand-typed date can only ever choose which of this staff member's
 * own dates is on screen. A value that is not a real date falls back to today.
 *
 * `bekraeft` — the one destructive press on the screen has to be answered before it acts
 * (see `./override-remove-actions.ts`). It is the same address-carried confirmation 1ah's
 * expired-window publish uses, rather than a dialog that needs JavaScript to exist.
 */

export const OPENING_HOURS_PATH = '/admin/aabningstider'

/** The query parameters this screen understands. Anything else is ignored. */
export const OPENING_HOURS_PARAM = {
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
  /** Which calendar date the one-off card is showing. A selector, never authority. */
  date: 'dato',
  /** The removal confirmation, when the press would change what a guest reads. */
  confirm: 'bekraeft',
} as const

/**
 * The editor's anchor.
 *
 * A save redirects back to it, so the browser scrolls there and the tab order continues
 * from the card — the same "fragment instead of focus management" every other section
 * screen uses.
 */
export const EDITOR_ANCHOR = 'aabningstider'

/** The one-off card's own anchor, so its actions come back to it and not to the week. */
export const OVERRIDE_ANCHOR = 'enkelt-aendring'

export type OpeningHoursLocation = {
  /** A save or publish outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** Come back to the editor card. */
  readonly focus?: boolean
  /** Come back to the one-off card instead. */
  readonly overrideFocus?: boolean
  /** Which date the one-off card should show. */
  readonly date?: string | null
  /** Ask the removal confirmation. */
  readonly confirm?: boolean
}

/**
 * Build an address on this screen.
 *
 * `extra` carries the field errors and echoed values a refused save comes back with (see
 * `./forms.ts`); it is merged in rather than concatenated, so a caller cannot produce a
 * malformed query string by hand.
 */
export function openingHoursHref(
  location: OpeningHoursLocation = {},
  extra?: URLSearchParams,
): string {
  const parameters = new URLSearchParams()

  if (location.status) parameters.set(OPENING_HOURS_PARAM.status, location.status)
  if (location.date) parameters.set(OPENING_HOURS_PARAM.date, location.date)
  if (location.confirm === true) parameters.set(OPENING_HOURS_PARAM.confirm, '1')

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()
  const anchor =
    location.overrideFocus === true
      ? `#${OVERRIDE_ANCHOR}`
      : location.focus === true
        ? `#${EDITOR_ANCHOR}`
        : ''

  return `${OPENING_HOURS_PATH}${query.length > 0 ? `?${query}` : ''}${anchor}`
}
