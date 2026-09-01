import type { Metadata } from 'next'

import { absoluteUrl } from '@/lib/config/site'
import type { SeoImage } from '@/lib/images/public'

/**
 * Page titles and descriptions — technical plan §11.
 *
 * Phase 3 put the two things every page must have to be usable: a title in the
 * browser tab and a one-line description. Phase 9B added the news article's own
 * pieces — §7f's self-canonical and the article Open Graph block
 * (`newsArticleMetadata`). The rest of §11 — sitewide canonicals, per-page OG
 * images, the `Restaurant` JSON-LD — is phase 13, and lands here rather than being
 * scattered across the routes.
 *
 * The site is `noindex` until launch (see `app/layout.tsx`), so none of this is
 * published to a search engine yet.
 */

/** "Menu — Klingenberg Food, Carl Nielsen Hallen" (§11). */
const TITLE_SUFFIX = 'Klingenberg Food, Carl Nielsen Hallen'

export function pageMetadata(title: string, description: string): Metadata {
  return {
    title: `${title} — ${TITLE_SUFFIX}`,
    description,
  }
}

/**
 * One published news article — §7f: self-canonical at the frozen slug's stable URL,
 * plus the article Open Graph block, `og:locale = da_DK` (§11).
 *
 * The page's own absolute URL resolves through `lib/config/site.ts` and nowhere else
 * (§10d). The `og:image` (phase 10C-2) is the article's selected library photo — one
 * processed public derivative on the storage origin, chosen by `seoImageOf` so the
 * visible image, this tag and the JSON-LD `image` name the same asset — with the real
 * measured dimensions and the authored description. An article without a selected
 * image carries **no `og:image`**: the branded fallback card §11 names is still an
 * asset the repository does not carry, and §11's rule for a value not supplied in the
 * required form is *omitted, not invented*. When that asset arrives, it lands here.
 *
 * Callers use this only for an article that exists publicly; an unpublished slug
 * 404s with the plain page metadata and no canonical (§7f).
 */
export function newsArticleMetadata(article: {
  readonly title: string
  readonly description: string
  readonly path: string
  /** `display_date` — the published date the page itself shows. Omitted when unset. */
  readonly publishedDate: string | null
  /** `updated_at`. */
  readonly modifiedAt: string
  /** The article's selected image, or `null`/absent for no `og:image` at all. */
  readonly image?: SeoImage | null
}): Metadata {
  const url = absoluteUrl(article.path)
  const image = article.image ?? null

  return {
    ...pageMetadata(article.title, article.description),
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.description,
      url,
      siteName: TITLE_SUFFIX,
      locale: 'da_DK',
      ...(article.publishedDate === null ? {} : { publishedTime: article.publishedDate }),
      modifiedTime: article.modifiedAt,
      ...(image === null
        ? {}
        : {
            images: [
              {
                url: image.url,
                width: image.width,
                height: image.height,
                // The authored description, when there is one; an empty alt is
                // omitted rather than sent as an empty string.
                ...(image.alt.length === 0 ? {} : { alt: image.alt }),
              },
            ],
          }),
    },
  }
}

/** The Forside carries the name alone rather than "Forside — …". */
export function homeMetadata(description: string): Metadata {
  return { title: TITLE_SUFFIX, description }
}
