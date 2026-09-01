import 'server-only'

import { cache } from 'react'

import type { NewsBody } from '@/lib/content/types'
import type { NewsAdminStatus } from '@/lib/news/lifecycle'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { readNewsBody } from './news'
import { assertNoQueryError } from './source'

/**
 * The articles as staff edit them — technical plan §4, §6, §7f; design 1s / 1z.
 *
 * A **separate read from the public one, on purpose**, for the same three reasons
 * `lib/content/menu-admin.ts` records:
 *
 *   * **Never cached.** An editor showing a five-minute-old article would hand the
 *     next save a stale `updated_at` and turn optimistic concurrency (§6) into a
 *     lottery. These reads are fresh every time and carry no cache tag, so nothing a
 *     publish expires can affect them and nothing here can pollute a public entry.
 *   * **Through the staff member's own JWT.** RLS decides what exists:
 *     `news_select_staff` returns drafts too, `news_select_public` never does.
 *   * **Everything, `status` included.** The public read cannot even name `status` —
 *     the column is not in `anon`'s grant — while the whole point of this one is to
 *     say which articles are on the hjemmeside and which are not.
 *
 * There is no draft to merge: news has no `draft` column (§4), so the row *is* the
 * article, in both states — `image_id` included since phase 10C-1: the article's
 * photo slot shows it, and the one news save path restates it on every write.
 *
 * `cache()` deduplicates within one render pass and expires with the request — that
 * is memoisation, not caching.
 */

type NewsListRow = {
  id: string
  title: string
  slug: string
  status: NewsAdminStatus
  published_at: string | null
  updated_at: string
}

type NewsRow = NewsListRow & {
  body: unknown
  category: string | null
  display_date: string | null
  image_id: string | null
}

/** One row of the administration's list (1z): the title, the state, the dates. */
export type AdminNewsListItem = {
  readonly id: string
  readonly title: string
  readonly slug: string
  readonly status: NewsAdminStatus
  readonly publishedAt: string | null
  /** The version token the list's own actions would submit (§6). */
  readonly updatedAt: string
}

/** One whole article, as the editor needs it. */
export type AdminNewsArticle = AdminNewsListItem & {
  readonly body: NewsBody
  readonly category: string | null
  readonly displayDate: string | null
  /** The article's photo (phase 10C-1) — a library reference, never a copy (§22). */
  readonly imageId: string | null
}

const LIST_COLUMNS = 'id, title, slug, status, published_at, updated_at'
const ARTICLE_COLUMNS = `${LIST_COLUMNS}, body, category, display_date, image_id`

/**
 * Every article, most recently touched first — the working order for a person, where
 * the public list's order (`display_date`) is the reading order for a guest.
 */
export const readAdminNewsList = cache(async (): Promise<AdminNewsListItem[]> => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('news')
    .select(LIST_COLUMNS)
    .order('updated_at', { ascending: false })
    .returns<NewsListRow[]>()

  assertNoQueryError('the news list', error)

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  }))
})

/** One article by id, or `null` when it does not exist or RLS hides it. */
export async function readAdminArticle(id: string): Promise<AdminNewsArticle | null> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('news')
    .select(ARTICLE_COLUMNS)
    .eq('id', id)
    .maybeSingle<NewsRow>()

  assertNoQueryError('the news article', error)
  if (data === null) return null

  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    status: data.status,
    publishedAt: data.published_at,
    updatedAt: data.updated_at,
    body: readNewsBody(data.body),
    category: data.category,
    displayDate: data.display_date,
    imageId: data.image_id,
  }
}

/**
 * Every slug and whose it is, for §7f's collision suffix. The caller excludes the
 * article being saved, so an unchanged title keeps its slug rather than drifting
 * to `-2`.
 */
export async function readNewsSlugs(): Promise<{ readonly id: string; readonly slug: string }[]> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('news')
    .select('id, slug')
    .returns<{ id: string; slug: string }[]>()

  assertNoQueryError('the news slugs', error)

  return data ?? []
}
