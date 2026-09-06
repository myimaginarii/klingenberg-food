import { Eyebrow } from '../Eyebrow'
import { PhoneAction } from '../PhoneAction'
import { Section } from '../Section'

/**
 * The burgundy band at the foot of Mad ud af huset — design 1ai.
 *
 * The one thing this page is for. There is no form and no booking flow; the number is
 * the action, so it is rendered as the largest control on the band and is a `tel:` link
 * rather than text a guest has to copy.
 */
const HEADING = 'Skal vi lave maden til jeres fest?'
const TEXT = 'Ring og fortæl, hvad I har brug for.'

export function TakeawayCallToAction({
  primaryPhone,
  secondaryPhone,
}: {
  primaryPhone: string | null
  secondaryPhone: string | null
}) {
  return (
    <Section tone="brand" ariaLabelledBy="mad-ud-af-huset-cta">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:gap-7">
        <div className="flex-1">
          <h2
            id="mad-ud-af-huset-cta"
            className="font-display text-statement text-white"
          >
            {HEADING}
          </h2>
          <p className="mt-2 max-w-[56ch] text-white/85">{TEXT}</p>
        </div>

        {primaryPhone ? (
          <div className="shrink-0 md:text-right">
            <Eyebrow tone="inverse">Ring og hør mere</Eyebrow>
            <PhoneAction
              phone={primaryPhone}
              label={primaryPhone}
              variant="inverse"
              size="large"
              block
              className="mt-2.5 md:w-auto"
            />
            {secondaryPhone ? (
              <p className="mt-2 text-nav tabular-nums text-white/75">{`eller ${secondaryPhone}`}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  )
}
