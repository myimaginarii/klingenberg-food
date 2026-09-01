'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readAdminArticle, readNewsSlugs } from '@/lib/content/news-admin'
import {
  createNewsArticle,
  saveNewsArticle,
  type NewsWriteStatus,
} from '@/lib/news/admin'
import { resolveSlugCollision } from '@/lib/news/slug'
import { publishableEntity } from '@/lib/publishing/entities'
import { rowId } from '@/lib/schemas/primitives'

import {
  encodeNewsFormEcho,
  NEWS_FORM,
  readNewsForm,
  toNewsArticleValues,
} from './article-form'
import { newsHref } from './routes'

/**
 * Writing an article — design 1s / 1z; technical plan §4, §6, §7f; phase 9A.
 *
 * Two actions, one model. News has no `draft` column (§4): an article is pending
 * while `status = 'draft'`, and a save writes the row itself. So:
 *
 *   * **Creating** inserts the row with `status = 'draft'` in the INSERT itself, which
 *     is what keeps a half-written article off the hjemmeside — the same shape every
 *     other creation in this administration has.
 *   * **Saving a draft** changes nothing public and expires nothing (§20).
 *   * **Saving a published article** is public on the next request: there is no draft
 *     layer to hold it back, the editor says so before the fact
 *     (`describeSaveConsequence`), and the `news` tag is expired here — only after the
 *     write reported success, so the cache is never told about a save that did not
 *     happen.
 *
 * The slug is §7f's, end to end: generated from the title (`article-form.ts` →
 * `lib/news/slug.ts`), collision-suffixed against the slugs this person's own JWT can
 * read, restated unchanged once the article has been published, and finally guarded by
 * the database — the UNIQUE constraint and the freeze trigger — which is why both
 * actions can lose the race and both map `slug_taken` to a sentence instead of a
 * stack trace.
 */

/** The machinery's answers as the screen's own closed status vocabulary. */
const WRITE_STATUS: Record<Exclude<NewsWriteStatus, 'saved'>, string> = {
  forbidden: 'afvist',
  invalid: 'ugyldig',
  slug_taken: 'adresse_optaget',
  conflict: 'konflikt',
  not_found: 'findes_ikke',
  failed: 'fejl',
}

export async function createArticle(formData: FormData): Promise<void> {
  // Autosave may already have created the row while the person was writing (phase
  // brief §17): the controller then fills the hidden id and version fields, and this
  // Gem is an ordinary save of that row — never a second INSERT of the same article.
  const existingId = formData.get(NEWS_FORM.articleId)
  if (typeof existingId === 'string' && existingId.length > 0) {
    return saveArticle(formData)
  }

  const profile = await requireStaff()

  const form = readNewsForm(formData)
  const mapped = toNewsArticleValues(form, { frozenSlug: null })

  if (!mapped.ok) {
    redirect(
      newsHref({ creating: true, status: 'ugyldig' }, encodeNewsFormEcho(form, mapped.errors)),
    )
  }

  // The suffix is resolved against every slug this person can see; the database's
  // UNIQUE stays the final gate for the race two tabs can still run.
  const taken = new Set((await readNewsSlugs()).map((row) => row.slug))
  const slug =
    mapped.slug.kind === 'generated'
      ? resolveSlugCollision(mapped.slug.base, taken)
      : mapped.slug.slug

  // A new article starts with no photo: the picker attaches one only once the row
  // exists, so there is nothing the browser could say about it here (10C-1).
  const created = await createNewsArticle(profile, { ...mapped.values, slug, image_id: null })

  if (created.status !== 'saved') {
    redirect(
      newsHref({ creating: true, status: WRITE_STATUS[created.status] }, encodeNewsFormEcho(form, [])),
    )
  }

  if (created.articleId === null) {
    redirect(newsHref({ creating: true, status: 'fejl' }, encodeNewsFormEcho(form, [])))
  }

  redirect(newsHref({ article: created.articleId, status: 'oprettet' }))
}

export async function saveArticle(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const id = rowId('Nyheden').safeParse(formData.get(NEWS_FORM.articleId))
  const version = formData.get(NEWS_FORM.version)

  if (!id.success || typeof version !== 'string' || version.length === 0) {
    redirect(newsHref({ status: 'findes_ikke' }))
  }

  // The server's own view of the row decides everything the form may not: whether the
  // slug is frozen (§7f), what the audit's `before` is, and which slug an unchanged
  // title keeps.
  const article = await readAdminArticle(id.data)
  if (article === null) redirect(newsHref({ status: 'findes_ikke' }))

  const form = readNewsForm(formData)
  const mapped = toNewsArticleValues(form, {
    frozenSlug: article.publishedAt !== null ? article.slug : null,
  })

  if (!mapped.ok) {
    redirect(
      newsHref(
        { article: article.id, status: 'ugyldig' },
        encodeNewsFormEcho(form, mapped.errors),
      ),
    )
  }

  const taken = new Set(
    (await readNewsSlugs())
      .filter((row) => row.id !== article.id)
      .map((row) => row.slug),
  )
  const slug =
    mapped.slug.kind === 'generated'
      ? resolveSlugCollision(mapped.slug.base, taken)
      : mapped.slug.slug

  const saved = await saveNewsArticle(profile, {
    articleId: article.id,
    expectedUpdatedAt: version,
    // The photo is restated from the server's own read, never from the form: a
    // content save neither clears nor chooses an image (10C-1) — the picker action
    // is the one place a selection is decided.
    values: { ...mapped.values, slug, image_id: article.imageId },
    before: {
      title: article.title,
      slug: article.slug,
      body: article.body,
      category: article.category,
      displayDate: article.displayDate,
      imageId: article.imageId,
      status: article.status,
    },
  })

  if (saved.status !== 'saved') {
    redirect(
      newsHref(
        { article: article.id, status: WRITE_STATUS[saved.status] },
        // A conflict keeps what was typed on screen, so nothing is lost while the
        // person compares it with the colleague's version.
        saved.status === 'conflict' ? encodeNewsFormEcho(form, []) : undefined,
      ),
    )
  }

  // Only now, and only when the save changed what a guest reads (§6, §20).
  if (saved.isPublic) expirePublicCacheTags(publishableEntity('news').cacheTags)

  redirect(newsHref({ article: article.id, status: saved.isPublic ? 'gemt_live' : 'gemt' }))
}
