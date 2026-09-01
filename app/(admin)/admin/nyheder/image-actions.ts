'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { imageExists } from '@/lib/content/images-admin'
import { readAdminArticle } from '@/lib/content/news-admin'
import { readImageSelectionForm } from '@/lib/images/selection'
import { saveNewsArticle } from '@/lib/news/admin'
import { publishableEntity } from '@/lib/publishing/entities'
import { rowId } from '@/lib/schemas/primitives'

import { NEWS_FORM } from './article-form'
import { newsHref } from './routes'

/**
 * Choosing a news article's photo — design 1s's "Billede (valgfrit)"; phase 10C-1.
 *
 * News has no draft column (§4), so there is no pending image layer to pretend to:
 * the selection follows the accepted news save model, through **the one news save
 * path** — `saveNewsArticle`, the same write Gem and autosave dispatch to, with
 * the same version token, the same audit behaviour and the same slug freeze. The
 * article's own content is restated from the server's read; the only thing the
 * browser chose is the image id (or nothing — "Fjern billede", which clears the
 * article's selection and deletes no asset, brief §10).
 *
 * The consequences are the model's, said by the status codes: a **draft**
 * article's image stays invisible to guests (RLS shows `anon` published rows
 * only) and expires nothing; a **published** article's image is public on the
 * next request, so the `news` tag is expired here — only after the write reported
 * success — and the notice says so (`billede_gemt_live`), exactly as an ordinary
 * published edit does. A stale version token is refused as `konflikt`, writing
 * nothing.
 */
export async function saveNewsImage(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const articleId = rowId('Nyheden').safeParse(formData.get(NEWS_FORM.articleId))
  const request = readImageSelectionForm(formData)

  if (!articleId.success || request === null) {
    redirect(newsHref({ status: 'fejl' }))
  }

  const article = await readAdminArticle(articleId.data)
  if (article === null) redirect(newsHref({ status: 'findes_ikke' }))

  // The FK would refuse a dangling id anyway; asking first turns a constraint
  // violation into a sentence (brief §6).
  if (request.imageId !== null && !(await imageExists(request.imageId))) {
    redirect(
      newsHref({ article: article.id, focus: 'image', status: 'billede_findes_ikke' }),
    )
  }

  const saved = await saveNewsArticle(profile, {
    articleId: article.id,
    expectedUpdatedAt: request.expectedUpdatedAt,
    // Everything except the image is the server's own reading of the row; §7f's
    // slug freeze is trivially honoured by restating the stored slug.
    values: {
      title: article.title,
      slug: article.slug,
      body: article.body,
      category: article.category,
      display_date: article.displayDate,
      image_id: request.imageId,
    },
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
      newsHref({
        article: article.id,
        focus: 'image',
        status:
          saved.status === 'conflict'
            ? 'konflikt'
            : saved.status === 'not_found'
              ? 'findes_ikke'
              : saved.status === 'forbidden'
                ? 'afvist'
                : 'fejl',
      }),
    )
  }

  // Only now, and only when the save changed what a guest reads (§6, §20).
  if (saved.isPublic) expirePublicCacheTags(publishableEntity('news').cacheTags)

  redirect(
    newsHref({
      article: article.id,
      focus: 'image',
      status:
        request.imageId === null
          ? saved.isPublic
            ? 'billede_fjernet_live'
            : 'billede_fjernet'
          : saved.isPublic
            ? 'billede_gemt_live'
            : 'billede_gemt',
    }),
  )
}
