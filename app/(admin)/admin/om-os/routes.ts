import type { AboutImageSlot } from '@/lib/pages/about'

/**
 * The Om os screen's addresses — design 1i (the page it edits); technical plan §3,
 * §15 (phase 14B1).
 *
 * The route is `app/(admin)/admin/om-os/page.tsx`, and no new admin hierarchy is
 * invented around it: the dashboard's "Om os" tile links here, the bar links back, and
 * that is the whole of the navigation. The phase-4 `/admin/indhold` screen, which
 * carried Om os as its last form, is gone: two editors for one document would be two
 * saving conventions for the same draft (§0aa's reason for retiring it for the other
 * two pages).
 *
 * The same rule every section screen in this administration follows: everything the
 * screen is currently showing is **in the URL**, not in a component's memory. That
 * keeps the whole screen a set of Server Components, lets a Server Action report by
 * redirecting, makes every state linkable and reloadable, and means the editor works
 * with no JavaScript at all.
 *
 * `vaelg_billede` names which of the three image slots the picker is open for. It is a
 * *selector*, never authority: the picker's own form carries the slot again, and the
 * Server Action re-reads the document, re-checks the role matrix and re-validates the
 * choice before writing. A hand-typed address can only ever open a chooser.
 */

export const ABOUT_ADMIN_PATH = '/admin/om-os'

/** The query parameters this screen understands. Anything else is ignored. */
export const ABOUT_PARAM = {
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
  /** Which image slot the picker is open for: `sted`, `holdet` or `koekken`. */
  chooseImage: 'vaelg_billede',
  /**
   * The element a redirect lands on, repeated as a parameter as well as a fragment, so
   * two redirects that differ only by their fragment are still two addresses to the
   * router (the Mad ud af huset screen's `fokus`). The page never reads it.
   */
  focus: 'fokus',
} as const

/** The three cards' anchors, in 1i's page order. */
export const CARD_ANCHOR = {
  story: 'historien',
  team: 'holdet',
  method: 'koekken-og-tilberedning',
} as const

/** Each image slot's control — where a closed picker returns focus. */
export function imageSlotAnchor(slot: AboutImageSlot): string {
  return `vaelg-billede-${slot}`
}

/** The one image picker dialog on the screen (only one slot is ever open at a time). */
export const IMAGE_DIALOG_ANCHOR = 'vaelg-billede-dialog'

export type AboutLocation = {
  /** A save, image or publish outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** The element to land on — a card, a slot control. */
  readonly focus?: string | null
  /** Open the image picker for this slot. Nothing has happened yet. */
  readonly chooseImage?: AboutImageSlot | null
}

/**
 * Build an address on this screen.
 *
 * `extra` carries the field errors and echoed values a refused save comes back with
 * (see `./forms.ts`); it is merged in rather than concatenated, so a caller cannot
 * produce a malformed query string by hand.
 */
export function aboutHref(location: AboutLocation = {}, extra?: URLSearchParams): string {
  const parameters = new URLSearchParams()

  if (location.status) parameters.set(ABOUT_PARAM.status, location.status)
  if (location.chooseImage) parameters.set(ABOUT_PARAM.chooseImage, location.chooseImage)
  if (location.focus) parameters.set(ABOUT_PARAM.focus, location.focus)

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()

  // Most specific first: a chooser is what the person just asked for, and it must be
  // what the browser lands on.
  const anchor = location.chooseImage ? IMAGE_DIALOG_ANCHOR : (location.focus ?? null)

  return `${ABOUT_ADMIN_PATH}${query.length > 0 ? `?${query}` : ''}${anchor === null ? '' : `#${anchor}`}`
}
