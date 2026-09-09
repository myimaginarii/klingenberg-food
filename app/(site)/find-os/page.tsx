import { SITE_CONTACT } from '@/content/site/contact'
import { OPENING_HOURS } from '@/content/site/hours'
import { socialImage } from '@/content/site/images'
import { pageMetadata } from '@/lib/seo/metadata'
import { formatAddressLine, toPostalAddress } from '@/lib/site/links'

import { RestaurantJsonLd } from '@/components/site/RestaurantJsonLd'
import { AddressBlock } from '@/components/site/contact/AddressBlock'
import { EmailBlock } from '@/components/site/contact/EmailBlock'
import { PhoneNumbers } from '@/components/site/contact/PhoneNumbers'
import { Eyebrow } from '@/components/site/Eyebrow'
import { GoogleMap } from '@/components/site/GoogleMap'
import { OpeningHours } from '@/components/site/hours/OpeningHours'
import { OpenStatus } from '@/components/site/OpenStatus'
import { PageContainer } from '@/components/site/PageContainer'

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
 * Find os — design 1k (desktop) and 1o (mobile, the primary mobile screen), simplified
 * for launch.
 *
 * One column of facts beside one map. Each way of reaching the restaurant is stated
 * once, under its own label: the address is real text, the primary number is the
 * "Ring" action inside the Telefon block rather than a second button above it, the
 * e-mail address follows, and the hours are the site's one schedule. The map is a
 * Google Maps embed centred on the restaurant's listing, with no map library and no
 * tile request from this origin (§7g); it is also the page's directions, which is why
 * there is no separate "Vis vej" here — the bottom bar and the Forside still carry one.
 *
 * The Facebook link lives in the footer of every page, so this page carries no
 * "Følg os" card of its own.
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

        {/* The map is the whole right column. On a phone it keeps the drawn 4:3 frame
            under the facts; from `md` it takes the height the left column sets, so the
            two columns end level instead of leaving empty page beneath the map. */}
        {address ? <GoogleMap address={address} frame="card" className="md:aspect-auto" /> : null}
      </div>
    </PageContainer>
  )
}
