import { resolveAnnouncementLink } from '@/lib/announcements/link'
import type { SiteAnnouncement } from '@/lib/content/types'

import { readContentJson } from './source'

/**
 * The one sitewide message — `content/site/announcement.json`; design 1ac.
 *
 * `active: false` is the state the site has always been in: the bar "findes ikke i
 * siden" rather than being hidden, so this loader answers `null` and the layout renders
 * no element, no padding and no reserved height. The message fields stay on disk while
 * inactive and are simply not read — nothing is invented to fill them.
 *
 * The link is **not** re-decided here. The four stored fields are handed to
 * `resolveAnnouncementLink` (`lib/announcements/link.ts`), which is where §8's two
 * rules already live: an internal destination must be one of the site's own six
 * routes, and an external one must be `https:` and is rendered with
 * `rel="noopener noreferrer"`. A half-filled link resolves to `null` there, and the
 * bar draws plain text.
 */
type AnnouncementFile = {
  active: boolean
  message: string | null
  expiresAt: string | null
  linkType: 'none' | 'page' | 'url'
  linkPage: string | null
  linkUrl: string | null
  linkLabel: string | null
}

export function loadAnnouncement(): SiteAnnouncement | null {
  const file = readContentJson<AnnouncementFile>('announcement.json')
  if (!file.active) return null

  if (file.message === null || file.expiresAt === null) {
    throw new TypeError(
      'content/site/announcement.json is active but has no message or no expiresAt. ' +
        'An announcement without either is not one — set "active": false instead.',
    )
  }

  return {
    message: file.message,
    link: resolveAnnouncementLink({
      link_type: file.linkType,
      link_page: file.linkPage,
      link_url: file.linkUrl,
      link_label: file.linkLabel,
    }),
    expiresAt: file.expiresAt,
  }
}
