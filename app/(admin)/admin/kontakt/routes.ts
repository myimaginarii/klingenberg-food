/**
 * The Kontaktoplysninger screen's addresses — design 1v; technical plan §3, §15
 * (phase 11B).
 *
 * The route is the one §3 prescribes — `app/(admin)/admin/kontakt/page.tsx`. The
 * same rule every section screen follows: everything the screen shows is in the URL,
 * so a Server Action reports by redirecting and the editor works with no JavaScript.
 */

export const CONTACT_ADMIN_PATH = '/admin/kontakt'

/** The query parameters this screen understands. Anything else is ignored. */
export const CONTACT_PARAM = {
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
} as const

/** The editor card's anchor, where a save comes back to. */
export const CONTACT_EDITOR_ANCHOR = 'kontaktoplysninger'

export type ContactLocation = {
  readonly status?: string | null
  readonly focus?: boolean
}

/**
 * Build an address on this screen. `extra` carries the field errors and echoed values
 * a refused save comes back with (see `./forms.ts`).
 */
export function contactHref(location: ContactLocation = {}, extra?: URLSearchParams): string {
  const parameters = new URLSearchParams()

  if (location.status) parameters.set(CONTACT_PARAM.status, location.status)

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()
  const anchor = location.focus === true ? `#${CONTACT_EDITOR_ANCHOR}` : ''

  return `${CONTACT_ADMIN_PATH}${query.length > 0 ? `?${query}` : ''}${anchor}`
}
