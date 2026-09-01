import type { MetadataRoute } from 'next'

import { absoluteUrl } from '@/lib/config/site'
import type { NewsArticle } from '@/lib/content/types'
import { newsArticlePath } from '@/lib/news/slug'

/**
 * What the sitemap contains — technical plan §11, §7f; phase 9B.
 *
 * Pure composition, so membership is a unit-testable fact rather than a route's
 * side effect (phase brief §15). `app/sitemap.ts` only reads and concatenates.
 *
 * Two kinds of entry, per §11's own sentence — "the six static pages plus published
 * news detail URLs, with `lastModified` from `updated_at`":
 *
 *   * the six public pages, which exist regardless of content;
 *   * one entry per **published** article, at the frozen slug's stable URL, stamped
 *     with the row's own `updated_at` — never an invented date. The published-only
 *     rule is not re-decided here: the caller hands this function the public read's
 *     result, and `news_select_public` (RLS) is what that read can see. Unpublishing
 *     therefore removes the entry on the next request the same way it removes the
 *     page (§7f), and republishing returns the same URL, because the slug is frozen.
 *
 * Every URL is absolute and resolves through `lib/config/site.ts` (§10d) — no
 * literal domain anywhere.
 */

/** The six public pages (§11). `/admin` and `/api` are deliberately absent. */
export const STATIC_SITEMAP_PATHS = [
  '/',
  '/menu',
  '/nyheder',
  '/om-os',
  '/find-os',
  '/mad-ud-af-huset',
] as const

export function staticSitemapEntries(): MetadataRoute.Sitemap {
  // No `lastModified`: nothing stored states when a static page's content moved,
  // and §11's rule for a value the data does not carry is omitted, not invented.
  return STATIC_SITEMAP_PATHS.map((path) => ({ url: absoluteUrl(path) }))
}

export function newsSitemapEntries(
  articles: readonly Pick<NewsArticle, 'slug' | 'updatedAt'>[],
): MetadataRoute.Sitemap {
  return articles.map((article) => ({
    url: absoluteUrl(newsArticlePath(article.slug)),
    lastModified: new Date(article.updatedAt),
  }))
}
