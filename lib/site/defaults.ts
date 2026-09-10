/**
 * The Om os page's default headings — design 1i.
 *
 * A tracked document may leave a heading unset; these are what the page prints in its
 * place. They live here, beside the navigation, because they are public-site
 * vocabulary rather than content: `content/site/pages/about.json` leaves a heading
 * out to mean "use the page's own wording", and this is that wording, stated once.
 * Mad ud af huset's call to action has no default: its label is the restaurant's own
 * words and is required in `content/site/pages/takeaway.json`.
 */

/** The Om os page's own title when the document sets none. */
export const ABOUT_DEFAULT_HEADING = 'Om os'

/** The heading above the method section when the document sets none. */
export const ABOUT_DEFAULT_METHOD_HEADING = 'Sådan laver vi burgere'
