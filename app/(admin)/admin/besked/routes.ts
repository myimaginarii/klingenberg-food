/**
 * The Besked screen's addresses — design 1ad.
 *
 * The same rule every section screen in this administration follows
 * (`../menu/routes.ts`, `../menu/ugens-ret/routes.ts`, `../menu/maanedens-burger/routes.ts`):
 * everything the screen is currently showing is **in the URL**, not in a component's
 * memory. That keeps the whole screen a set of Server Components, lets a Server Action
 * report by redirecting, makes every state linkable and reloadable, and means the editor
 * works with no JavaScript at all — which matters on the phone §15 calls the primary
 * admin device.
 *
 * Every link and every redirect in this folder is built here, so a parameter cannot be
 * spelled one way by a link and another way by the action that reads it.
 */

export const ANNOUNCEMENT_PATH = '/admin/besked'

/** The query parameters this screen understands. Anything else is ignored. */
export const ANNOUNCEMENT_PARAM = {
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
} as const

/**
 * The editor's anchor.
 *
 * A save redirects back to it, so the browser scrolls there and the tab order continues
 * from the card — the same "fragment instead of focus management" the other section
 * screens use.
 */
export const EDITOR_ANCHOR = 'besked'

export type AnnouncementLocation = {
  /** A save or publish outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** Come back to the editor card. */
  readonly focus?: boolean
}

/**
 * Build an address on this screen.
 *
 * `extra` carries the field errors and echoed values a refused save comes back with
 * (see `./forms.ts`); it is merged in rather than concatenated, so a caller cannot
 * produce a malformed query string by hand.
 */
export function announcementHref(
  location: AnnouncementLocation = {},
  extra?: URLSearchParams,
): string {
  const parameters = new URLSearchParams()

  if (location.status) parameters.set(ANNOUNCEMENT_PARAM.status, location.status)

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()
  const anchor = location.focus === true ? `#${EDITOR_ANCHOR}` : ''

  return `${ANNOUNCEMENT_PATH}${query.length > 0 ? `?${query}` : ''}${anchor}`
}
