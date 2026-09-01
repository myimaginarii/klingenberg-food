import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { publishableEntity } from '@/lib/publishing/entities'
import { newsArticleInput, type NewsArticleInput } from '@/lib/schemas/news'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The news writes — technical plan §4, §5, §6, §7f; phase 9A.
 *
 * THE MODEL, STATED ONCE
 *
 * News is the entity §4 lists with **no `draft` column**: an article is pending while
 * `status = 'draft'`, and an edit writes the row's own columns directly. That means:
 *
 *   * a **draft** article is edited freely and stays invisible — `news_select_public`
 *     grants `anon` published rows only, so nothing about an unpublished row leaks;
 *   * a **published** article's save is live on the hjemmeside as soon as the caller
 *     expires the `news` tag. There is no draft layer, and the administration says so
 *     (`describeSaveConsequence`) instead of pretending otherwise. The audit row this
 *     module writes for exactly that case is the recovery story — the previous words
 *     exist nowhere else once the UPDATE commits.
 *
 * A **wrapper, not a mechanism**, like `lib/hours/override-admin.ts`: creation and the
 * direct edit are the two writes the draft machinery cannot do for an entity that has
 * no draft, and the two status transitions delegate to the trusted database functions
 * (`unpublish_news`, `delete_news`). Publishing is deliberately **not** here —
 * `publishPendingChange` and `public.publish_news()` have owned it since phase 4, and
 * a second publishing path is the thing §6 forbids.
 *
 * Every write:
 *   1. asks the §5 matrix first (`mayChangeEntity('news', …)` — Staff and Owner), so a
 *      refusal is a sentence rather than a silent no-op from RLS;
 *   2. re-parses the values against `newsArticleInput`, strictly — an unknown key is a
 *      refusal, and `status` and `published_at` are not in the shape at all, so no
 *      caller of this module can move them. `image_id` is in the shape since 10C-1:
 *      the browser's content form never carries it — the actions restate the row's
 *      own value, and only the picker action submits a new one, existence-checked
 *      first;
 *   3. goes to the database through the caller's own JWT, so RLS re-decides (§5);
 *   4. re-checks the version token inside the write itself (§6).
 */

export type NewsWriteStatus =
  /** Written. */
  | 'saved'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The submitted values did not satisfy `newsArticleInput`. */
  | 'invalid'
  /** The slug is already taken — two tabs raced §7f's collision suffix. */
  | 'slug_taken'
  /** Somebody else saved a newer version first (§6). Nothing was written. */
  | 'conflict'
  /** No such article, or the caller may not see it. */
  | 'not_found'
  /** The database refused the write — a constraint, or an unreachable database. */
  | 'failed'

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

export type CreateArticleResult = {
  readonly status: NewsWriteStatus
  /** The new row's id — present only when `saved`. */
  readonly articleId: string | null
  /** The new row's `updated_at` — the version token the next save submits (§6). */
  readonly updatedAt: string | null
}

/**
 * Create one article, as a draft.
 *
 * The row is born with `status = 'draft'`, which is what keeps it off the hjemmeside
 * until somebody publishes it — the same shape `createDishDraft` (`is_new_draft`) and
 * `createOverrideDraft` (`status`) have: the invisibility is a column written in the
 * INSERT itself, never an ordering of two writes. The insert either produces an
 * invisible article or produces nothing.
 */
export async function createNewsArticle(
  profile: Profile,
  values: unknown,
): Promise<CreateArticleResult> {
  if (!mayChangeEntity('news', profile)) {
    return { status: 'forbidden', articleId: null, updatedAt: null }
  }

  const parsed = newsArticleInput.safeParse(values)
  if (!parsed.success) return { status: 'invalid', articleId: null, updatedAt: null }

  const input: NewsArticleInput = parsed.data
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('news')
    .insert({
      title: input.title,
      slug: input.slug,
      body: input.body,
      category: input.category,
      display_date: input.display_date,
      image_id: input.image_id,
      // The one column that makes this a draft a guest cannot see rather than a publish.
      status: 'draft',
    })
    .select('id, updated_at')
    .maybeSingle<{ id: string; updated_at: string }>()

  if (error !== null) {
    // 23505 is the UNIQUE on `slug` — two tabs raced the collision suffix; 42501 is RLS
    // refusing a non-staff insert. The message is for the server log, never the browser.
    if (error.code === '23505') return { status: 'slug_taken', articleId: null, updatedAt: null }

    console.error(`Creating a news article failed: ${error.message}`)
    return {
      status: error.code === '42501' ? 'forbidden' : 'failed',
      articleId: null,
      updatedAt: null,
    }
  }

  if (data === null) return { status: 'failed', articleId: null, updatedAt: null }

  // `before` is null: there was nothing before. The actor is stamped from the JWT
  // inside `log_audit`, never from a parameter (§8).
  const audit = await supabase.rpc('log_audit', {
    p_action: 'create',
    p_entity: 'news',
    p_entity_id: data.id,
    p_before: null,
    p_after: articleAuditShape(input),
  })

  if (audit.error !== null) {
    // The article exists, unpublished and invisible to guests; failing the creation now
    // would leave the person with a row and no explanation. Record it and carry on.
    console.error(`Could not write the audit row for news ${data.id}: ${audit.error.message}`)
  }

  return { status: 'saved', articleId: data.id, updatedAt: data.updated_at }
}

// ---------------------------------------------------------------------------
// Saving an edit
// ---------------------------------------------------------------------------

export type SaveArticleResult = {
  readonly status: NewsWriteStatus
  /**
   * True when the saved row is published — the caller's cue to expire the `news` tag,
   * because this save just changed what a guest reads (§6, §20). Always false unless
   * `saved`: a draft save moves nothing public and must expire nothing.
   */
  readonly isPublic: boolean
  /** The row's new `updated_at` — the version token the next save submits (§6). */
  readonly updatedAt: string | null
}

export type SaveArticleRequest = {
  readonly articleId: string
  /** The `updated_at` the editor was rendered from (§6). */
  readonly expectedUpdatedAt: string
  /** Raw values. Parsed here and never used before that. */
  readonly values: unknown
  /**
   * The row as the caller just read it, for the audit's `before`. Passed in rather
   * than re-read so the audit describes the row the version token actually matched.
   */
  readonly before: {
    readonly title: string
    readonly slug: string
    readonly body: unknown
    readonly category: string | null
    readonly displayDate: string | null
    readonly imageId: string | null
    readonly status: 'draft' | 'published'
  }
}

/**
 * Save one article's content — title, body, category, date, and (until first publish)
 * the slug that follows the title.
 *
 * The version token is re-checked **inside the UPDATE's own WHERE**, so a stale token
 * writes zero rows and nothing else: no silent overwrite, and no audit row for a write
 * that did not happen. Zero rows is then told apart honestly — the row read back by id
 * still exists → somebody else saved first (`conflict`); it does not → it was deleted
 * (`not_found`).
 *
 * The audit row is written for the save that changed the hjemmeside: an edit to a
 * published article, whose previous words survive nowhere else. A draft edit is
 * unaudited, exactly like every other draft write in this administration — publishing
 * is where a draft's story is recorded.
 */
export async function saveNewsArticle(
  profile: Profile,
  request: SaveArticleRequest,
): Promise<SaveArticleResult> {
  if (!mayChangeEntity('news', profile)) {
    return { status: 'forbidden', isPublic: false, updatedAt: null }
  }

  const parsed = newsArticleInput.safeParse(request.values)
  if (!parsed.success) return { status: 'invalid', isPublic: false, updatedAt: null }

  const input: NewsArticleInput = parsed.data
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('news')
    .update({
      title: input.title,
      slug: input.slug,
      body: input.body,
      category: input.category,
      display_date: input.display_date,
      image_id: input.image_id,
    })
    .eq('id', request.articleId)
    .eq('updated_at', request.expectedUpdatedAt)
    .select('id, status, updated_at')
    .maybeSingle<{ id: string; status: 'draft' | 'published'; updated_at: string }>()

  if (error !== null) {
    if (error.code === '23505') return { status: 'slug_taken', isPublic: false, updatedAt: null }

    console.error(`Saving news article ${request.articleId} failed: ${error.message}`)
    return {
      status: error.code === '42501' ? 'forbidden' : 'failed',
      isPublic: false,
      updatedAt: null,
    }
  }

  if (data === null) {
    const existing = await supabase
      .from('news')
      .select('id')
      .eq('id', request.articleId)
      .maybeSingle<{ id: string }>()

    return {
      status: existing.data === null ? 'not_found' : 'conflict',
      isPublic: false,
      updatedAt: null,
    }
  }

  const isPublic = data.status === 'published'

  if (isPublic) {
    const audit = await supabase.rpc('log_audit', {
      p_action: 'update',
      p_entity: 'news',
      p_entity_id: request.articleId,
      p_before: {
        title: request.before.title,
        slug: request.before.slug,
        body: request.before.body,
        category: request.before.category,
        display_date: request.before.displayDate,
        image_id: request.before.imageId,
      },
      p_after: articleAuditShape(input),
    })

    if (audit.error !== null) {
      // The save is committed and correct; the log is owed a row it did not get. Say so
      // in the server log rather than failing a write that already happened.
      console.error(
        `Could not write the audit row for news ${request.articleId}: ${audit.error.message}`,
      )
    }
  }

  return { status: 'saved', isPublic, updatedAt: data.updated_at }
}

/** The audit document for a create or a published edit: the content, whole (§4). */
function articleAuditShape(input: NewsArticleInput): Record<string, unknown> {
  return {
    title: input.title,
    slug: input.slug,
    body: input.body,
    category: input.category,
    display_date: input.display_date,
    image_id: input.image_id,
  }
}

// ---------------------------------------------------------------------------
// The two trusted transitions
// ---------------------------------------------------------------------------

export type UnpublishArticleStatus =
  | 'unpublished'
  | 'nothing_to_unpublish'
  | 'conflict'
  | 'not_found'
  | 'forbidden'
  | 'failed'

const unpublishResultSchema = z.object({
  status: z.enum(['unpublished', 'nothing_to_unpublish', 'conflict', 'not_found', 'forbidden']),
})

/**
 * Take one published article off the hjemmeside — §7f's unpublish, delegated whole to
 * `public.unpublish_news()`: status flip, audit row and version check in one
 * transaction, `published_at` kept so the slug stays frozen and a republish keeps the
 * original date.
 */
export async function unpublishNewsArticle(
  profile: Profile,
  request: { readonly articleId: string; readonly expectedUpdatedAt: string },
): Promise<{ readonly status: UnpublishArticleStatus; readonly cacheTags: readonly CacheTag[] }> {
  if (!mayChangeEntity('news', profile)) return { status: 'forbidden', cacheTags: [] }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('unpublish_news', {
    p_id: request.articleId,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    console.error(`Unpublishing news ${request.articleId} failed: ${error.message}`)
    return { status: 'failed', cacheTags: [] }
  }

  const parsed = unpublishResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error(`Unexpected unpublish result for news ${request.articleId}.`)
    return { status: 'failed', cacheTags: [] }
  }

  return {
    status: parsed.data.status,
    // Stated through the publishing registry, so the tag an unpublish expires and the
    // tag a publish expires cannot drift apart (§6, §20).
    cacheTags:
      parsed.data.status === 'unpublished' ? publishableEntity('news').cacheTags : [],
  }
}

export type DeleteArticleStatus = 'deleted' | 'conflict' | 'not_found' | 'forbidden' | 'failed'

const deleteResultSchema = z.object({
  status: z.enum(['deleted', 'conflict', 'not_found', 'forbidden']),
  was_published: z.boolean().nullish(),
})

/**
 * Delete one article — `public.delete_news()`: version check inside the DELETE, and
 * the whole article in the audit row, which after the commit is the only place the
 * words still exist (§4's recovery story).
 */
export async function deleteNewsArticle(
  profile: Profile,
  request: { readonly articleId: string; readonly expectedUpdatedAt: string },
): Promise<{ readonly status: DeleteArticleStatus; readonly cacheTags: readonly CacheTag[] }> {
  if (!mayChangeEntity('news', profile)) return { status: 'forbidden', cacheTags: [] }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('delete_news', {
    p_id: request.articleId,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    console.error(`Deleting news ${request.articleId} failed: ${error.message}`)
    return { status: 'failed', cacheTags: [] }
  }

  const parsed = deleteResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error(`Unexpected delete result for news ${request.articleId}.`)
    return { status: 'failed', cacheTags: [] }
  }

  if (parsed.data.status !== 'deleted') return { status: parsed.data.status, cacheTags: [] }

  return {
    status: 'deleted',
    // Deleting a draft changes nothing a guest could read, so it expires nothing (§20).
    cacheTags:
      parsed.data.was_published === true ? publishableEntity('news').cacheTags : [],
  }
}
