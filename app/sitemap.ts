import type { MetadataRoute } from 'next'

import { readPublishedNews } from '@/lib/content/news'
import { readHiddenPageKeys } from '@/lib/content/pages'
import { newsSitemapEntries, staticSitemapEntries } from '@/lib/seo/sitemap'

/**
 * `/sitemap.xml` — technical plan §11, §7f; phase 9B.
 *
 * A reader and a concatenation: what the sitemap *contains* is `lib/seo/sitemap.ts`,
 * pure and unit-pinned. The news read is the same tagged public read every page
 * uses, so the sitemap obeys the same cache contract (§20): publishing, a published
 * edit, unpublishing and republishing expire the `news` tag, and the **first**
 * request after any of them reads the new membership — §7f's "unpublishing removes
 * an article from the sitemap", by the same mechanism that removes the page.
 *
 * The route revalidates on the public five-minute safety net (§7a), stated as a
 * literal because Next.js requires one — the same number as
 * `PUBLIC_REVALIDATE_SECONDS` and `app/(site)/layout.tsx`, changed together.
 */
export const revalidate = 300

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The hidden-page read is the same `page:takeaway`-tagged read the navigation
  // uses (phase 11B), so publishing Mad ud af huset's switch expires this route too.
  const [articles, hiddenPageKeys] = await Promise.all([readPublishedNews(), readHiddenPageKeys()])

  return [...staticSitemapEntries(hiddenPageKeys), ...newsSitemapEntries(articles)]
}
