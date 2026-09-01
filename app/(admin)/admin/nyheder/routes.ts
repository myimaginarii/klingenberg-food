/**
 * The news administration's addresses — design 1s / 1z; phase 9A.
 *
 * Which article is open, whether a new one is being written, and which confirmation
 * is on screen are **in the URL**, not in a component's memory — the same rule
 * `app/(admin)/admin/menu/routes.ts` states and for the same four reasons: Server
 * Components with no client state, Server Actions that report by redirecting, an
 * editor that can be linked, reloaded and gone back to, and a screen that works with
 * no JavaScript at all on the phone §15 calls the primary admin device.
 *
 * Every link and every redirect in this folder is built here, so a parameter cannot
 * be spelled one way by a link and another way by the action that reads it.
 */

export const NEWS_PATH = '/admin/nyheder'

/** The query parameters this screen understands. Anything else is ignored. */
export const NEWS_PARAM = {
  /** The article whose editor is open, by id. */
  article: 'nyhed',
  /** Present when the editor is open for an article that does not exist yet. */
  creating: 'ny',
  /** The outcome of the last action, as a closed set of codes. */
  status: 'status',
  /**
   * The article whose publish confirmation is open (1s: "Offentliggør åbner en lille
   * bekræftelse"). A **link**, not a button: pressing Offentliggør navigates here and
   * nothing has happened yet — the publish itself is a form inside the confirmation,
   * carrying the version token the server rendered. The id is not authority: the
   * confirmation renders only for an article the server resolved, and the action
   * re-authorizes, re-resolves and re-checks the version regardless.
   */
  confirmPublish: 'offentliggoer',
  /** The article whose "Fjern fra hjemmesiden" confirmation is open (§7f). */
  confirmUnpublish: 'fjern',
  /** The article whose deletion is being confirmed. Slet spørger altid (1s, 1r). */
  confirmDelete: 'slet',
} as const

/**
 * The editor's anchor. Opening it is a navigation, so the browser scrolls to the form
 * and puts it next in the tab order — no focus management to write (the menu screen's
 * own mechanism).
 */
export const EDITOR_ANCHOR = 'nyhed-editor'

/** The editor `<form>`'s element id — how the bar's autosave controller finds it (9B). */
export const EDITOR_FORM_ID = 'nyhed-editor-form'

/**
 * The three footer controls and their confirmations. Cancelling a confirmation is a
 * navigation back to the control it was opened from, so the keyboard lands where it
 * started — with or without JavaScript.
 */
export const PUBLISH_BUTTON_ANCHOR = 'offentliggoer-nyhed'
export const PUBLISH_DIALOG_ANCHOR = 'offentliggoer-bekraeft'
export const UNPUBLISH_BUTTON_ANCHOR = 'fjern-nyhed'
export const UNPUBLISH_DIALOG_ANCHOR = 'fjern-bekraeft'
export const DELETE_BUTTON_ANCHOR = 'slet-nyhed'
export const DELETE_DIALOG_ANCHOR = 'slet-bekraeft'

export type NewsLocation = {
  /** The article to open the editor for. */
  readonly article?: string | null
  /** Open the editor for a new article. */
  readonly creating?: boolean
  /** An action outcome, from the closed set each action defines. */
  readonly status?: string | null
  /** Open the publish confirmation for this article. Nothing has happened yet. */
  readonly confirmPublish?: string | null
  /** Open the unpublish confirmation for this article. Nothing has happened yet. */
  readonly confirmUnpublish?: string | null
  /** Open the deletion confirmation for this article. Nothing has happened yet. */
  readonly confirmDelete?: string | null
  /** Land on the named footer control instead of the editor — a confirmation's way back. */
  readonly focus?: 'publish' | 'unpublish' | 'delete' | null
}

/**
 * Build a news-administration address.
 *
 * `extra` carries the field errors and the echoed values a refused save comes back
 * with (see `./article-form.ts`). The fragment is derived from the location — most
 * specific first — and the menu screen's rule holds here too: never let two redirect
 * targets differ only by their fragment.
 */
export function newsHref(location: NewsLocation = {}, extra?: URLSearchParams): string {
  const parameters = new URLSearchParams()

  if (location.article) parameters.set(NEWS_PARAM.article, location.article)
  if (location.creating === true) parameters.set(NEWS_PARAM.creating, '1')
  if (location.status) parameters.set(NEWS_PARAM.status, location.status)
  if (location.confirmPublish) parameters.set(NEWS_PARAM.confirmPublish, location.confirmPublish)
  if (location.confirmUnpublish)
    parameters.set(NEWS_PARAM.confirmUnpublish, location.confirmUnpublish)
  if (location.confirmDelete) parameters.set(NEWS_PARAM.confirmDelete, location.confirmDelete)

  const editorOpen = Boolean(location.article) || location.creating === true

  const anchor = location.confirmPublish
    ? PUBLISH_DIALOG_ANCHOR
    : location.confirmUnpublish
      ? UNPUBLISH_DIALOG_ANCHOR
      : location.confirmDelete
        ? DELETE_DIALOG_ANCHOR
        : location.focus === 'publish'
          ? PUBLISH_BUTTON_ANCHOR
          : location.focus === 'unpublish'
            ? UNPUBLISH_BUTTON_ANCHOR
            : location.focus === 'delete'
              ? DELETE_BUTTON_ANCHOR
              : editorOpen
                ? EDITOR_ANCHOR
                : null

  if (extra !== undefined) {
    for (const [key, value] of extra) parameters.append(key, value)
  }

  const query = parameters.toString()

  return `${NEWS_PATH}${query.length > 0 ? `?${query}` : ''}${anchor === null ? '' : `#${anchor}`}`
}
