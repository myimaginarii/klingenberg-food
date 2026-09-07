import type { NewsArticle, NewsBody } from '@/lib/content/types'
import { isNewsSlug } from '@/lib/news/slug'
import type { IsoDate } from '@/lib/time/calendar'

import { resolvePhoto } from './photo'
import { listContentJson, readContentJson } from './source'

/**
 * The published news articles, newest first — `content/site/news/`; design 1j, 1n.
 *
 * One JSON file per article. **The file name is the article's address**: `<slug>.json`
 * is served at `/nyheder/<slug>/`, and it is also the article's id, so a URL that has
 * been shared cannot drift away from the file that answers it. The slug is held to the
 * same pattern the rest of the site uses (`lib/news/slug.ts`) rather than a second one
 * written here.
 *
 * **Dates.** `publishedAt` is the article's own date, explicit and required: it is what
 * the card prints, what `datePublished` states in the JSON-LD and what orders the list.
 * `updatedAt` is optional and defaults to `publishedAt`. It exists because three public
 * surfaces already read it — the article's `dateModified`, its `og` modified time and
 * the sitemap's `lastModified` (`lib/seo/news-article.ts`, `lib/seo/metadata.ts`,
 * `lib/seo/sitemap.ts`) — and it is a written-down value rather than one derived from
 * the repository's history, so what the page claims is what somebody stated.
 *
 * **No categories in v1.** `NewsArticle.category` stays in the domain type, because
 * `NewsMeta` renders it when it is there, and this loader always answers `null`: there
 * is no vocabulary of categories yet and none is invented.
 *
 * **The body is structured, never HTML** (§8). It is the same `NewsBody` document the
 * renderer has always taken — paragraphs of spans, each span optionally bold or a link
 * — so there is nothing to parse and no sanitizer to get wrong.
 *
 * There are no articles yet. The list page renders its empty state, the Forside's
 * "Seneste nyt" column is absent, the sitemap carries no article and the article route
 * generates no page.
 */

type NewsFile = {
  title: string
  publishedAt: IsoDate
  updatedAt?: string | null
  photo?: string | null
  body: NewsBody
}

function readArticle(slug: string): NewsArticle {
  const where = `content/site/news/${slug}.json`

  if (!isNewsSlug(slug)) {
    throw new Error(
      `${where}: the file name is the article's address, so it must be a slug — ` +
        'lower-case letters, digits and single hyphens.',
    )
  }

  const file = readContentJson<NewsFile>('news', `${slug}.json`)

  return {
    id: slug,
    title: file.title,
    slug,
    category: null,
    displayDate: file.publishedAt,
    updatedAt: file.updatedAt ?? file.publishedAt,
    body: file.body,
    image: resolvePhoto(file.photo ?? null, where),
  }
}

/**
 * Every article, newest first — the order the list page and the Forside's teaser both
 * take as given. Two articles published on the same date are ordered by their slug, so
 * the list is a function of the content and never of the filesystem.
 */
export function loadNews(): NewsArticle[] {
  return listContentJson('news')
    .map(readArticle)
    .sort((a, b) =>
      a.displayDate === b.displayDate
        ? a.slug.localeCompare(b.slug)
        : (b.displayDate ?? '').localeCompare(a.displayDate ?? ''),
    )
}
