import Link from 'next/link'

import type { SiteContact } from '@/lib/content/types'
import type { OpenStatusSnapshot } from '@/lib/hours/status'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import type { NavItem } from '@/lib/site/navigation'

import { PageContainer } from '../PageContainer'
import { PhoneAction } from '../PhoneAction'
import { DesktopNav } from './DesktopNav'
import { MobileMenu } from './MobileMenu'
import { SiteLogo } from './SiteLogo'

/**
 * The site header — design 1g, 1l, 1ai.
 *
 * Deliberately not sticky: the approved design pins the menu page's category bar to the
 * top of the viewport, and a sticky header would either cover it or steal its place.
 *
 * The announcement bar the design draws above this is `AnnouncementRegion`, rendered by
 * the shared layout in the flow above the header (1ac, phase 7A). Nothing in this
 * component knows about it: the bar pushes the header down rather than overlapping it,
 * which is the whole reason 1ac keeps it in the flow.
 */
export function SiteHeader({
  items,
  contact,
  openStatus,
  schedule,
  overrides,
}: {
  items: readonly NavItem[]
  contact: SiteContact
  openStatus: OpenStatusSnapshot
  schedule: WeeklySchedule
  overrides: OpeningHoursOverride[]
}) {
  return (
    <header className="border-border bg-bg border-b">
      <PageContainer>
        <div className="flex items-center justify-between gap-4 py-2.5 md:py-4">
          {/* The visible wordmark names the link; an extra hidden label would only be
              read out twice. */}
          <Link href="/" className="inline-flex min-h-tap items-center no-underline">
            <SiteLogo />
          </Link>

          <div className="hidden items-center gap-7 lg:flex">
            <DesktopNav items={items} />
            {contact.primaryPhone ? (
              <PhoneAction
                phone={contact.primaryPhone}
                label="Ring"
                showNumber
                size="compact"
              />
            ) : null}
          </div>

          <MobileMenu
            items={items}
            contact={contact}
            openStatus={openStatus}
            schedule={schedule}
            overrides={overrides}
          />
        </div>
      </PageContainer>
    </header>
  )
}
