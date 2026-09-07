import { SITE_CONTACT } from '@/content/site/contact'
import { OPENING_HOURS } from '@/content/site/hours'
import { socialImage } from '@/content/site/images'
import { pageMetadata } from '@/lib/seo/metadata'
import { directionsUrl, formatAddressLine, toPostalAddress } from '@/lib/site/links'

import { ActionLink } from '@/components/site/ActionLink'
import { RestaurantJsonLd } from '@/components/site/RestaurantJsonLd'
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
 * The description names the address, so it is built from the same tracked contact
 * facts the page prints — never a second copy of the address.
 */
function describeWhere(): string {
  const address = toPostalAddress(SITE_CONTACT)
  const place = [SITE_CONTACT.venueName, address === null ? null : formatAddressLine(address)]
    .filter((part): part is string => part !== null)
    .join(', ')

  return place.length === 0 ? 'Klingenberg Food' : `Klingenberg Food ligger i ${place}`
}

export const metadata = pageMetadata(
  'Find os og åbningstider',
  `${describeWhere()}. Se åbningstider og ring for at bestille.`,
  { path: '/find-os', image: socialImage('about-venue') },
)

/**
 * Find os — design 1k (desktop) and 1o (mobile, the primary mobile screen).
 *
 * The two things a guest arrives here for are at the top and full width on a phone: ring
 * and vis vej. The address is real text, the hours are the site's one schedule, and the
 * map is a Google Maps embed centred on the restaurant's listing, with no map library
 * and no tile request from this origin (§7g).
 *
 * The "Følg os" card appears only when the Facebook link is filled in — an empty field
 * removes the whole card rather than leaving a gap (1k, 1o).
 */
export default function FindOsPage() {
  const contact = SITE_CONTACT
  const hours = OPENING_HOURS
  const address = toPostalAddress(contact)

  return (
    <PageContainer className="py-page-mobile md:py-page">
      {/* The same §11 Restaurant block the Forside carries, under the same `@id`: this
          is the page a local search lands on for the address and the hours, and the
          markup restates exactly what is printed below it. */}
      <RestaurantJsonLd />

      <div className="grid gap-8 md:grid-cols-[1fr_1.15fr] md:gap-9">
        <div>
          <h1 className="font-display text-page">Find os</h1>

          <OpenStatus
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
            <OpeningHours schedule={hours.schedule} className="mt-3" />
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
