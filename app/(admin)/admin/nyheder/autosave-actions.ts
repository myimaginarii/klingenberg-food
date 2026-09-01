'use server'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readAdminArticle, readNewsSlugs } from '@/lib/content/news-admin'
import { createNewsArticle, saveNewsArticle } from '@/lib/news/admin'
import { resolveSlugCollision } from '@/lib/news/slug'
import { publishableEntity } from '@/lib/publishing/entities'
import { rowId } from '@/lib/schemas/primitives'

import { NEWS_FORM, readNewsForm, toNewsArticleValues } from './article-form'

/**
 * Autosave — design 1s / 1z ("Gemt for lidt siden"), technical plan §4, §6; phase 9B.
 *
 * The one Server Action a client component calls programmatically, and the one that
 * **returns** instead of redirecting: the editor stays where it is, the response
 * carries the row's new version token, and the browser's copy of the form is never
 * replaced — a refusal leaves what was typed exactly where it was typed.
 *
 * It is deliberately **the same write** as the Gem button's:
 * `toNewsArticleValues` maps the same fields, §7f's slug rules run identically, and
 * `saveNewsArticle` re-checks the same version token inside the same UPDATE — so
 * autosave and Gem cannot disagree about what a save means, and there is no second
 * save system to keep in step (phase brief §7). What differs is only the reporting:
 * codes for a status line instead of a redirect with echoed fields.
 *
 * THE CONSEQUENCES ARE THE MODEL'S, SAID PLAINLY (§4, phase brief §8)
 *
 *   * a **draft** autosave changes nothing public and expires nothing;
 *   * a **published** autosave is on the hjemmesiden on the next request — the `news`
 *     tag is expired here, only after the write reported success, and the response
 *     says `gemt_live` so the status line can tell the truth about it;
 *   * every published autosave writes the same `update` audit row an explicit Gem
 *     writes (`saveNewsArticle`), because to the model they are the same event.
 *
 * A conflict is a **stop**, never a merge: the stale token wrote zero rows, the
 * response says `konflikt`, and everything after that — keeping the person's text on
 * screen, stopping further attempts — is the client machine's job
 * (`lib/news/autosave.ts`).
 */

export type NewsAutosaveResponse = {
  readonly status:
    /** Saved; the article is (still) a draft. */
    | 'gemt'
    /** Saved; the article is published, so this edit is public on the next request. */
    | 'gemt_live'
    /** The row did not exist yet and was created, as a draft (phase brief §17). */
    | 'oprettet'
    /** The content does not validate yet. Nothing was written. */
    | 'ugyldig'
    /** Somebody else saved a newer version. Nothing was written (§6). */
    | 'konflikt'
    /** The article no longer exists. */
    | 'vaek'
    /** The write failed — database, network, or a lost slug race. Nothing usable was written. */
    | 'fejl'
  /** The row's id — for `oprettet`, the id the editor adopts. */
  readonly articleId: string | null
  /** The row's new `updated_at` — the version token the next save must submit. */
  readonly version: string | null
}

const REFUSED: Omit<NewsAutosaveResponse, 'status'> = { articleId: null, version: null }

export async function autosaveArticle(formData: FormData): Promise<NewsAutosaveResponse> {
  const profile = await requireStaff()

  const form = readNewsForm(formData)
  const rawId = formData.get(NEWS_FORM.articleId)
  const rawVersion = formData.get(NEWS_FORM.version)

  // ------------------------------------------------------------------
  // No row yet: the first pause with valid content creates the draft, once. The
  // editor then owns the id and the version, and every later autosave is a save —
  // never a second row (phase brief §17).
  // ------------------------------------------------------------------
  if (typeof rawId !== 'string' || rawId.length === 0) {
    const mapped = toNewsArticleValues(form, { frozenSlug: null })
    if (!mapped.ok) return { status: 'ugyldig', ...REFUSED }

    const taken = new Set((await readNewsSlugs()).map((row) => row.slug))
    const slug =
      mapped.slug.kind === 'generated'
        ? resolveSlugCollision(mapped.slug.base, taken)
        : mapped.slug.slug

    // A new article starts with no photo (10C-1): the picker attaches one only once
    // the row exists.
    const created = await createNewsArticle(profile, { ...mapped.values, slug, image_id: null })

    if (created.status !== 'saved' || created.articleId === null || created.updatedAt === null) {
      // A lost slug race or a refused insert: nothing exists, nothing is claimed.
      return { status: created.status === 'invalid' ? 'ugyldig' : 'fejl', ...REFUSED }
    }

    return { status: 'oprettet', articleId: created.articleId, version: created.updatedAt }
  }

  // ------------------------------------------------------------------
  // An existing row: the same save the Gem button performs, reported as codes.
  // ------------------------------------------------------------------
  const id = rowId('Nyheden').safeParse(rawId)
  if (!id.success || typeof rawVersion !== 'string' || rawVersion.length === 0) {
    return { status: 'fejl', ...REFUSED }
  }

  // The server's own read decides what the form may not: whether the slug is frozen
  // (§7f) and what the audit's `before` is.
  const article = await readAdminArticle(id.data)
  if (article === null) return { status: 'vaek', ...REFUSED }

  const mapped = toNewsArticleValues(form, {
    frozenSlug: article.publishedAt !== null ? article.slug : null,
  })
  if (!mapped.ok) return { status: 'ugyldig', ...REFUSED }

  const taken = new Set(
    (await readNewsSlugs()).filter((row) => row.id !== article.id).map((row) => row.slug),
  )
  const slug =
    mapped.slug.kind === 'generated'
      ? resolveSlugCollision(mapped.slug.base, taken)
      : mapped.slug.slug

  const saved = await saveNewsArticle(profile, {
    articleId: article.id,
    expectedUpdatedAt: rawVersion,
    // The photo is restated from the server's own read, never from the form — an
    // autosave neither clears nor chooses an image (10C-1).
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

  switch (saved.status) {
    case 'saved':
      break
    case 'conflict':
      return { status: 'konflikt', ...REFUSED }
    case 'not_found':
      return { status: 'vaek', ...REFUSED }
    case 'invalid':
      return { status: 'ugyldig', ...REFUSED }
    default:
      // forbidden, slug_taken (a lost race) and failed all land here: nothing was
      // written, and the next edit may try again.
      return { status: 'fejl', ...REFUSED }
  }

  // Only now, and only when the save changed what a guest reads (§6, §20). A draft
  // autosave expires nothing — the cache is not told about invisible work.
  if (saved.isPublic) expirePublicCacheTags(publishableEntity('news').cacheTags)

  return {
    status: saved.isPublic ? 'gemt_live' : 'gemt',
    articleId: article.id,
    version: saved.updatedAt,
  }
}
