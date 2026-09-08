import { ActionLink } from '@/components/site/ActionLink'
import { AwardBand } from '@/components/site/AwardBand'
import { Eyebrow } from '@/components/site/Eyebrow'
import { PageContainer } from '@/components/site/PageContainer'
import { Section } from '@/components/site/Section'
import { SiteImage } from '@/components/site/SiteImage'
import type { AboutDocument } from '@/lib/content/types'
import { ABOUT_DEFAULT_HEADING, ABOUT_DEFAULT_METHOD_HEADING } from '@/lib/site/defaults'

/**
 * Om os — design 1i, rendered from the published (or previewed) document.
 *
 * Pure server markup over the document the route reads, so the page can be asserted as
 * HTML without a database (`tests/unit/about/about-page.test.tsx`). The three frames 1i
 * reserves — "Stedet" beside the story, "Ét holdfoto — fuld bredde", "Køkken /
 * tilberedning" beside the method — are real image slots, drawn by the one public
 * renderer in exactly the boxes the placeholders reserved. The venue slot always has a
 * photograph (the restaurant supplied its facade/interior shot, 14B2) and keeps its
 * reserved frame if that ever changes. The restaurant has no team or kitchen photograph
 * yet, and does not treat either as required launch photography (14B2, §0an) — so those
 * two frames are the no-image state's own thing: with `team.image_id` or
 * `method.image_id` null, the section renders text-only (no reserved photo frame) rather
 * than the hatched placeholder, and the reserved-frame layout returns automatically the
 * moment the Owner selects a photograph for that slot. `break-words` on the headings and
 * paragraphs is unrelated: the editor admits a 120-character heading and 2,000-character
 * paragraphs, and a long unbroken word in one of them must wrap inside the 375 px column
 * rather than scroll the page sideways.
 *
 * "Forenklet i denne version: ét holdfoto og ét kort afsnit. Ingen portrætter, navne
 * eller roller" (1i). That simplification is respected: there is no team-member list.
 *
 * THE AWARD BAND IS NOT THE DOCUMENT'S. Its words are the confirmed competition result
 * (1ab) and are stated here, once; its photograph is the Forside document's own
 * (`home.award.image_id`, the Owner's). Om os carries no second award source, so the
 * band draws the reserved frame it has always drawn (§0am).
 */

const TEAM_HEADING = 'Holdet'
const AWARD = {
  title: 'Vinder af Fyn & Øer og nr. 4 i Danmark',
  text: 'Danmarks Bedste Burger 2026. I konkurrencen er vi opført som Carl Nielsen Caféen, Årslev.',
}

export function AboutPageContent({ about }: { about: AboutDocument | null }) {
  return (
    <>
      <PageContainer className="py-page-mobile md:py-page">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-9">
          <div className="flex-1 lg:flex-[1.1]">
            <Eyebrow>Om os</Eyebrow>
            <h1 className="font-display text-page mt-3 break-words">
              {about?.heading ?? ABOUT_DEFAULT_HEADING}
            </h1>
            <div className="mt-4 flex flex-col gap-3.5">
              {(about?.storyBlocks ?? []).map((block, index) => (
                <p key={index} className="text-neutral-ink text-lead max-w-[54ch] break-words">
                  {block}
                </p>
              ))}
            </div>
          </div>

          <SiteImage
            image={about?.venueImage ?? null}
            ratio="portrait"
            sizes="aboutVenue"
            loading="eager"
            placeholder={{ label: 'Stedet', detail: 'facade / indgang ved hallen · dagslys' }}
            className="rounded-card-lg w-full flex-1 md:max-w-[26rem] md:self-start"
          />
        </div>
      </PageContainer>

      <AwardBand headingId="om-os-udmaerkelse" title={AWARD.title} text={AWARD.text} sealFirst />

      <Section ariaLabelledBy="om-os-holdet">
        <h2 id="om-os-holdet" className="font-display text-subhead">
          {TEAM_HEADING}
        </h2>
        {about?.team.image ? (
          <SiteImage
            image={about.team.image}
            ratio="team"
            sizes="aboutTeam"
            placeholder={{
              label: 'Ét holdfoto - fuld bredde',
              detail: 'hele holdet samlet i køkkenet, naturligt lys',
            }}
            className="rounded-card-lg mt-4 w-full"
          />
        ) : null}
        {about?.team.text ? (
          <p
            className={`text-neutral-ink text-lead max-w-[62ch] break-words ${about?.team.image ? 'mt-5' : 'mt-4'}`}
          >
            {about.team.text}
          </p>
        ) : null}
      </Section>

      <Section tone="beige" ariaLabelledBy="om-os-metode">
        <div
          className={
            about?.method.image ? 'flex flex-col gap-8 md:flex-row md:items-center md:gap-9' : undefined
          }
        >
          {about?.method.image ? (
            <SiteImage
              image={about.method.image}
              ratio="hero"
              sizes="aboutKitchen"
              placeholder={{ label: 'Køkken / tilberedning' }}
              className="rounded-card-lg w-full flex-1"
            />
          ) : null}
          <div className={about?.method.image ? 'flex-1 lg:flex-[1.1]' : undefined}>
            <h2 id="om-os-metode" className="font-display text-subhead break-words">
              {about?.method.heading ?? ABOUT_DEFAULT_METHOD_HEADING}
            </h2>
            {about?.method.text ? (
              <p
                className={`text-neutral-ink text-lead mt-3 break-words ${about?.method.image ? 'max-w-[48ch]' : 'max-w-[62ch]'}`}
              >
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
