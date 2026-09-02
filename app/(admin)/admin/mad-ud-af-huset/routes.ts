/**
 * The Mad ud af huset screen's addresses — design 1aj; technical plan §3, §15
 * (phase 11B).
 *
 * The route is the one §3 prescribes — `app/(admin)/admin/mad-ud-af-huset/page.tsx`
 * — and no new admin hierarchy is invented around it: the dashboard's tile links
 * here, the bar links back, and that is the whole of the navigation.
 *
 * The same rule every section screen in this administration follows: everything the
 * screen is currently showing is **in the URL**, not in a component's memory. That
 * keeps the whole screen a set of Server Components, lets a Server Action report by
 * redirecting, makes every state linkable and reloadable, and means the editor works
 * with no JavaScript at all.
 *
 * `vaelg_billede` opens the one image picker. It is a *selector*, never authority:
 * the picker's own form carries the version token again, and the Server Action
 * re-reads the document, re-checks the role matrix and re-validates the choice before
 * writing. A hand-typed address can only ever open a chooser.
 */

export const TAKEAWAY_ADMIN_PATH = '/admin/mad-ud-af-huset'

/** The query parameters this screen understands. Anything else is ignored. */
export const TAKEAWAY_PARAM = {
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
  /** `1` while the image picker is open. */
  chooseImage: 'vaelg_billede',
  /**
   * The element a redirect lands on, repeated as a parameter as well as a fragment.
   *
   * Two redirects whose addresses differ only by their fragment — "+ Tilføj
   * tekstafsnit" twice in a row lands on `#tekstafsnit-2` and then `#tekstafsnit-3`
   * — are a hash change to the router, which scrolls without refetching, so the
   * second press would store the section and leave the screen showing the old list
   * (the menu screen's `tapasFocus` records the same trap). The page never reads
   * this parameter; it exists so the address changes.
   */
  focus: 'fokus',
} as const

/** The four cards' anchors, in 1aj's order. */
export const CARD_ANCHOR = {
  visibility: 'vis-siden',
  text: 'tekst',
  sections: 'tekstafsnit',
  cta: 'knap-nederst',
} as const

/** The image slot's control — where a closed picker returns focus. */
export const IMAGE_SLOT_ANCHOR = 'vaelg-billede'

/** The one image picker dialog on the screen. */
export const IMAGE_DIALOG_ANCHOR = 'vaelg-billede-dialog'

/** One section's own block inside the Tekstafsnit card, by position. */
export function sectionAnchor(index: number): string {
  return `${CARD_ANCHOR.sections}-${index + 1}`
}

export type TakeawayLocation = {
  /** A save, image, sections or publish outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** The element to land on — a card, the slot control, a section block. */
  readonly focus?: string | null
  /** Open the image picker. Nothing has happened yet. */
  readonly chooseImage?: boolean
}

/**
 * Build an address on this screen.
 *
 * `extra` carries the field errors and echoed values a refused save comes back with
 * (see `./forms.ts`); it is merged in rather than concatenated, so a caller cannot
 * produce a malformed query string by hand.
 */
export function takeawayHref(location: TakeawayLocation = {}, extra?: URLSearchParams): string {
  const parameters = new URLSearchParams()

  if (location.status) parameters.set(TAKEAWAY_PARAM.status, location.status)
  if (location.chooseImage === true) parameters.set(TAKEAWAY_PARAM.chooseImage, '1')
  if (location.focus) parameters.set(TAKEAWAY_PARAM.focus, location.focus)

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()

  // Most specific first: a chooser is what the person just asked for, and it must be
  // what the browser lands on.
  const anchor = location.chooseImage === true ? IMAGE_DIALOG_ANCHOR : (location.focus ?? null)

  return `${TAKEAWAY_ADMIN_PATH}${query.length > 0 ? `?${query}` : ''}${anchor === null ? '' : `#${anchor}`}`
}
