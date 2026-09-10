import type { NewsArticle, NewsBody } from '@/lib/content/types'
import { isNewsSlug } from '@/lib/news/slug'
import type { IsoDate } from '@/lib/time/calendar'

import { validateNewsArticle } from '../validate/news'
import { assertValid } from '../validate/problems'

import { resolvePhoto, type PhotoField } from './photo'
import { contentPath, listContentJson, once, readContentJson } from './source'

/**
 * The published news articles, newest first — `content/site/news/`; design 1j, 1n.
 *
 * One JSON file per article. **The file name is the article's address**: `<slug>.json`
 * is served at `/nyheder/<slug>/`, and it is also the article's id, so a URL that has
 * been shared cannot drift away from the file that answers it. The slug is held to the
 * same pattern the rest of the site uses (`lib/news/slug.ts`) rather than a second one
 * written here.
 *
 * **`published` decides whether an article exists to the public.** Only a file that
 * says `"published": true` is returned; anything else — `false`, or the field left out
 * — is a draft, and a draft renders no page, appears in no list, gets no
 * `generateStaticParams` entry and enters no sitemap, because every one of those reads
 * this list and nothing else.
 *
 * **Dates.** `publishedAt` is the article's own date, explicit and required: it is what
 * the card prints, what `datePublished` states in the JSON-LD and what orders the list.
 * `updatedAt` is optional and defaults to `publishedAt`; three public surfaces read it
 * — the article's `dateModified`, its `og` modified time and the sitemap's
 * `lastModified` — and it is a written-down value rather than one derived from the
 * repository's history, so what the page claims is what somebody stated.
 *
 * **The body is structured, never HTML** (§8). It is the same `NewsBody` document the
 * renderer has always taken — paragraphs of spans, each span optionally bold or a link
 * — so there is nothing to parse and no sanitizer to get wrong.
 *
 * There are no articles yet. The list page renders its empty state, the Forside's
 * "Seneste nyt" column is absent, the sitemap carries no article and the article route
 * generates no page.
 */

export type NewsFile = {
  title: string
  published?: boolean
  publishedAt: IsoDate
  updatedAt?: string | null
  category?: string | null
  photo?: PhotoField | null
  body: NewsBody
}

/** The article one file means, or `null` for a draft. `slug` is the file's name. */
export function newsArticleFrom(slug: string, file: NewsFile): NewsArticle | null {
  const where = contentPath('news', `${slug}.json`)

  if (!isNewsSlug(slug)) {
    throw new Error(
      `${where}: the file name is the article's address, so it must be a slug — ` +
        'lower-case letters, digits and single hyphens.',
    )
  }

  if (file.published !== true) return null

  if (!file.title || !file.publishedAt) {
    throw new Error(`${where} is published but has no title or no publishedAt.`)
  }

  return {
    id: slug,
    title: file.title,
    slug,
    category: file.category ?? null,
    displayDate: file.publishedAt,
    updatedAt: file.updatedAt ?? file.publishedAt,
    body: file.body,
    image: resolvePhoto(file.photo, where),
  }
}

/**
 * Every published article, newest first — the order the list page and the Forside's
 * teaser both take as given. Two articles published on the same date are ordered by
 * their slug, so the list is a function of the content and never of the filesystem.
 */
export const loadNews = once((): NewsArticle[] =>
  listContentJson('news')
    .map((slug) => {
      const file = readContentJson<NewsFile>('news', `${slug}.json`)
      assertValid(validateNewsArticle(slug, file, contentPath('news', `${slug}.json`)))

      return newsArticleFrom(slug, file)
    })
    .filter((article): article is NewsArticle => article !== null)
    .sort((a, b) =>
      a.displayDate === b.displayDate
        ? a.slug.localeCompare(b.slug)
        : (b.displayDate ?? '').localeCompare(a.displayDate ?? ''),
    ),
)
