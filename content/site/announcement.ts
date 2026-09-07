import type { SiteAnnouncement } from '@/lib/content/types'

/**
 * The sitewide message above the header — design 1ac.
 *
 * There is none: the bar "findes ikke i siden" (1ac) rather than being hidden, so the
 * layout renders nothing at all. A message is a `SiteAnnouncement` here — the words,
 * an optional link and the instant it stops being shown — and the existing region,
 * bar and browser-side expiry guard render it unchanged.
 */
export const SITE_ANNOUNCEMENT: SiteAnnouncement | null = null
