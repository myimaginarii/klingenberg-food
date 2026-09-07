import { SITE_ANNOUNCEMENT } from '@/content/site/announcement'
import { SITE_CONTACT } from '@/content/site/contact'
import { OPENING_HOURS } from '@/content/site/hours'
import { readOpenStatus } from '@/lib/hours/status'
import { directionsUrl, toPostalAddress } from '@/lib/site/links'
import { FOOTER_NAV, MAIN_NAV } from '@/lib/site/navigation'

import { AnnouncementRegion } from '@/components/site/announcement/AnnouncementRegion'
import { MobileBottomNav } from '@/components/site/layout/MobileBottomNav'
import { SiteFooter } from '@/components/site/layout/SiteFooter'
import { SiteHeader } from '@/components/site/layout/SiteHeader'

/**
 * The public shell — design 1g, 1l, 1n and technical plan §3.
 *
 * Header, content, footer and the persistent mobile bar, built once here so that the
 * six pages and the 404 cannot drift apart. Everything the shell needs — the contact
 * facts, the opening hours, the navigation and the announcement — is the tracked
 * content under `content/site/`, read at build time; the site has no database.
 *
 * **The announcement bar** (1ac) sits in the flow above `<SiteHeader>`.
 * `<AnnouncementRegion>` renders nothing when there is no current message, so a site
 * without one has no element, no padding and no reserved height.
 *
 * **The open/closed badge** is rendered from the build's clock and corrected in the
 * browser every minute by `OpenStatus` from the same pure engine and the same hours;
 * with scripting off the build-time value stands.
 *
 * Rendered by `app/(site)/layout.tsx` for the six pages and by `app/not-found.tsx`
 * for an address that matches no route, so a lost guest keeps the navigation.
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  const openStatus = readOpenStatus(new Date(), OPENING_HOURS.schedule, OPENING_HOURS.overrides)
  const address = toPostalAddress(SITE_CONTACT)

  return (
    <div className="flex min-h-screen flex-col pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] md:pb-0">
      {/* Padding is applied only on focus: a utility that sets it unconditionally would
          win over `sr-only`, giving the hidden link a 25 px box that a target-size check
          reads as a real, too-small control. */}
      <a
        href="#indhold"
        className="bg-brand-700 rounded-button sr-only font-semibold text-white focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-60 focus:inline-flex focus:min-h-tap focus:items-center focus:px-4"
      >
        Spring til indhold
      </a>

      <AnnouncementRegion announcement={SITE_ANNOUNCEMENT} />

      <SiteHeader
        items={MAIN_NAV}
        contact={SITE_CONTACT}
        openStatus={openStatus}
        schedule={OPENING_HOURS.schedule}
        overrides={OPENING_HOURS.overrides}
      />

      <main id="indhold" className="flex-1">
        {children}
      </main>

      <SiteFooter items={FOOTER_NAV} contact={SITE_CONTACT} schedule={OPENING_HOURS.schedule} />

      <MobileBottomNav
        primaryPhone={SITE_CONTACT.primaryPhone}
        directionsHref={address === null ? null : directionsUrl(address)}
      />
    </div>
  )
}
