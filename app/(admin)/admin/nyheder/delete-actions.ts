'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { deleteNewsArticle } from '@/lib/news/admin'
import { rowId } from '@/lib/schemas/primitives'

import { NEWS_FORM } from './article-form'
import { newsHref } from './routes'

/**
 * Slet — deleting an article. Design 1s ("Slet"), technical plan §4, §5; phase 9A.
 *
 * There is no path to a deleted article that does not pass through the confirmation
 * (`Slet spørger altid`, 1r's rule restated by 1s), and the only thing on it that
 * deletes anything is the form this action receives: an id and a version token,
 * nothing else. `public.delete_news()` re-checks the version inside its own DELETE and
 * writes the whole article into the audit row — after the commit, that row is the only
 * place the words still exist, which is what §4 calls the recovery story. There is no
 * Fortryd: news has no soft delete, and the confirmation says so before the fact.
 *
 * The `news` tag is expired only when the deleted article was published — a draft's
 * deletion changes nothing a guest could read (§20) — and only after the commit.
 */
export async function deleteArticle(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('operation:immediate', newsHref({ status: RATE_LIMIT_STATUS }))

  const id = rowId('Nyheden').safeParse(formData.get(NEWS_FORM.articleId))
  const version = formData.get(NEWS_FORM.version)

  if (!id.success || typeof version !== 'string' || version.length === 0) {
    redirect(newsHref({ status: 'findes_ikke' }))
  }

  const result = await deleteNewsArticle(profile, {
    articleId: id.data,
    expectedUpdatedAt: version,
  })

  // Only now, and only for a deletion a guest could notice.
  expirePublicCacheTags(result.cacheTags)

  if (result.status === 'deleted') {
    // The editor's subject is gone; the list is the only place left to stand.
    redirect(newsHref({ status: 'slettet' }))
  }

  const status =
    result.status === 'conflict'
      ? 'konflikt'
      : result.status === 'not_found'
        ? 'findes_ikke'
        : result.status === 'forbidden'
          ? 'afvist'
          : 'fejl'

  redirect(newsHref({ article: id.data, status, focus: 'delete' }))
}
