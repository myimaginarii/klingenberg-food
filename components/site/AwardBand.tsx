import type { PublicImage } from '@/lib/images/public'

import { AwardSeal } from './AwardSeal'
import { Eyebrow } from './Eyebrow'
import { Section } from './Section'
import { SiteImage } from './SiteImage'

/**
 * The burgundy award band — design 1g (Forside) and 1i (Om os).
 *
 * The wording is the confirmed competition result and nothing more (1ab): winner of Fyn
 * & Øer, number four in Denmark, Danmarks Bedste Burger 2026, and the note that the
 * competition lists the restaurant under its other name. No jury quote is invented, and
 * the competition's own red seal is not reproduced.
 *
 * The Forside puts the photograph first and the seal last; Om os mirrors it. That is
 * the only difference between the two, so it is a prop rather than a second component.
 *
 * The photograph (phase 11A) is the Forside document's award image — 1u's
 * "Udmærkelsesfoto (valgfrit)" — in the 4:3 frame the band reserved; `null` is the
 * reserved frame as before. Om os passes nothing, deliberately: the award photograph is
 * the Forside's one fact, and the Om os document carries no second copy of it (§0am), so
 * the band there draws the frame it always drew.
 */
export function AwardBand({
  title,
  text,
  headingId,
  sealFirst = false,
  image = null,
}: {
  title: string
  text: string
  headingId: string
  sealFirst?: boolean
  image?: PublicImage | null
}) {
  // 1l drops the seal on a phone, where the photograph and the wording already carry
  // the award and a 132 px circle would be a third telling of the same thing.
  const seal = (
    <div className="hidden md:block">
      <AwardSeal size={sealFirst ? 'compact' : 'default'} />
    </div>
  )
  const photo = (
    <SiteImage
      image={image}
      ratio="card"
      sizes="homeAward"
      placeholder={{ label: 'Udmærkelse', detail: 'diplom eller pokal · afventer', tone: 'inverse' }}
      className="rounded-card w-full shrink-0 md:w-[13.75rem]"
    />
  )

  return (
    <Section tone="brand" ariaLabelledBy={headingId}>
      <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:gap-8">
        {sealFirst ? seal : photo}
        <div className="flex-1">
          <Eyebrow tone="inverse">Udmærkelse</Eyebrow>
          <h2
            id={headingId}
            className="font-display mt-3 text-title-sm text-white md:text-title text-balance"
          >
            {title}
          </h2>
          <p className="mt-3 max-w-[58ch] text-white/85">{text}</p>
        </div>
        {sealFirst ? photo : seal}
      </div>
    </Section>
  )
}
