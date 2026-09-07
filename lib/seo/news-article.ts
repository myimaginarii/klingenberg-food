import { absoluteAssetUrl } from '@/lib/config/site'
import type { NewsArticle } from '@/lib/content/types'
import { seoImageOf } from '@/lib/images/public'
import { newsArticlePath } from '@/lib/news/slug'
import { canonicalUrl } from '@/lib/seo/sitemap'

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
 *     `datePublished` for an article without a display date, no `image` for an
 *     article without a selected photo, no author, and a publisher of exactly the
 *     restaurant's name — no logo object, because none is supplied in the required
 *     form yet (§11's "Omitted until supplied");
 *   * the `image` (phase 10C-2) is an `ImageObject` over the same public derivative
 *     the page's `og:image` names (`seoImageOf` — one asset, one choice), with the
 *     rung's measured width and height and nothing else;
 *   * the caller renders it only for a published article on the public path — a
 *     draft article 404s before this module is ever asked (§7f).
 *
 * The block is rendered through `serializeJsonLd` (`lib/seo/json-ld.ts`), which is
 * shared with the `Restaurant` block and is where the `<script>`-safety rule lives.
 */

/** §11's publisher: the restaurant, by name. Nothing invented beside it. */
const PUBLISHER_NAME = 'Klingenberg Food'

export type NewsArticleJsonLdImage = {
  readonly '@type': 'ImageObject'
  readonly url: string
  readonly width: number
  readonly height: number
}

export type NewsArticleJsonLd = {
  readonly '@context': 'https://schema.org'
  readonly '@type': 'NewsArticle'
  readonly mainEntityOfPage: string
  readonly headline: string
  readonly image?: NewsArticleJsonLdImage
  readonly datePublished?: string
  readonly dateModified: string
  readonly publisher: { readonly '@type': 'Organization'; readonly name: string }
}

export function newsArticleJsonLd(
  article: Pick<NewsArticle, 'title' | 'slug' | 'displayDate' | 'updatedAt' | 'image'>,
): NewsArticleJsonLd {
  const image = article.image === null ? null : seoImageOf(article.image)

  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    mainEntityOfPage: canonicalUrl(newsArticlePath(article.slug)),
    headline: article.title,
    ...(image === null
      ? {}
      : {
          image: {
            '@type': 'ImageObject',
            // Absolute: a JSON-LD block is plain text, with no `metadataBase` behind it
            // to resolve a site-relative path the way the `og:image` tag gets one.
            url: absoluteAssetUrl(image.url),
            width: image.width,
            height: image.height,
          },
        }),
    ...(article.displayDate === null ? {} : { datePublished: article.displayDate }),
    dateModified: article.updatedAt,
    publisher: { '@type': 'Organization', name: PUBLISHER_NAME },
  }
}
