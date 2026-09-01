'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readAdminArticle } from '@/lib/content/news-admin'
import { unpublishNewsArticle } from '@/lib/news/admin'
import { publishPendingChange } from '@/lib/publishing/publish'
import { rowId } from '@/lib/schemas/primitives'

import { NEWS_FORM } from './article-form'
import { newsHref } from './routes'

/**
 * The two status transitions — design 1s, technical plan §6, §7f; phase 9A.
 *
 * §6: "News publishes per item, as designed." Both actions take **an id and a version
 * token** from the confirmation's own form, and nothing else — no entity name, no
 * table, no content. What either of them can do is decided entirely on the server:
 *
 *   * **Offentliggør** is phase 4's machinery, untouched: `publishPendingChange`
 *     resolves the pending article through `pending_changes` (RLS decides it exists),
 *     re-asks the §5 matrix, and calls `public.publish_news()` — the status flip, the
 *     first-time `published_at` stamp, the audit row and the version check in one
 *     transaction. **There is no second publishing path here.**
 *   * **Fjern fra hjemmesiden** is the mirror transition phase 9A added:
 *     `public.unpublish_news()`, delegated through `lib/news/admin.ts`. The row and
 *     `published_at` survive, so the slug stays frozen and republishing restores the
 *     same URL (§7f).
 *
 * In both directions the `news` cache tag is expired only after the transaction
 * reported success (§6, §20), so the first guest request after the redirect reads the
 * committed state — and a refusal expires nothing.
 */

export async function publishArticle(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const id = rowId('Nyheden').safeParse(formData.get(NEWS_FORM.articleId))
  const version = formData.get(NEWS_FORM.version)

  if (!id.success || typeof version !== 'string' || version.length === 0) {
    redirect(newsHref({ status: 'findes_ikke' }))
  }

  const result = await publishPendingChange(profile, {
    entity: 'news',
    entityId: id.data,
    expectedUpdatedAt: version,
  })

  // Only now, and only for a publish that actually happened.
  expirePublicCacheTags(result.cacheTags)

  const status =
    result.status === 'published'
      ? 'offentliggjort'
      : result.status === 'conflict'
        ? 'konflikt'
        : result.status === 'nothing_to_publish' || result.status === 'not_found'
          ? // Not pending any more: published in another tab, or deleted. The page
            // resolves the article again and words the difference; the action only
            // reports that there was nothing left to publish.
            (await readAdminArticle(id.data)) === null
            ? 'findes_ikke'
            : 'allerede_offentliggjort'
          : result.status === 'forbidden'
            ? 'afvist'
            : 'fejl'

  redirect(newsHref({ article: id.data, status, focus: 'publish' }))
}

export async function unpublishArticle(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const id = rowId('Nyheden').safeParse(formData.get(NEWS_FORM.articleId))
  const version = formData.get(NEWS_FORM.version)

  if (!id.success || typeof version !== 'string' || version.length === 0) {
    redirect(newsHref({ status: 'findes_ikke' }))
  }

  const result = await unpublishNewsArticle(profile, {
    articleId: id.data,
    expectedUpdatedAt: version,
  })

  // Only after the commit: the article is gone from the hjemmeside on the very next
  // guest request, and its address answers 404 (§7f, §20).
  expirePublicCacheTags(result.cacheTags)

  const status =
    result.status === 'unpublished'
      ? 'fjernet'
      : result.status === 'nothing_to_unpublish'
        ? 'allerede_fjernet'
        : result.status === 'conflict'
          ? 'konflikt'
          : result.status === 'not_found'
            ? 'findes_ikke'
            : result.status === 'forbidden'
              ? 'afvist'
              : 'fejl'

  redirect(newsHref({ article: id.data, status, focus: 'unpublish' }))
}
