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
 * Neither card has an undo of its *own*: §6 names exactly four immediate operations and
 * neither the weekly schedule nor a one-off override is one of them. Removing an override
 * is still a confirmation rather than a Fortryd (`./override-remove-actions.ts`).
 *
 * WHAT PHASE 8C-3B ADDED — and why the hours' address and the announcement's are separate
 *
 * §7e item 8 makes the hours authoritative and the announcement secondary: the override is
 * published first and always, and the optional generated message is attempted afterwards.
 * That ordering is visible in this table. `status` reports what happened to the **hours**;
 * `besked` reports what happened to the **announcement**; and both can stand on one
 * screen at once, because *"the hours are published, and the message was not created"* is
 * a real outcome and not a contradiction (1ae: *"Åbningstiderne er gemt. Beskeden blev
 * ikke oprettet."*).
 *
 * `konflikt` is 1ae's own address — the id of the published override whose suggested
 * message is waiting for a decision. It is a **selector, not authority**: the server
 * re-reads that override, re-reads the recurring week and re-asks the generator before it
 * draws the sheet and again before it writes, so a hand-typed id can only ever choose
 * which of this staff member's own published overrides is being asked about.
 *
 * `forslag` carries the one field a person is allowed to change — their edited wording —
 * across the redirect that draws the sheet, so pressing "Erstat med den nye besked" uses
 * the sentence they actually approved rather than the generator's default. It is
 * re-validated on the way back in (`withEditedMessage`) and can reach nothing but
 * `message`. The expiry, the link, the source and the owner are never in the address.
 *
 * `fortryd` is the announcement version token the ~10 s Fortryd strip is bound to, so the
 * undo a screen offers is bound to *that* write: if somebody else has changed the message
 * since, the restore is refused as stale rather than reversing their change instead.
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
  /** What happened to the optional generated announcement. Never the hours (§7e item 8). */
  announcement: 'besked',
  /** 1ae: the published override whose suggested message is waiting for a decision. */
  conflict: 'konflikt',
  /** The staff member's own wording, carried across the redirect that draws 1ae. */
  suggestion: 'forslag',
  /** The announcement version token the Fortryd strip is bound to. */
  undo: 'fortryd',
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

/**
 * The card's own "Gem og offentliggor" — the control 1ae's sheet is opened from.
 *
 * A dialog that takes focus owes it back (§11), and this administration pays that debt
 * through the address rather than through a script: resolving the sheet is a full
 * navigation to this fragment, and a browser focuses a focusable fragment target when it
 * lands on one. The button therefore carries an id, and only the three exits from 1ae aim
 * at it — every other action on the screen still comes back to the card itself.
 */
export const OVERRIDE_PUBLISH_ANCHOR = `${OVERRIDE_ANCHOR}-offentliggoer`

export type OpeningHoursLocation = {
  /** A save or publish outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** Come back to the editor card. */
  readonly focus?: boolean
  /** Come back to the one-off card instead. */
  readonly overrideFocus?: boolean
  /** Come back to the card's publish button — where 1ae's sheet was opened from (§11). */
  readonly publishFocus?: boolean
  /** Which date the one-off card should show. */
  readonly date?: string | null
  /** Ask the removal confirmation. */
  readonly confirm?: boolean
  /** What happened to the optional generated announcement, from its own closed set. */
  readonly announcement?: string | null
  /** Draw 1ae for this published override's suggested message. */
  readonly conflict?: string | null
  /** The edited wording to carry into 1ae's decision. */
  readonly suggestion?: string | null
  /** Offer Fortryd for the announcement write that returned this version token. */
  readonly undo?: string | null
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
  if (location.announcement) parameters.set(OPENING_HOURS_PARAM.announcement, location.announcement)
  if (location.conflict) parameters.set(OPENING_HOURS_PARAM.conflict, location.conflict)
  if (location.suggestion) parameters.set(OPENING_HOURS_PARAM.suggestion, location.suggestion)
  if (location.undo) parameters.set(OPENING_HOURS_PARAM.undo, location.undo)

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()
  const anchor =
    location.publishFocus === true
      ? `#${OVERRIDE_PUBLISH_ANCHOR}`
      : location.overrideFocus === true
        ? `#${OVERRIDE_ANCHOR}`
        : location.focus === true
          ? `#${EDITOR_ANCHOR}`
          : ''

  return `${OPENING_HOURS_PATH}${query.length > 0 ? `?${query}` : ''}${anchor}`
}
