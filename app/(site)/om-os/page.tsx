import { readAboutDocument } from '@/lib/content/pages'
import { pageMetadata } from '@/lib/seo/metadata'

import { ActionLink } from '@/components/site/ActionLink'
import { AwardBand } from '@/components/site/AwardBand'
import { Eyebrow } from '@/components/site/Eyebrow'
import { MediaPlaceholder } from '@/components/site/MediaPlaceholder'
import { PageContainer } from '@/components/site/PageContainer'
import { Section } from '@/components/site/Section'

/**
 * Om os — design 1i.
 *
 * Every paragraph on this page is placeholder text. 1ab lists "Historien om stedet",
 * "Kort afsnit om holdet (ingen navne)" and "Afsnit om tilgang og råvarer" as still
 * outstanding, so nothing about the restaurant's history or its people is invented — the
 * page renders whatever `pages.about` holds and no more.
 *
 * "Forenklet i denne version: ét holdfoto og ét kort afsnit. Ingen portrætter, navne
 * eller roller" (1i). That simplification is respected: there is no team-member list.
 */
export const metadata = pageMetadata(
  'Om os',
  'Historien om Klingenberg Food, burgerbaren i Carl Nielsen Hallen i Nørre Lyndelse.',
)

const TEAM_HEADING = 'Holdet'
const AWARD = {
  title: 'Vinder af Fyn & Øer — nr. 4 i Danmark',
  text: 'Danmarks Bedste Burger 2026. På konkurrencens liste står stedet som Carl Nielsen Caféen, Årslev — Klingenberg Food er navnet på hjemmesiden.',
}

export default async function OmOsPage() {
  const about = await readAboutDocument()

  return (
    <>
      <PageContainer className="py-7 md:py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-9">
          <div className="flex-1 lg:flex-[1.1]">
            <Eyebrow>Om os</Eyebrow>
            <h1 className="font-display mt-3 text-[2.25rem] leading-[1.02] tracking-[-0.03em] md:text-[3rem]">
              {about?.heading ?? 'Om os'}
            </h1>
            <div className="mt-4 flex flex-col gap-3.5">
              {(about?.storyBlocks ?? []).map((block) => (
                <p key={block} className="text-neutral-ink max-w-[52ch] md:text-[1.125rem]">
                  {block}
                </p>
              ))}
            </div>
          </div>

          <MediaPlaceholder
            ratio="portrait"
            label="Stedet"
            detail="facade / indgang ved hallen · dagslys"
            className="rounded-card-lg w-full flex-1 md:max-w-[26rem] md:self-start"
          />
        </div>
      </PageContainer>

      <AwardBand headingId="om-os-udmaerkelse" title={AWARD.title} text={AWARD.text} sealFirst />

      <Section ariaLabelledBy="om-os-holdet">
        <h2 id="om-os-holdet" className="font-display text-[1.75rem] md:text-title-sm">
          {TEAM_HEADING}
        </h2>
        <MediaPlaceholder
          ratio="team"
          label="Ét holdfoto — fuld bredde"
          detail="hele holdet samlet i køkkenet, naturligt lys"
          className="rounded-card-lg mt-4 w-full"
        />
        {about?.team.text ? (
          <p className="text-neutral-ink mt-5 max-w-[62ch] md:text-[1.125rem]">{about.team.text}</p>
        ) : null}
      </Section>

      <Section tone="beige" ariaLabelledBy="om-os-metode">
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:gap-9">
          <MediaPlaceholder
            ratio="hero"
            label="Køkken / tilberedning"
            className="rounded-card-lg w-full flex-1"
          />
          <div className="flex-1 lg:flex-[1.1]">
            <h2 id="om-os-metode" className="font-display text-[1.625rem] md:text-[1.875rem]">
              {about?.method.heading ?? 'Sådan laver vi burgere'}
            </h2>
            {about?.method.text ? (
              <p className="text-neutral-ink mt-3 max-w-[48ch] md:text-[1.0625rem]">
                {about.method.text}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col gap-2.5 md:flex-row">
              <ActionLink href="/menu" block className="md:w-auto">
                Se menuen
              </ActionLink>
              <ActionLink href="/find-os" variant="secondary" block className="md:w-auto">
                Find os
              </ActionLink>
            </div>
          </div>
        </div>
      </Section>
    </>
  )
}
