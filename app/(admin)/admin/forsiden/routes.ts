import type { HomeTextSectionKey } from '@/lib/pages/home'

/**
 * The Forsiden screen's addresses — design 1u; technical plan §3, §15 (phase 11A).
 *
 * The route is the one §3 prescribes — `app/(admin)/admin/forsiden/page.tsx` — and no
 * new admin hierarchy is invented around it: the dashboard's "Rediger forsiden" tile
 * links here, the bar links back, and that is the whole of the navigation.
 *
 * The same rule every section screen in this administration follows: everything the
 * screen is currently showing is **in the URL**, not in a component's memory. That
 * keeps the whole screen a set of Server Components, lets a Server Action report by
 * redirecting, makes every state linkable and reloadable, and means the editor works
 * with no JavaScript at all.
 *
 * Every link and every redirect in this folder is built here, so a parameter cannot
 * be spelled one way by a link and another way by the action that reads it.
 *
 * WHAT IS IN THE ADDRESS, AND WHAT IT MAY DECIDE
 *
 * `vaelg_billede` names which of the three image slots the picker is open for, and
 * `vaelg_ret` names which featured slot the dish picker is open for (or `ny` for the
 * next free one). Both are *selectors*, never authority: the picker's own form carries
 * the section or the slot again, and the Server Action re-reads the document, re-checks
 * the role matrix and re-validates the choice before writing. A hand-typed address can
 * only ever open a chooser.
 */

export const HOME_ADMIN_PATH = '/admin/forsiden'

/** The query parameters this screen understands. Anything else is ignored. */
export const HOME_PARAM = {
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
  /** Which image slot the picker is open for: `hero`, `award` or `about_excerpt`. */
  chooseImage: 'vaelg_billede',
  /** Which featured slot the dish picker is open for: `0`, `1`, `2`, or `ny`. */
  chooseDish: 'vaelg_ret',
} as const

/** The four cards' anchors, in 1u's order. */
export const SECTION_ANCHOR = {
  hero: 'oeverst-paa-siden',
  award: 'udmaerkelsen',
  featured_dish_ids: 'udvalgte-burgere',
  about_excerpt: 'om-os-uddrag',
} as const

/** Each image slot's control — where a closed picker returns focus. */
export function imageSlotAnchor(section: HomeTextSectionKey): string {
  return `vaelg-billede-${SECTION_ANCHOR[section]}`
}

/** The one image picker dialog on the screen (only one slot is ever open at a time). */
export const IMAGE_DIALOG_ANCHOR = 'vaelg-billede-dialog'

/** The dish picker dialog, and the controls that open it. */
export const DISH_DIALOG_ANCHOR = 'vaelg-ret-dialog'
export const FEATURED_ADD_ANCHOR = 'vaelg-ret-ny'

export function featuredSlotAnchor(index: number): string {
  return `vaelg-ret-${index}`
}

/** The value `vaelg_ret` carries for "the next free slot". */
export const NEW_SLOT = 'ny'

export type HomeLocation = {
  /** A save, image, featured or publish outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** The element to land on — a card, a slot control, a dialog. */
  readonly focus?: string | null
  /** Open the image picker for this slot. Nothing has happened yet. */
  readonly chooseImage?: HomeTextSectionKey | null
  /** Open the dish picker for this featured slot, or for the next free one. */
  readonly chooseDish?: number | typeof NEW_SLOT | null
}

/**
 * Build an address on this screen.
 *
 * `extra` carries the field errors and echoed values a refused save comes back with
 * (see `./forms.ts`); it is merged in rather than concatenated, so a caller cannot
 * produce a malformed query string by hand.
 */
export function homeHref(location: HomeLocation = {}, extra?: URLSearchParams): string {
  const parameters = new URLSearchParams()

  if (location.status) parameters.set(HOME_PARAM.status, location.status)
  if (location.chooseImage) parameters.set(HOME_PARAM.chooseImage, location.chooseImage)
  if (location.chooseDish !== undefined && location.chooseDish !== null) {
    parameters.set(HOME_PARAM.chooseDish, String(location.chooseDish))
  }

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()

  // Most specific first: a chooser is what the person just asked for, and it must be
  // what the browser lands on.
  const anchor = location.chooseImage
    ? IMAGE_DIALOG_ANCHOR
    : location.chooseDish !== undefined && location.chooseDish !== null
      ? DISH_DIALOG_ANCHOR
      : (location.focus ?? null)

  return `${HOME_ADMIN_PATH}${query.length > 0 ? `?${query}` : ''}${anchor === null ? '' : `#${anchor}`}`
}
