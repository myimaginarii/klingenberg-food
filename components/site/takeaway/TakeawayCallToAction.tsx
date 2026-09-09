import type { TakeawaySection } from '@/lib/content/types'

import { PhoneAction } from '../PhoneAction'
import { Section } from '../Section'

/**
 * The burgundy band at the foot of Mad ud af huset - design 1ai.
 *
 * This is the page's one lower section. It used to be three: two hairline-topped text
 * columns ("Til selskaber og sammenkomster", "Ring og hør mere") and then this band
 * with a third heading and both numbers again. All three said the same thing, so the
 * tracked document's section(s) now sit on the band itself, beside the one action.
 *
 * The action carries no number. There is no form and no booking flow, so calling is
 * still the whole point, but the hero directly above already prints both numbers as
 * large `tel:` controls; printing them a second time on the same screen is what made
 * the page feel repetitive. The button is a `tel:` link to the primary number.
 */
export function TakeawayCallToAction({
  sections,
  primaryPhone,
  ctaLabel,
}: {
  sections: TakeawaySection[]
  primaryPhone: string | null
  ctaLabel: string
}) {
  const [first] = sections
  if (first === undefined && primaryPhone === null) return null

  return (
    <Section
      tone="brand"
      ariaLabelledBy={first === undefined ? undefined : `mad-ud-af-huset-${first.id}`}
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:gap-9">
        <div className="flex flex-1 flex-col gap-5">
          {sections.map((section) => (
            <div key={section.id}>
              {section.heading ? (
                <h2
                  id={`mad-ud-af-huset-${section.id}`}
                  className="font-display text-statement text-balance text-white"
                >
                  {section.heading}
                </h2>
              ) : null}
              {section.body ? (
                <p className="text-support mt-2.5 max-w-[56ch] text-white/85">{section.body}</p>
              ) : null}
            </div>
          ))}
        </div>

        {primaryPhone ? (
          <div className="shrink-0">
            <PhoneAction
              phone={primaryPhone}
              label={ctaLabel}
              variant="inverse"
              size="large"
              block
              className="md:w-auto"
            />
          </div>
        ) : null}
      </div>
    </Section>
  )
}
