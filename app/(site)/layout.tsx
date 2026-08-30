import { readAnnouncement } from '@/lib/content/announcement'
import { readSiteContact } from '@/lib/content/contact'
import { readOpeningHours } from '@/lib/content/hours'
import { readHiddenPageKeys } from '@/lib/content/pages'
import { readOpenStatus } from '@/lib/hours/status'
import { directionsUrl, toPostalAddress } from '@/lib/site/links'
import { FOOTER_NAV, MAIN_NAV, visibleNav } from '@/lib/site/navigation'

import { AnnouncementRegion } from '@/components/site/announcement/AnnouncementRegion'
import { MobileBottomNav } from '@/components/site/layout/MobileBottomNav'
import { SiteFooter } from '@/components/site/layout/SiteFooter'
import { SiteHeader } from '@/components/site/layout/SiteHeader'
import { PreviewBar } from '@/components/site/PreviewBar'

/**
 * The public shell — design 1g, 1l, 1n and technical plan §3.
 *
 * Header, content, footer and the persistent mobile bar, built once here so that six
 * pages cannot drift apart. Everything the shell needs — the contact facts, the opening
 * hours and which optional pages are switched on — is read once per request and shared
 * with the pages beneath it through React's `cache`, so a page that also needs the hours
 * does not ask for them twice.
 *
 * **The announcement bar** (1ac) sits in the flow above `<SiteHeader>`, which is where
 * phase 3 left room for it. It is a layout concern and only a layout concern: one read,
 * one region, on every public page or on none. `<AnnouncementRegion>` renders nothing
 * when there is no current message, so a site without one is byte-identical to what it
 * was before phase 7 — no element, no padding, no reserved height (1ac).
 *
 * **Preview.** `<PreviewBar>` renders nothing unless the request is an authenticated
 * staff preview (§6). It is above everything else because it describes the whole page
 * beneath it, and it costs a visitor nothing: no markup, no cookie, no JavaScript.
 *
 * **Revalidation.** Every public route re-generates at most five minutes after it was
 * last built (§7a). That is the safety net three time-dependent behaviours lean on: the
 * sold-out reset, the Månedens burger window and the open/closed badge — the last of
 * which is also corrected minute by minute in the browser.
 *
 * On top of that, each cached read carries the §6 cache tags, and publishing expires
 * exactly the tags the published entity appears in (`lib/cache/tags.ts`). So a publish
 * shows on the next request rather than within five minutes, and the five minutes stay
 * as the safety net they were built to be.
 */
export const revalidate = 300

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [contact, hours, hiddenPageKeys, announcement] = await Promise.all([
    readSiteContact(),
    readOpeningHours(),
    readHiddenPageKeys(),
    readAnnouncement(),
  ])

  const navItems = visibleNav(MAIN_NAV, hiddenPageKeys)
  const footerItems = visibleNav(FOOTER_NAV, hiddenPageKeys)
  const openStatus = readOpenStatus(new Date(), hours.schedule, hours.overrides)
  const address = toPostalAddress(contact)

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

      <PreviewBar />

      <AnnouncementRegion announcement={announcement} />

      <SiteHeader
        items={navItems}
        contact={contact}
        openStatus={openStatus}
        schedule={hours.schedule}
        overrides={hours.overrides}
      />

      <main id="indhold" className="flex-1">
        {children}
      </main>

      <SiteFooter items={footerItems} contact={contact} schedule={hours.schedule} />

      <MobileBottomNav
        primaryPhone={contact.primaryPhone}
        directionsHref={address === null ? null : directionsUrl(address)}
      />
    </div>
  )
}
