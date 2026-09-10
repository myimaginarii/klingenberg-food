import { resolveAnnouncementLink } from '@/lib/announcements/link'
import type { SiteAnnouncement } from '@/lib/content/types'

import { validateAnnouncement } from '../validate/announcement'
import { assertValid } from '../validate/problems'

import { stored } from './cleared'
import { contentPath, once, readContentJson } from './source'

/**
 * The one sitewide message above the header — `content/site/announcement.json`;
 * design 1ac.
 *
 * `active: false` is the state the site has always been in: the bar "findes ikke i
 * siden" rather than being hidden, so this loader answers `null` and the layout renders
 * no element, no padding and no reserved height. The message fields stay on disk while
 * inactive and are simply not read — nothing is invented to fill them.
 *
 * The link is **not** re-decided here. The stored link is handed to
 * `resolveAnnouncementLink` (`lib/announcements/link.ts`), which is where §8's two
 * rules already live: an internal destination must be one of the site's own six
 * routes, and an external one must be `https:` and is rendered with
 * `rel="noopener noreferrer"`. A half-filled link resolves to `null` there, and the
 * bar draws plain text. The expiry is likewise the existing guard's: `expiresAt` is
 * the ISO 8601 instant the bar stops being shown, handed on unchanged.
 */
export type AnnouncementFile = {
  active: boolean
  message?: string | null
  expiresAt?: string | null
  link?: {
    type: 'none' | 'page' | 'url'
    page?: string | null
    url?: string | null
    label?: string | null
  } | null
}

/** The announcement one file means, or `null` for an inactive one. */
export function announcementFrom(file: AnnouncementFile, where: string): SiteAnnouncement | null {
  if (!file.active) return null

  if (!file.message || !file.expiresAt) {
    throw new Error(
      `${where} is active but has no message or no expiresAt. ` +
        'An announcement without either is not one — set "active": false instead.',
    )
  }

  const link = file.link ?? { type: 'none' }

  return {
    message: file.message,
    link: resolveAnnouncementLink({
      link_type: link.type,
      // The resolver's consistency rule is written about `null`: "type": "none" with a
      // page left behind is no link at all. A Pages CMS form clears those two controls
      // to `""` (`./cleared.ts`), which has to read as the same emptiness or a
      // switched-off link would resolve as a half-filled one.
      link_page: stored(link.page),
      link_url: stored(link.url),
      link_label: link.label ?? null,
    }),
    expiresAt: file.expiresAt,
  }
}

export const loadAnnouncement = once((): SiteAnnouncement | null => {
  const file = readContentJson<AnnouncementFile>('announcement.json')
  assertValid(validateAnnouncement(file, contentPath('announcement.json')))

  return announcementFrom(file, contentPath('announcement.json'))
})
