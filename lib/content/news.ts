import 'server-only'

import { CACHE_TAGS } from '@/lib/cache/tags'
import type { PublicImage } from '@/lib/images/public'
import type { IsoDate } from '@/lib/time/calendar'

import { booleanField, field, objectArrayField, stringField } from './document'
import { imageFor, readPublicImages } from './images'
import { assertNoQueryError, definePublicRead, type ContentAccess } from './source'
import type { NewsArticle, NewsBody, NewsParagraph, NewsSpan } from './types'

/**
 * News — technical plan §4, §6, §7f.
 *
 * An article has no `draft` column: it is pending while its `status` is still 'draft',
 * and publishing flips that status (§4). So a visitor sees published articles because
 * `news.status` is not among the columns granted to `anon` at all (§8) and
 * `news_select_public` restricts the rows; a staff member in preview sees the
 * unpublished ones too, at their real slug, which is what makes "Forhåndsvis" work for
 * an article that does not exist publicly yet (§6).
 *
 * The body is structured JSON, never HTML (§8). It is read into typed nodes here and
 * rendered by our own components, so there is no HTML parsing anywhere on the public
 * site and no sanitizer to get wrong.
 *
 * The article's photo (phase 10C-2) is resolved from `image_id` inside the same
 * tagged read (`lib/content/images.ts`), so the `news` tag covers the list, the
 * article, the Forside teaser, the article's metadata and the sitemap's read alike —
 * and a library edit that touches a published article's image expires exactly it.
 */

type NewsRow = {
  id: string
  title: string
  slug: string
  category: string | null
  display_date: string | null
  updated_at: string
  body: unknown
  image_id: string | null
}

const COLUMNS = 'id, title, slug, category, display_date, updated_at, body, image_id'

function readSpan(raw: unknown): NewsSpan | null {
  // The text is verbatim, never trimmed: a span legitimately begins or ends with the
  // space that separates it from its neighbour ("…med ", "fed skrift", " og…"), and a
  // trimming read destroys exactly those boundary spaces the moment a paragraph holds
  // more than one span (the 9B editor's whole output). Blankness is a *paragraph*
  // question, answered below over the joined text — where the write path enforces it.
  const text = field(raw, 'text')
  if (typeof text !== 'string' || text.length === 0) return null

  const span: NewsSpan = { text }
  if (booleanField(raw, 'bold')) span.bold = true

  // Only absolute https links are rendered, and always with rel="noopener noreferrer"
  // at the call site. An href of any other scheme is dropped rather than rendered (§8).
  const href = stringField(raw, 'href')
  if (href !== null && href.startsWith('https://')) span.href = href

  return span
}

/**
 * The stored `body` as typed nodes. Exported since phase 9A: the editor reads the
 * article through `lib/content/news-admin.ts`, and the two must project the stored
 * document identically — one parser, not a public one and an admin one that could
 * drift apart.
 */
export function readNewsBody(raw: unknown): NewsBody {
  const blocks: NewsParagraph[] = []

  for (const block of objectArrayField(raw, 'blocks')) {
    if (stringField(block, 'type') !== 'paragraph') continue

    const spans = objectArrayField(block, 'spans')
      .map(readSpan)
      .filter((span): span is NewsSpan => span !== null)

    // Blank is absent, decided over the whole paragraph: the write path never stores
    // a whitespace-only paragraph, and a degenerate document's one must not render as
    // an empty <p> — while an interior span of one space stays exactly what it is.
    const joined = spans.map((span) => span.text).join('')
    if (spans.length > 0 && joined.trim().length > 0) {
      blocks.push({ type: 'paragraph', spans })
    }
  }

  return { blocks }
}

function toArticle(row: NewsRow, images: ReadonlyMap<string, PublicImage>): NewsArticle {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    category: row.category,
    displayDate: row.display_date as IsoDate | null,
    updatedAt: row.updated_at,
    body: readNewsBody(row.body),
    image: imageFor(images, row.image_id),
  }
}

/** `0` means "every article" — the list page — rather than a limit of nothing. */
const NO_LIMIT = 0

const readNewsList = definePublicRead(
  'news-list',
  [CACHE_TAGS.news],
  async (access: ContentAccess, limit: number): Promise<NewsArticle[]> => {
    let query = access.database
      .from('news')
      .select(COLUMNS)
      .order('display_date', { ascending: false, nullsFirst: false })
      .order('published_at', { ascending: false })

    // A staff preview reads through their own JWT, so `news_select_staff` returns
    // unpublished articles too — which is the point of previewing one.
    if (limit !== NO_LIMIT) query = query.limit(limit)

    const { data, error } = await query.returns<NewsRow[]>()
    assertNoQueryError('the news articles', error)

    const rows = data ?? []
    const images = await readPublicImages(access, rows.map((row) => row.image_id))

    return rows.map((row) => toArticle(row, images))
  },
)

const readArticleBySlug = definePublicRead(
  'news-article',
  [CACHE_TAGS.news],
  async (access: ContentAccess, slug: string): Promise<NewsArticle | null> => {
    const { data, error } = await access.database
      .from('news')
      .select(COLUMNS)
      .eq('slug', slug)
      .maybeSingle<NewsRow>()

    assertNoQueryError('the news article', error)
    if (data === null) return null

    const images = await readPublicImages(access, [data.image_id])

    return toArticle(data, images)
  },
)

/** Every published article, newest first — the Nyheder list and the Forside teaser. */
export function readPublishedNews(limit?: number): Promise<NewsArticle[]> {
  return readNewsList(limit ?? NO_LIMIT)
}

/** One published article by slug, or `null` — an unpublished slug is a 404 (§7f). */
export function readPublishedArticle(slug: string): Promise<NewsArticle | null> {
  return readArticleBySlug(slug)
}

/** The teaser rule is pure and shared with the static site: `lib/news/excerpt.ts`. */
export { articleExcerpt } from '@/lib/news/excerpt'
