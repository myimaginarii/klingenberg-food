import { notFound } from 'next/navigation'

import { readSiteContact } from '@/lib/content/contact'
import { readTakeawayDocument } from '@/lib/content/pages'
import { TAKEAWAY_DEFAULT_CTA_LABEL } from '@/lib/pages/takeaway'
import { pageMetadata } from '@/lib/seo/metadata'

import { Eyebrow } from '@/components/site/Eyebrow'
import { PageContainer } from '@/components/site/PageContainer'
import { PhoneAction } from '@/components/site/PhoneAction'
import { SiteImage } from '@/components/site/SiteImage'
import { TakeawayCallToAction } from '@/components/site/takeaway/TakeawayCallToAction'
import { TakeawaySections } from '@/components/site/takeaway/TakeawaySections'

/**
 * Mad ud af huset — design 1ai (desktop and mobile).
 *
 * The page is built as **free text sections**, not as a list of packages, and that is a
 * deliberate content decision rather than a layout one: "Ingen opfundne pakker, priser,
 * minimumsantal, leveringsregler eller bestillingsfrister. Siden er bygget som frie
 * afsnit, netop fordi vi ikke ved, hvad der skal stå" (1ai). 1ab lists all four of those
 * questions as still unanswered, so none of them is invented here.
 *
 * The page can be switched off from the administration. When it is, `pages.takeaway` is
 * unreadable to the public — the RLS policy sees to that — so this route 404s and the
 * navigation item disappears, from one rule in one place. Since phase 11B the switch is
 * published like every other field on 1aj, so a guest sees the change on the first
 * request after Offentliggør and not before.
 *
 * The photograph (phase 11B) is 1aj's "Billede (valgfrit)": the page's own library
 * image in 1ai's 4:3 frame, rendered by the one public renderer. Without one, *"fylder
 * teksten hele bredden"* (1aj) — no frame is reserved.
 */
export const metadata = pageMetadata(
  'Mad ud af huset',
  'Klingenberg Food laver mad ud af huset til fester og større selskaber. Ring og hør nærmere.',
)

const NO_FORM_NOTE = 'Bestilling og aftaler klares over telefonen — der er ingen formular.'

export default async function MadUdAfHusetPage() {
  const [contact, takeaway] = await Promise.all([readSiteContact(), readTakeawayDocument()])

  if (takeaway === null) notFound()

  return (
    <>
      <PageContainer className="py-7 md:py-11">
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:gap-9">
          <div className="flex-1 lg:flex-[1.1]">
            <Eyebrow>Mad ud af huset</Eyebrow>
            <h1 className="font-display mt-3 text-[2.25rem] leading-[1.02] tracking-[-0.03em] text-balance md:text-[3rem]">
              {takeaway.heading ?? 'Mad ud af huset'}
            </h1>
            {takeaway.intro ? (
              <p className="text-neutral-ink mt-4 max-w-[50ch] md:text-[1.125rem]">
                {takeaway.intro}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
              {contact.primaryPhone ? (
                <PhoneAction
                  phone={contact.primaryPhone}
                  label={takeaway.ctaLabel ?? TAKEAWAY_DEFAULT_CTA_LABEL}
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

            <p className="text-ink-3 mt-2.5 text-meta">{NO_FORM_NOTE}</p>
          </div>

          {takeaway.image === null ? null : (
            <SiteImage
              image={takeaway.image}
              ratio="card"
              sizes="takeawayHero"
              loading="eager"
              placeholder={{ label: 'Foto — valgfrit' }}
              className="rounded-card-lg w-full flex-1"
            />
          )}
        </div>
      </PageContainer>

      <TakeawaySections sections={takeaway.sections} />

      <TakeawayCallToAction
        primaryPhone={contact.primaryPhone}
        secondaryPhone={contact.secondaryPhone}
      />
    </>
  )
}
