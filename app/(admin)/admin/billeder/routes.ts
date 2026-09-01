/**
 * The image library's addresses — design 1w; phase 10B.
 *
 * Which image is open, whether its deletion is being confirmed, whether the
 * replace panel is showing, and what the last action did are **in the URL** — the
 * same rule every section screen states (`app/(admin)/admin/menu/routes.ts`) and
 * for the same reasons: Server Components with no client state, Server Actions
 * that report by redirecting, a screen that can be linked, reloaded and gone back
 * to. The upload itself is the one flow that is client-driven (a signed PUT cannot
 * be a form post), and it reports by navigating here too, so its outcome is an
 * address like every other outcome.
 *
 * Every link and every redirect in this folder is built here, so a parameter
 * cannot be spelled one way by a link and another way by the action that reads it.
 */

export const IMAGES_PATH = '/admin/billeder'

/** The query parameters this screen understands. Anything else is ignored. */
export const IMAGES_PARAM = {
  /** The image whose detail panel is open, by id. */
  image: 'billede',
  /** The image whose deletion is being confirmed (1w: Slet spørger altid). */
  confirmDelete: 'slet',
  /** The image whose replace panel is open (1w's Erstat). Nothing has happened yet. */
  replace: 'erstat',
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
} as const

/** The uploader's file input — where the bar's and the grid's "+ Upload" land. */
export const UPLOAD_INPUT_ANCHOR = 'billede-upload'

/** The detail panel, so opening an image scrolls and tabs to it. */
export const DETAIL_ANCHOR = 'billede-detalje'

/** The footer controls and their confirmations — the focus-return addresses. */
export const DELETE_BUTTON_ANCHOR = 'slet-billede'
export const DELETE_DIALOG_ANCHOR = 'slet-bekraeft'
export const REPLACE_BUTTON_ANCHOR = 'erstat-billede'
export const REPLACE_PANEL_ANCHOR = 'erstat-panel'

export type ImagesLocation = {
  /** The image to open the detail panel for. */
  readonly image?: string | null
  /** An action outcome, from the closed set the actions define. */
  readonly status?: string | null
  /** Open the deletion confirmation for this image. Nothing has happened yet. */
  readonly confirmDelete?: string | null
  /** Open the replace panel for this image. Nothing has happened yet. */
  readonly replace?: string | null
  /** Land on the named control instead of the panel — a confirmation's way back. */
  readonly focus?: 'delete' | 'replace' | 'upload' | null
}

/**
 * Build an image-library address. `extra` carries an echoed alt text and its error
 * codes back from a refused save (`./image-form.ts`). The fragment is derived from
 * the location, most specific first — never let two redirect targets differ only
 * by their fragment.
 */
export function imagesHref(location: ImagesLocation = {}, extra?: URLSearchParams): string {
  const parameters = new URLSearchParams()

  if (location.image) parameters.set(IMAGES_PARAM.image, location.image)
  if (location.status) parameters.set(IMAGES_PARAM.status, location.status)
  if (location.confirmDelete) parameters.set(IMAGES_PARAM.confirmDelete, location.confirmDelete)
  if (location.replace) parameters.set(IMAGES_PARAM.replace, location.replace)

  const anchor = location.confirmDelete
    ? DELETE_DIALOG_ANCHOR
    : location.replace
      ? REPLACE_PANEL_ANCHOR
      : location.focus === 'delete'
        ? DELETE_BUTTON_ANCHOR
        : location.focus === 'replace'
          ? REPLACE_BUTTON_ANCHOR
          : location.focus === 'upload'
            ? UPLOAD_INPUT_ANCHOR
            : location.image
              ? DETAIL_ANCHOR
              : null

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()

  return `${IMAGES_PATH}${query.length > 0 ? `?${query}` : ''}${anchor === null ? '' : `#${anchor}`}`
}
