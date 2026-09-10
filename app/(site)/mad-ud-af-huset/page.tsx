import { loadContact } from '@/lib/content/load/contact'
import { loadTakeawayPage } from '@/lib/content/load/pages'
import { pageMetadata } from '@/lib/seo/metadata'
import { shareImage } from '@/lib/seo/share'

import { PageContainer } from '@/components/site/PageContainer'
import { PhoneAction } from '@/components/site/PhoneAction'
import { SiteImage } from '@/components/site/SiteImage'
import { TakeawayCallToAction } from '@/components/site/takeaway/TakeawayCallToAction'

/**
 * Mad ud af huset - design 1ai (desktop and mobile).
 *
 * The page is built as **free text**, not as a list of packages, and that is a
 * deliberate content decision rather than a layout one: "Ingen opfundne pakker, priser,
 * minimumsantal, leveringsregler eller bestillingsfrister. Siden er bygget som frie
 * afsnit, netop fordi vi ikke ved, hvad der skal stå" (1ai). 1ab lists all four of those
 * questions as still unanswered, so none of them is invented here.
 *
 * Two surfaces: the hero, which carries the heading, the intro and both numbers as the
 * page's `tel:` controls, and one burgundy band beneath it with the tracked section and
 * a single call to action. The band deliberately repeats neither the page title as an
 * eyebrow nor the numbers; the pre-launch pass found the earlier layout saying "ring
 * til os" four times over on one screen.
 *
 * The words, the button's label, the line under the numbers and the photograph are the
 * tracked document (`content/site/pages/takeaway.json`, read through
 * `lib/content/load/`): 1aj's "Billede (valgfrit)" in 1ai's 4:3 frame, rendered by the
 * one public renderer. Without one, *"fylder teksten hele bredden"* (1aj) - no frame is
 * reserved.
 */
export const metadata = pageMetadata(
  'Mad ud af huset',
  'Klingenberg Food laver mad ud af huset til fester og større selskaber. Ring og hør nærmere.',
  { path: '/mad-ud-af-huset', image: shareImage(loadTakeawayPage().image) },
)

export default function MadUdAfHusetPage() {
  const takeaway = loadTakeawayPage()
  const contact = loadContact()

  return (
    <>
      <PageContainer className="py-page-mobile md:py-page">
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:gap-9">
          <div className="flex-1 lg:flex-[1.1]">
            <h1 className="font-display text-page text-balance">
              {takeaway.heading ?? 'Mad ud af huset'}
            </h1>
            {takeaway.intro ? (
              <p className="text-neutral-ink text-lead mt-4 max-w-[50ch]">
                {takeaway.intro}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
              {contact.primaryPhone ? (
                <PhoneAction
                  phone={contact.primaryPhone}
                  label={takeaway.ctaLabel}
                  stacked
                  size="large"
                  block
                  className="md:w-auto"
                />
              ) : null}
              {contact.secondaryPhone ? (
                <PhoneAction
                  phone={contact.secondaryPhone}
                  label={contact.secondaryPhone}
                  variant="secondary"
                  size="large"
                  block
                  className="md:w-auto"
                />
              ) : null}
            </div>

            {takeaway.phoneNote ? (
              <p className="text-ink-3 text-detail mt-2.5">{takeaway.phoneNote}</p>
            ) : null}
          </div>

          {takeaway.image === null ? null : (
            <SiteImage
              image={takeaway.image}
              ratio="card"
              sizes="takeawayHero"
              loading="eager"
              placeholder={{ label: 'Foto - valgfrit' }}
              className="rounded-card-lg w-full flex-1"
            />
          )}
        </div>
      </PageContainer>

      <TakeawayCallToAction
        sections={takeaway.sections}
        primaryPhone={contact.primaryPhone}
        ctaLabel={takeaway.ctaLabel}
      />
    </>
  )
}
