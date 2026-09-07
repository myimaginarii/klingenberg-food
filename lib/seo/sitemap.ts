import type { MetadataRoute } from 'next'

import { absoluteUrl } from '@/lib/config/site'
import type { NewsArticle } from '@/lib/content/types'
import { newsArticlePath } from '@/lib/news/slug'
import { MAIN_NAV } from '@/lib/site/navigation'

/**
 * What the sitemap contains — technical plan §11, §7f.
 *
 * Pure composition, so membership is a unit-testable fact rather than a route's side
 * effect. `app/sitemap.ts` only reads and concatenates.
 *
 * Two kinds of entry:
 *
 *   * the six public pages, which exist regardless of content, in navigation order;
 *   * one entry per tracked article, at its stable URL, stamped with the article's own
 *     `updatedAt` — never an invented date. There are none yet, so the sitemap carries
 *     six entries; adding an article to `content/site/news.ts` adds its entry here.
 *
 * TRAILING SLASHES. `next.config.ts` sets `trailingSlash: true`, so every page of the
 * static export is a directory with an `index.html` and its address ends in a slash
 * (`/menu/`). A sitemap that advertised `/menu` would name an address the host answers
 * with a redirect, and would disagree with the canonical URLs and the site's own links.
 * {@link canonicalPath} is where that shape is applied, once, to every entry.
 *
 * Every URL is absolute and resolves through `lib/config/site.ts` (§10d) — no literal
 * domain anywhere.
 */

/**
 * A route as the static export actually serves it: the site's own paths, with the
 * trailing slash `trailingSlash: true` gives every page. The root is already `/`.
 */
function canonicalPath(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

/** The six public pages (§11), in navigation order. */
export const STATIC_SITEMAP_PATHS: readonly string[] = MAIN_NAV.map((item) =>
  canonicalPath(item.href),
)

export function staticSitemapEntries(): MetadataRoute.Sitemap {
  // No `lastModified`: nothing in the tracked content states when a static page's
  // wording last moved, and §11's rule for a value the data does not carry is
  // omitted, not invented.
  return STATIC_SITEMAP_PATHS.map((path) => ({ url: absoluteUrl(path) }))
}

export function newsSitemapEntries(
  articles: readonly Pick<NewsArticle, 'slug' | 'updatedAt'>[],
): MetadataRoute.Sitemap {
  return articles.map((article) => ({
    url: absoluteUrl(canonicalPath(newsArticlePath(article.slug))),
    lastModified: new Date(article.updatedAt),
  }))
}

/** The canonical absolute URL of one site path — the same shape the sitemap names. */
export function canonicalUrl(path: string): string {
  return absoluteUrl(canonicalPath(path))
}
