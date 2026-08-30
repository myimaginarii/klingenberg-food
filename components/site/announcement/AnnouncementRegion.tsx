import { isAnnouncementExpired } from '@/lib/announcements/expiry'
import { ANNOUNCEMENT_REGION_LABEL } from '@/lib/announcements/lifecycle'
import type { SiteAnnouncement } from '@/lib/content/types'

import { AnnouncementBar } from './AnnouncementBar'
import { AnnouncementExpiryGuard } from './AnnouncementExpiryGuard'

/**
 * The announcement's place in the public shell — design 1ac; technical plan §3, §7c.
 *
 * A Server Component that renders **nothing at all** unless there is a current message.
 * 1ac is explicit about what "off" means: *"Bjælken er ikke skjult med et tomt felt: den
 * findes ikke i siden"* — so an absent announcement produces no element, no padding and
 * no reserved height, and the header sits at the very top of the page exactly as it did
 * before this phase.
 *
 * It is a **layout** concern and lives in the layout. The bar is above the navigation on
 * every public page or on none of them; no page component renders it, and none can.
 *
 * THE SECOND OF THREE EXPIRY LAYERS (§7c)
 *
 * `lib/content/announcement.ts` answers "is an announcement configured to be shown?" and
 * deliberately takes no clock reading, because that read is cached for up to five minutes
 * and a clock inside it would be frozen with the entry. This component answers the other
 * half against **this render's** clock, which is what makes "an expired announcement is
 * never rendered from a fresh page load" true rather than approximately true. The two
 * halves together are `isAnnouncementPubliclyVisible`, and the unit suite asserts that
 * composition.
 *
 * The third layer is the browser's, for a page that was already on screen when the expiry
 * passed. It is the only one that needs JavaScript, and with JavaScript off the
 * server-rendered value stands — at most five minutes stale, exactly as §7a specifies.
 *
 * ACCESSIBILITY — 1ac's "Skærmlæser" note, in full
 *
 * *"Bjælken annonceres som region med `aria-live="polite"` og etiketten 'Besked fra
 * restauranten' — den flytter ikke fokus og afbryder ikke gæsten."*
 *
 * The region is a `<section>` with that label, and it stays mounted for the life of the
 * page: the guard removes the bar's *content*, not the region, so a disappearance is not
 * announced as a region vanishing and a screen reader is never interrupted (§7c). There
 * is no dismiss control — a guest cannot close this bar — and nothing here moves focus.
 */
export function AnnouncementRegion({
  announcement,
}: {
  announcement: SiteAnnouncement | null
}) {
  if (announcement === null) return null

  // One clock reading for this render. Server-side filtering is the first line of truth;
  // the guard below is a correction, never the rule.
  if (isAnnouncementExpired(announcement.expiresAt, new Date())) return null

  return (
    <section aria-label={ANNOUNCEMENT_REGION_LABEL} aria-live="polite">
      <AnnouncementExpiryGuard expiresAt={announcement.expiresAt}>
        <AnnouncementBar link={announcement.link} message={announcement.message} />
      </AnnouncementExpiryGuard>
    </section>
  )
}
