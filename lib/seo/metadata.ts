import type { Metadata } from 'next'

import { absoluteAssetUrl } from '@/lib/config/site'
import type { SeoImage } from '@/lib/images/public'
import { canonicalUrl } from '@/lib/seo/sitemap'

/**
 * Page titles, descriptions, canonical URLs and the social card — technical plan §11.
 *
 * One builder for every public page, so a page cannot have a title without a canonical
 * URL, or an Open Graph block that disagrees with the `<title>` above it. A news
 * article carries more (§7f's self-canonical and the article Open Graph block), and
 * that is the one variant: {@link newsArticleMetadata}.
 *
 * THE TITLE PATTERN is `Menu | Klingenberg Food` — one separator, used everywhere, and
 * the business name rather than the business name plus the venue. The venue is named in
 * the descriptions, in `og:site_name` and in the structured data (`lib/seo/restaurant.ts`),
 * which is where a machine reads it; repeating it in six titles only spent the width a
 * result has. The Forside is the exception, because it is the page that has to say what
 * the business *is*: `Klingenberg Food | Burgerbar i Carl Nielsen Hallen`, in the
 * approved copy's own words ("Burgerbaren i Carl Nielsen Hallen").
 *
 * EVERY ABSOLUTE URL — the canonical, `og:url`, the share image — resolves through
 * `lib/config/site.ts` and nowhere else (§10d), so the Netlify address today and the
 * restaurant's own domain later are the same code.
 *
 * The site is `noindex, nofollow` until launch (`app/layout.tsx`), so none of this is
 * published to a search engine yet. Canonical URLs and Open Graph are correct
 * regardless: a crawler that is allowed in must read one address per page, and a link
 * pasted into a message renders its card whether or not the page is indexable.
 */

/** The business, as every title, `og:site_name` and the structured data name it. */
export const SITE_NAME = 'Klingenberg Food'

/** The Forside's own title: the business, and what it is. */
export const HOME_TITLE = 'Klingenberg Food | Burgerbar i Carl Nielsen Hallen'

/** `og:locale` — Danish, as spoken in Denmark. */
const OG_LOCALE = 'da_DK'

/** A page's share image, or `null` when the page has none to offer. */
type ShareImage = SeoImage | null

/**
 * The Open Graph `images` array for one processed derivative, or `undefined` for a page
 * with no image at all — omitted, never an empty array and never a guessed asset.
 *
 * THE URL IS ABSOLUTE HERE, not left for `metadataBase` to complete. Next.js does not
 * resolve a site-relative image URL the way `new URL()` would: it *joins*
 * `metadataBase`'s pathname onto the front of it. On a deployment served at the root of
 * a host the two are the same thing, but under a sub-path — the GitHub Pages project
 * site kept as the rollback — a path that already carries the base path comes back out
 * carrying it twice (`/klingenberg-food/klingenberg-food/media/…`), pointing at a file
 * that does not exist. `absoluteAssetUrl` puts the origin in front of a path that is
 * already complete, and Next leaves an absolute URL alone, so both deployments print the
 * one right address. The structured data resolves the same asset the same way.
 *
 * An empty authored description is left out rather than sent as `alt=""`: §11's rule for
 * a value not supplied in the required form is *omitted, not invented*.
 */
function shareImages(image: ShareImage) {
  if (image === null) return undefined

  return [
    {
      url: absoluteAssetUrl(image.url),
      width: image.width,
      height: image.height,
      ...(image.alt.length === 0 ? {} : { alt: image.alt }),
    },
  ]
}

type SocialInput = {
  /** The full document title — the same string the `<title>` carries. */
  readonly title: string
  readonly description: string
  /** The site path this page is served at, as this repository writes it (`/menu`). */
  readonly path: string
  readonly image: ShareImage
}

/**
 * Title, description, canonical URL, Open Graph and the Twitter card for one page.
 *
 * `og:title` is the document title rather than a second wording of it, so a share card
 * and a search result cannot drift apart. The card is `summary_large_image` when there
 * is a photograph and the plain `summary` when there is not — a large-image card with
 * no image renders as an empty box.
 */
function socialMetadata({ title, description, path, image }: SocialInput): Metadata {
  const url = canonicalUrl(path)
  const images = shareImages(image)

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: OG_LOCALE,
      ...(images === undefined ? {} : { images }),
    },
    twitter: {
      // No `site` or `creator`: the restaurant has no Twitter/X account, and inventing
      // one would attribute the page to somebody else's handle.
      card: images === undefined ? 'summary' : 'summary_large_image',
      title,
      description,
      ...(images === undefined ? {} : { images }),
    },
  }
}

/** One of the five inner public pages: `Menu | Klingenberg Food`, and its canonical URL. */
export function pageMetadata(
  title: string,
  description: string,
  options: { readonly path: string; readonly image?: ShareImage },
): Metadata {
  return socialMetadata({
    title: `${title} | ${SITE_NAME}`,
    description,
    path: options.path,
    image: options.image ?? null,
  })
}

/** The Forside — the name and what it is, rather than "Forside — …". */
export function homeMetadata(
  description: string,
  options: { readonly image?: ShareImage } = {},
): Metadata {
  return socialMetadata({
    title: HOME_TITLE,
    description,
    path: '/',
    image: options.image ?? null,
  })
}

/**
 * A page that is about to answer 404 — a title and a description, and deliberately
 * **no canonical URL and no Open Graph block**: an address that names nothing must not
 * claim to be a page, and must not hand a messaging app a card for it.
 */
export function unindexedMetadata(title: string, description: string): Metadata {
  return { title: `${title} | ${SITE_NAME}`, description }
}

/**
 * One published news article — §7f: self-canonical at the frozen slug's stable URL,
 * plus the article Open Graph block, `og:locale = da_DK` (§11).
 *
 * The page's own absolute URL is the canonical one the sitemap also names
 * (`lib/seo/sitemap.ts`, trailing slash and all), which resolves through
 * `lib/config/site.ts` and nowhere else (§10d). The `og:image` (phase 10C-2) is the
 * article's selected library photo — one processed public derivative, chosen by
 * `seoImageOf` so the visible image, this tag and the JSON-LD `image` name the same
 * asset — with the real measured dimensions and the authored description.
 *
 * `og:title` is the headline alone rather than the document title: a share card already
 * carries `og:site_name` under it, and an article's card reads as the headline.
 *
 * An article without a selected image carries **no `og:image`**: the branded fallback
 * card §11 names is still an asset the repository does not carry, and §11's rule for a
 * value not supplied in the required form is *omitted, not invented*. It does not fall
 * back to the site's own share photograph either — a burger card under somebody's
 * closing-day notice would be a picture of something else.
 *
 * Callers use this only for an article that exists publicly; an unpublished slug
 * 404s with {@link unindexedMetadata} and no canonical (§7f).
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
  const image = article.image ?? null
  const base = socialMetadata({
    title: `${article.title} | ${SITE_NAME}`,
    description: article.description,
    path: article.path,
    image,
  })
  const images = shareImages(image)

  return {
    ...base,
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.description,
      url: canonicalUrl(article.path),
      siteName: SITE_NAME,
      locale: OG_LOCALE,
      ...(article.publishedDate === null ? {} : { publishedTime: article.publishedDate }),
      modifiedTime: article.modifiedAt,
      ...(images === undefined ? {} : { images }),
    },
  }
}
