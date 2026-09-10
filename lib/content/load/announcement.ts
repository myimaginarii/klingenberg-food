import { resolveAnnouncementLink } from '@/lib/announcements/link'
import type { SiteAnnouncement } from '@/lib/content/types'
import { copenhagenInstantOf } from '@/lib/time/copenhagen'

import { announcementExpiryWallClock, validateAnnouncement } from '../validate/announcement'
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
 * bar draws plain text.
 *
 * THE EXPIRY IS THE ONE VALUE THIS LOADER CONVERTS.
 *
 * On disk it is a **Copenhagen wall clock** — `2026-09-11T12:00` is what the restaurant
 * means by "noon on the eleventh", with no offset written down, because the offset is a
 * fact about the calendar rather than about the notice. The loaded `SiteAnnouncement`
 * carries an **absolute instant** instead, because that is what the expiry rule
 * compares and what the client guard is handed: `2026-09-11T10:00:00.000Z` in summer,
 * and the same wall clock in December resolves to `11:00:00.000Z`.
 *
 * The conversion is `copenhagenInstantOf` (`lib/time/copenhagen.ts`), the one module in
 * the repository that is allowed to name a timezone, and it happens **here and nowhere
 * else**. Downstream — `AnnouncementRegion`, `AnnouncementExpiryGuard`,
 * `isAnnouncementExpired` — goes on comparing instants exactly as before and has no
 * timezone in it at all; putting an `Intl` conversion in the browser would make the bar
 * disappear at a different moment for a guest whose phone is set to another country.
 */
export type AnnouncementFile = {
  active: boolean
  message?: string | null
  /** A Copenhagen wall clock, `YYYY-MM-DDTHH:mm` — **not** an instant. See above. */
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

  // Validation has already refused every shape but the wall clock, so a `null` here
  // means `announcementFrom` was called directly with an unvalidated document — a
  // programmer error, and one that must not be resolved into a plausible wrong instant.
  const wallClock = announcementExpiryWallClock(file.expiresAt)
  if (wallClock === null) {
    throw new Error(
      `${where} has an expiresAt that is not a Copenhagen wall clock (YYYY-MM-DDTHH:mm). ` +
        `Received: ${JSON.stringify(file.expiresAt)}.`,
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
    expiresAt: copenhagenInstantOf(wallClock.date, wallClock.time).toISOString(),
  }
}

export const loadAnnouncement = once((): SiteAnnouncement | null => {
  const file = readContentJson<AnnouncementFile>('announcement.json')
  assertValid(validateAnnouncement(file, contentPath('announcement.json')))

  return announcementFrom(file, contentPath('announcement.json'))
})
