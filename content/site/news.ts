import type { NewsArticle } from '@/lib/content/types'

/**
 * The published news articles, newest first — design 1j, 1n.
 *
 * There are none yet: the restaurant has not written any, and none is invented. The
 * list page renders its empty state, the Forside's "Seneste nyt" column is absent, the
 * sitemap carries no article and the article route generates no page. An article is
 * one entry here, in the `NewsArticle` shape, with its photograph registered in
 * `photos.json` if it has one.
 */
export const NEWS_ARTICLES: NewsArticle[] = []
