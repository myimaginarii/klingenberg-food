import type { NewsArticle } from '@/lib/content/types'

/**
 * The one- or two-line teaser the news list and the Forside card show, from the
 * article's first paragraph. Pure, and the one statement of the rule.
 */
export function articleExcerpt(article: NewsArticle): string | null {
  const first = article.body.blocks[0]
  if (first === undefined) return null

  const text = first.text.trim()
  return text.length > 0 ? text : null
}
