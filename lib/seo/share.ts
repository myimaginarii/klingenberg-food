import { loadAboutPage, loadHomePage } from '@/lib/content/load/pages'
import { seoImageOf, type PublicImage, type SeoImage } from '@/lib/images/public'

/**
 * The photograph a shared link shows — brief §16, phase 2 of the CMS migration.
 *
 * A page's share card is a picture of that page, so it is the page's *own* photograph
 * rather than an entry in a registry of social assets: the Forside's hero for the
 * Forside, the dining room for Om os, the sandwiches for Mad ud af huset. Nothing was
 * shot for social, and no branded fallback card exists — §11 names one, and it is
 * still an asset the repository does not carry.
 *
 * Two pages are *about* the restaurant without having a photograph of their own — the
 * menu and the news list — and both show the Forside's hero. That is stated once here
 * rather than three times across the pages, and it follows the content: change the
 * Forside's hero photograph and every one of those cards changes with it.
 *
 * The derivative each card names is `seoImageOf`'s, so the visible photograph, the
 * `og:image` and the JSON-LD `image` are one asset.
 */

/** The SEO derivative of a page's photograph, or `null` when the page has none. */
export function shareImage(image: PublicImage | null): SeoImage | null {
  return image === null ? null : seoImageOf(image)
}

/** The site's own card: the Forside's hero, for a page with no photograph of its own. */
export function siteShareImage(): SeoImage | null {
  return shareImage(loadHomePage().hero.image)
}

/** Om os's photograph, which Find os shares — one venue, one picture of it. */
export function venueShareImage(): SeoImage | null {
  return shareImage(loadAboutPage().venueImage)
}
