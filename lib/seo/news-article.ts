import { absoluteUrl } from '@/lib/config/site'
import type { NewsArticle } from '@/lib/content/types'
import { newsArticlePath } from '@/lib/news/slug'

/**
 * The `NewsArticle` JSON-LD block for `/nyheder/[slug]` — technical plan §7f, §11;
 * phase 9B.
 *
 * Built here rather than in JSX, so the shape is a value a unit test can hold still
 * (phase brief §13). The rules, all three from §11's own line — *"generated from
 * published database values so it can never drift from the page"* and *"Nothing
 * invented"*:
 *
 *   * every field restates a stored value the page itself renders: `headline` is the
 *     title, `datePublished` is `display_date` (the date printed on the article),
 *     `dateModified` is `updated_at`, and the URL is the frozen slug under the
 *     configured site origin (`lib/config/site.ts` — never a literal, §10d);
 *   * a value the database does not have is **absent**, not guessed: no
 *     `datePublished` for an article without a display date, no `image` while photos
 *     are phase 10, no author, and a publisher of exactly the restaurant's name —
 *     no logo object, because none is supplied in the required form yet (§11's
 *     "Omitted until supplied");
 *   * the caller renders it only for a published article on the public path — a
 *     draft article 404s before this module is ever asked (§7f).
 *
 * `serializeJsonLd` escapes `<`, `>` and `&` as JSON `\uXXXX` sequences — equal JSON,
 * different bytes — so the output cannot close a `<script>` element early no matter
 * what a title says, and needs no `dangerouslySetInnerHTML` (§8 forbids it) because
 * the serialized string contains nothing React's own text escaping would rewrite.
 */

/** §11's publisher: the restaurant, by name. Nothing invented beside it. */
const PUBLISHER_NAME = 'Klingenberg Food'

export type NewsArticleJsonLd = {
  readonly '@context': 'https://schema.org'
  readonly '@type': 'NewsArticle'
  readonly mainEntityOfPage: string
  readonly headline: string
  readonly datePublished?: string
  readonly dateModified: string
  readonly publisher: { readonly '@type': 'Organization'; readonly name: string }
}

export function newsArticleJsonLd(
  article: Pick<NewsArticle, 'title' | 'slug' | 'displayDate' | 'updatedAt'>,
): NewsArticleJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    mainEntityOfPage: absoluteUrl(newsArticlePath(article.slug)),
    headline: article.title,
    ...(article.displayDate === null ? {} : { datePublished: article.displayDate }),
    dateModified: article.updatedAt,
    publisher: { '@type': 'Organization', name: PUBLISHER_NAME },
  }
}

/**
 * JSON for a `<script type="application/ld+json">` rendered as an ordinary React
 * text child. `<`, `>` and `&` become `\uXXXX` escapes, which `JSON.parse` reads back
 * identically — asserted in the unit suite.
 */
export function serializeJsonLd(value: object): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    const code = character.codePointAt(0) ?? 0
    return `\\u${code.toString(16).padStart(4, '0')}`
  })
}
