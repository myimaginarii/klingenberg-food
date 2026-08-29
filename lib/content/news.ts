import 'server-only'

import type { IsoDate } from '@/lib/time/calendar'

import { booleanField, objectArrayField, stringField } from './document'
import { assertNoQueryError, publicDatabase } from './source'
import type { NewsArticle, NewsBody, NewsParagraph, NewsSpan } from './types'

/**
 * Published news — technical plan §4, §7f.
 *
 * Phase 3 reads and renders published articles. The editor, autosave, publishing and
 * the slug policy are phase 9; nothing here writes, and nothing here can see a draft.
 * That is a privilege guarantee rather than a filter this file remembers to apply:
 * `news.status` is not among the columns granted to `anon` (§8), so a public query
 * cannot name it, and `news_select_public` restricts the rows to published ones.
 *
 * The body is structured JSON, never HTML (§8). It is read into typed nodes here and
 * rendered by our own components, so there is no HTML parsing anywhere on the public
 * site and no sanitizer to get wrong.
 */

type NewsRow = {
  id: string
  title: string
  slug: string
  category: string | null
  display_date: string | null
  body: unknown
}

const COLUMNS = 'id, title, slug, category, display_date, body'

function readSpan(raw: unknown): NewsSpan | null {
  const text = stringField(raw, 'text')
  if (text === null) return null

  const span: NewsSpan = { text }
  if (booleanField(raw, 'bold')) span.bold = true

  // Only absolute https links are rendered, and always with rel="noopener noreferrer"
  // at the call site. An href of any other scheme is dropped rather than rendered (§8).
  const href = stringField(raw, 'href')
  if (href !== null && href.startsWith('https://')) span.href = href

  return span
}

function readBody(raw: unknown): NewsBody {
  const blocks: NewsParagraph[] = []

  for (const block of objectArrayField(raw, 'blocks')) {
    if (stringField(block, 'type') !== 'paragraph') continue

    const spans = objectArrayField(block, 'spans')
      .map(readSpan)
      .filter((span): span is NewsSpan => span !== null)

    if (spans.length > 0) blocks.push({ type: 'paragraph', spans })
  }

  return { blocks }
}

function toArticle(row: NewsRow): NewsArticle {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    category: row.category,
    displayDate: row.display_date as IsoDate | null,
    body: readBody(row.body),
  }
}

/** Every published article, newest first — the Nyheder list and the Forside teaser. */
export async function readPublishedNews(limit?: number): Promise<NewsArticle[]> {
  let query = publicDatabase()
    .from('news')
    .select(COLUMNS)
    .order('display_date', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false })

  if (limit !== undefined) query = query.limit(limit)

  const { data, error } = await query.returns<NewsRow[]>()
  assertNoQueryError('the news articles', error)

  return (data ?? []).map(toArticle)
}

/** One published article by slug, or `null` — an unpublished slug is a 404 (§7f). */
export async function readPublishedArticle(slug: string): Promise<NewsArticle | null> {
  const { data, error } = await publicDatabase()
    .from('news')
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle<NewsRow>()

  assertNoQueryError('the news article', error)

  return data ? toArticle(data) : null
}

/** The one- or two-line teaser the list and the Forside card show, from the first paragraph. */
export function articleExcerpt(article: NewsArticle): string | null {
  const first = article.body.blocks[0]
  if (first === undefined) return null

  const text = first.spans.map((span) => span.text).join('').trim()
  return text.length > 0 ? text : null
}
