import type { MetadataRoute } from 'next'

import { loadNews } from '@/lib/content/load/news'
import { newsSitemapEntries, staticSitemapEntries } from '@/lib/seo/sitemap'

/**
 * `/sitemap.xml` — technical plan §11, §7f.
 *
 * A concatenation: what the sitemap *contains* is `lib/seo/sitemap.ts`, pure and
 * unit-pinned — the six public pages plus one entry per published article. Prerendered
 * with the rest of the static export from the same content the pages read.
 */
/** A route handler must say it is static for the export to prerender it (`sitemap.xml`). */
export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return [...staticSitemapEntries(), ...newsSitemapEntries(loadNews())]
}
