import { formatWeeklyHoursLines } from '@/lib/hours/format'
import type { WeeklySchedule } from '@/lib/hours/types'
import type { SiteContact } from '@/lib/content/types'
import { type PostalAddress, directionsUrl } from '@/lib/site/links'

import { ActionLink } from '../ActionLink'
import { PageContainer } from '../PageContainer'
import { PhoneAction } from '../PhoneAction'

/**
 * The bar at the foot of the menu — design 1h.
 *
 * A guest who has read the menu wants two things next: to ring, and to know when. Both
 * are here, and the hours come from the same schedule the header badge and the footer
 * use — `formatWeeklyHoursLines`, the grouping phase 2 tested.
 */
export function MenuOrderBar({
  contact,
  address,
  schedule,
}: {
  contact: SiteContact
  address: PostalAddress | null
  schedule: WeeklySchedule
}) {
  return (
    <section aria-label="Bestilling" className="bg-section border-border border-t">
      <PageContainer className="flex flex-col gap-4 py-7 md:flex-row md:items-center">
        {contact.primaryPhone ? (
          <PhoneAction phone={contact.primaryPhone} label="Bestil på telefon" showNumber />
        ) : null}
        {address ? (
          <ActionLink href={directionsUrl(address)} variant="secondary">
            Vis vej
          </ActionLink>
        ) : null}
        <p className="text-ink-2 text-nav tabular-nums">
          {formatWeeklyHoursLines(schedule).join(' · ')}
          {contact.secondaryPhone ? (
            <>
              <br />
              {`Ekstra nummer ${contact.secondaryPhone}`}
            </>
          ) : null}
        </p>
      </PageContainer>
    </section>
  )
}
