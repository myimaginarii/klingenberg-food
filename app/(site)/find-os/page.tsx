import type { Metadata } from 'next'

import { readSiteContact } from '@/lib/content/contact'
import { readOpeningHours } from '@/lib/content/hours'
import { readOpenStatus } from '@/lib/hours/status'
import { pageMetadata } from '@/lib/seo/metadata'
import { directionsUrl, formatAddressLine, toPostalAddress } from '@/lib/site/links'

import { ActionLink } from '@/components/site/ActionLink'
import { AddressBlock } from '@/components/site/contact/AddressBlock'
import { EmailBlock } from '@/components/site/contact/EmailBlock'
import { FollowUsCard } from '@/components/site/contact/FollowUsCard'
import { PhoneNumbers } from '@/components/site/contact/PhoneNumbers'
import { Eyebrow } from '@/components/site/Eyebrow'
import { GoogleMap } from '@/components/site/GoogleMap'
import { OpeningHours } from '@/components/site/hours/OpeningHours'
import { OpenStatus } from '@/components/site/OpenStatus'
import { PageContainer } from '@/components/site/PageContainer'
import { PhoneAction } from '@/components/site/PhoneAction'

/**
 * The description names the address, so it is read from `site_contact` like every
 * other place the address is printed (phase 11 lock pass): since 11B the Owner edits
 * the address, and a literal here would be the one copy the editor could not reach.
 * The same cached, `contact`-tagged read the page uses, so a published change reaches
 * the description on the same first request as the page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const contact = await readSiteContact()
  const address = toPostalAddress(contact)
  const place = [contact.venueName, address === null ? null : formatAddressLine(address)]
    .filter((part): part is string => part !== null)
    .join(', ')
  const where = place.length === 0 ? 'Klingenberg Food' : `Klingenberg Food ligger i ${place}`

  return pageMetadata('Find os', `${where}. Se åbningstider og ring for at bestille.`)
}

/**
 * Find os — design 1k (desktop) and 1o (mobile, the primary mobile screen).
 *
 * The two things a guest arrives here for are at the top and full width on a phone: ring
 * and vis vej. The address is real text, the hours are the site's one schedule, and the
 * map is a Google Maps embed centred on the stored address, with no map library and no
 * tile request from this origin (§7g).
 *
 * The "Følg os" card appears only when the Facebook link is filled in — an empty field
 * removes the whole card rather than leaving a gap (1k, 1o).
 */
export default async function FindOsPage() {
  const [contact, hours] = await Promise.all([readSiteContact(), readOpeningHours()])

  const openStatus = readOpenStatus(new Date(), hours.schedule, hours.overrides)
  const address = toPostalAddress(contact)

  return (
    <PageContainer className="py-page-mobile md:py-page">
      <div className="grid gap-8 md:grid-cols-[1fr_1.15fr] md:gap-9">
        <div>
          <h1 className="font-display text-page">Find os</h1>

          <OpenStatus
            initialStatus={openStatus}
            schedule={hours.schedule}
            overrides={hours.overrides}
            variant="pill"
            className="mt-4"
          />

          <div className="mt-5 flex flex-col gap-2.5 md:flex-row">
            {contact.primaryPhone ? (
              <PhoneAction
                phone={contact.primaryPhone}
                label="Ring"
                showNumber
                size="large"
                block
                className="md:w-auto"
              />
            ) : null}
            {address ? (
              <ActionLink
                href={directionsUrl(address)}
                variant="secondary"
                size="large"
                block
                className="md:w-auto"
              >
                Vis vej
              </ActionLink>
            ) : null}
          </div>

          {address ? (
            <div className="mt-7">
              <Eyebrow>Adresse</Eyebrow>
              <AddressBlock address={address} venueName={contact.venueName} className="mt-2.5" />
            </div>
          ) : null}

          {contact.primaryPhone ? (
            <div className="mt-7">
              <Eyebrow>Telefon</Eyebrow>
              <PhoneNumbers
                primaryPhone={contact.primaryPhone}
                secondaryPhone={contact.secondaryPhone}
                size="prominent"
                className="mt-2.5"
              />
            </div>
          ) : null}

          {/* Beside the numbers, and after them: the telephone is the confirmed way to
              order (1k), and an e-mail address is the slower alternative, not a rival
              call to action. It is the only place on the site that prints it. */}
          <EmailBlock email={contact.email} className="mt-7" />

          <section
            id="aabningstider"
            aria-labelledby="find-os-tider"
            className="bg-surface border-border rounded-card-lg mt-7 scroll-mt-4 border p-4 md:p-5"
          >
            <Eyebrow as="h2" id="find-os-tider">
              Åbningstider
            </Eyebrow>
            <OpeningHours
              schedule={hours.schedule}
              todayWeekday={openStatus.todayWeekday}
              className="mt-3"
            />
          </section>
        </div>

        <div className="flex flex-col gap-4.5">
          {/* The map takes the height the left column sets, so the two columns end level
              instead of leaving a block of empty page under the Følg os card. */}
          {address ? (
            <GoogleMap address={address} frame="card" className="md:aspect-auto md:flex-1" />
          ) : null}

          <FollowUsCard facebookUrl={contact.facebookUrl} />
        </div>
      </div>
    </PageContainer>
  )
}
