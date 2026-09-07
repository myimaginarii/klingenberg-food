/**
 * The public pages' default headings and labels — design 1i (Om os) and 1aj (Mad ud af
 * huset).
 *
 * A tracked document may leave a heading or a button label unset; these are what the
 * page prints in its place. They live here, beside the navigation, because they are
 * public-site vocabulary rather than content: `content/site/pages.ts` sets `null` to
 * mean "use the page's own wording", and this is that wording, stated once.
 */

/** The Om os page's own title when the document sets none. */
export const ABOUT_DEFAULT_HEADING = 'Om os'

/** The heading above the method section when the document sets none. */
export const ABOUT_DEFAULT_METHOD_HEADING = 'Sådan laver vi burgere'

/** The Mad ud af huset call to action when the document sets no label. */
export const TAKEAWAY_DEFAULT_CTA_LABEL = 'Ring og hør mere'
