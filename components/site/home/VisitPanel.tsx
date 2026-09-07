import { ActionLink } from '@/components/site/ActionLink'
import { AddressBlock } from '@/components/site/contact/AddressBlock'
import { PhoneNumbers } from '@/components/site/contact/PhoneNumbers'
import { Eyebrow } from '@/components/site/Eyebrow'
import { GoogleMap } from '@/components/site/GoogleMap'
import { OpeningHours } from '@/components/site/hours/OpeningHours'
import { OpenStatus } from '@/components/site/OpenStatus'
import { PhoneAction } from '@/components/site/PhoneAction'
import { Section } from '@/components/site/Section'
import type { SiteContact } from '@/lib/content/types'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { type PostalAddress, directionsUrl } from '@/lib/site/links'

/**
 * "Åbningstider · Find os · Kort" — design 1g and 1l.
 *
 * The three things a guest standing outside the hall actually wants: when it is open,
 * where it is, and how to call. The hours come from the same engine as the badge at the
 * top of the page, the address is real text beside the map rather than baked into it,
 * and the map itself is a Google Maps embed (§7g); "Vis vej" is the separate directions
 * link.
 */
export function VisitPanel({
  contact,
  address,
  schedule,
  overrides,
}: {
  contact: SiteContact
  address: PostalAddress | null
  schedule: WeeklySchedule
  overrides: OpeningHoursOverride[]
}) {
  return (
    <Section>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1.25fr] lg:gap-8">
        <div>
          <Eyebrow as="h2">Åbningstider</Eyebrow>
          <OpenStatus
            schedule={schedule}
            overrides={overrides}
            variant="pill"
            className="mt-3.5"
          />
          <OpeningHours schedule={schedule} className="mt-3.5" />
        </div>

        <div>
          <Eyebrow as="h2">Find os</Eyebrow>
          {address ? (
            <AddressBlock address={address} venueName={contact.venueName} className="mt-3.5" />
          ) : null}

          {contact.primaryPhone ? (
            <PhoneNumbers
              primaryPhone={contact.primaryPhone}
              secondaryPhone={contact.secondaryPhone}
              className="mt-3.5"
            />
          ) : null}

          <div className="mt-4 flex flex-col gap-2.5 md:flex-row">
            {contact.primaryPhone ? (
              <PhoneAction phone={contact.primaryPhone} label="Ring" block className="md:w-auto" />
            ) : null}
            {address ? (
              <ActionLink
                href={directionsUrl(address)}
                variant="secondary"
                block
                className="md:w-auto"
              >
                Vis vej
              </ActionLink>
            ) : null}
          </div>
        </div>

        {address ? (
          <GoogleMap address={address} frame="hero" className="md:col-span-2 lg:col-span-1" />
        ) : null}
      </div>
    </Section>
  )
}
