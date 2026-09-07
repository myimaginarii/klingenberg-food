import type { NewsArticle } from '@/lib/content/types'

/**
 * The one- or two-line teaser the news list and the Forside card show, from the
 * article's first paragraph. Pure: the same rule for the static site and for the
 * administration's read layer, which re-exports it.
 */
export function articleExcerpt(article: NewsArticle): string | null {
  const first = article.body.blocks[0]
  if (first === undefined) return null

  const text = first.spans.map((span) => span.text).join('').trim()
  return text.length > 0 ? text : null
}
