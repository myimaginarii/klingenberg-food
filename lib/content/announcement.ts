import 'server-only'

import { resolveAnnouncementLink } from '@/lib/announcements/link'
import { CACHE_TAGS } from '@/lib/cache/tags'
import { overlayDraft } from '@/lib/drafts/overlay'
import { announcementDraft } from '@/lib/schemas/announcement'
import type { SiteAnnouncement } from '@/lib/content/types'

import { assertNoQueryError, columns, definePublicRead, type ContentAccess } from './source'

/**
 * The sitewide message a guest sees — design 1ac; technical plan §4, §6, §7c, §8.
 *
 * One row, read once per request by the shared public layout, so the bar appears on
 * every page or on none. Everything it can decide, it decides here; the one thing it
 * cannot is the clock.
 *
 * WHY THERE IS NO `now` IN THIS FILE
 *
 * This read is cached and tagged (`definePublicRead`), and an entry may be served for up
 * to five minutes (§6, §7a). A clock reading taken inside it would be **baked into the
 * cache entry**: the bar would then be shown or hidden according to the instant the
 * entry was built, which for an expiry is precisely the wrong instant. So the expiry
 * comparison is made by the component that renders the bar, against that render's own
 * clock (`components/site/announcement/AnnouncementRegion.tsx`), and the two halves
 * together are exactly `isAnnouncementPubliclyVisible` — which the unit suite asserts.
 *
 * The three layers that keep an expired message off the site, in the order they act:
 *
 *   1. **RLS**, when the row is fetched: the anonymous policy is
 *      `is_visible and message is not null and expires_at is not null and expires_at > now()`.
 *      A guest's client cannot read an expired announcement at all.
 *   2. **This render**, on every fresh page build: the region drops an announcement whose
 *      expiry has passed since the row was cached.
 *   3. **The browser**, for a page that was already on screen when the expiry passed:
 *      `AnnouncementExpiryGuard` (§7c), with no request of any kind.
 *
 * WHAT A PREVIEW SEES, AND WHY `is_visible` IS READ DIFFERENTLY THERE
 *
 * `is_visible` is written only by the immediate path (§6) and is `false` on a row that
 * has never been published. A staff member previewing their first announcement would
 * therefore see nothing at all — a preview that is wrong about the one thing it exists
 * to show. Publishing sets `is_visible = true` (`publish_announcement()`), so on the
 * preview path a **pending draft** is treated as visible: that is not a relaxation of
 * the rule, it is the rule applied to the row publishing would produce. A row with no
 * draft is previewed exactly as a guest sees it, because publishing nothing changes
 * nothing.
 */

type AnnouncementRow = {
  message: string | null
  link_type: string
  link_page: string | null
  link_url: string | null
  link_label: string | null
  expires_at: string | null
  is_visible: boolean
  draft?: unknown
}

/**
 * `draft` is not among the columns granted to `anon` (§8), so it is added only on the
 * preview path — naming it on the published path would fail the query outright rather
 * than merely read something it should not.
 */
const ANNOUNCEMENT_COLUMNS =
  'message, link_type, link_page, link_url, link_label, expires_at, is_visible'

function toLinkType(value: string): 'none' | 'page' | 'url' {
  return value === 'page' || value === 'url' ? value : 'none'
}

/**
 * The announcement the site is configured to show, or `null`.
 *
 * `null` means "there is no bar": no row, switched off, nothing written, or no expiry.
 * It is deliberately not "an empty announcement" — 1ac is explicit that a bar which is
 * off "findes ikke i siden", so the layout has nothing to render rather than something
 * to hide.
 */
export const readAnnouncement = definePublicRead(
  'announcement',
  [CACHE_TAGS.announcement],
  async (access: ContentAccess): Promise<SiteAnnouncement | null> => {
    const { data, error } = await access.database
      .from('announcement')
      .select(columns(access, ANNOUNCEMENT_COLUMNS))
      .maybeSingle<AnnouncementRow>()

    assertNoQueryError('the announcement', error)
    if (data === null) return null

    const hasDraft =
      access.includeDrafts && data.draft !== null && data.draft !== undefined

    const { row } = overlayDraft<AnnouncementRow>(
      data,
      access.includeDrafts ? data.draft : null,
      announcementDraft,
    )

    // See the note above: on the preview path a pending draft is shown, because
    // publishing it would set `is_visible`.
    if (!data.is_visible && !hasDraft) return null

    const message = row.message === null ? null : row.message.trim()
    if (message === null || message.length === 0) return null

    // No expiry means nothing would ever take the message down, which 1ac forbids and
    // `publish_announcement()` refuses. A row in that state is not shown.
    if (row.expires_at === null) return null

    return {
      message,
      link: resolveAnnouncementLink({
        link_type: toLinkType(row.link_type),
        link_page: row.link_page,
        link_url: row.link_url,
        link_label: row.link_label,
      }),
      expiresAt: row.expires_at,
    }
  },
)
