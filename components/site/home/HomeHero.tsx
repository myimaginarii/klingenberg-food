import { ActionLink } from '@/components/site/ActionLink'
import { AwardRibbon } from '@/components/site/AwardRibbon'
import { OpenStatus } from '@/components/site/OpenStatus'
import { PhoneAction } from '@/components/site/PhoneAction'
import { SiteImage } from '@/components/site/SiteImage'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import type { PublicImage } from '@/lib/images/public'

/**
 * The Forside hero — design 1g (text beside the photograph) and 1l (photograph first).
 *
 * One primary action. "Én primær handling (Se menuen). Vis vej og Ring er sekundære,
 * men lige så store i højden — 52 px" (1g). The two secondary actions always share a
 * row of their own: on a phone that row sits under the full-width primary, and from
 * `md` the three are one wrapping line, where the pair wraps *together*. The row used
 * to be dissolved from `md` (`md:contents`) so each button wrapped on its own, which at
 * 768 and again at 1024 — the text column is 313 and 375 px wide there — left the third
 * button orphaned on a line of its own under the other two. Keeping the pair as one
 * flex item means the line breaks between the primary and the pair, never inside the
 * pair; at 1200 px and above all three still fit on one line, as 1g draws them.
 *
 * The heading and the introduction come from `pages.home`, which the owner edits
 * (§5). Both are placeholder text today — 1ab lists "Forsidens overskrift og intro"
 * among the things the restaurant still owes us.
 *
 * The photograph (phase 11A) is the Forside document's own hero image — 1u's
 * "Hovedbillede" — rendered by the one public renderer in exactly the box the
 * placeholder reserved: 4:3 above the text on a phone, the full-height column beside
 * it from `md`. It is the page's primary image, so it loads eagerly. No image, or an
 * image is the reserved frame, exactly as the design draws it.
 *
 * THE FRAME IS SQUARE ON A PHONE AND 9:8 FROM `md`, a little wider than the text from
 * `lg`. The supplied photograph is a 2:3 portrait with the burger filling its middle
 * three fifths, so a 4:3 frame cropped the bun off on a phone, and `aspect-auto` from
 * `md` let the flex row grow to the portrait's own height, which stranded the text in
 * the middle of a column far taller than it needed. A square frame shows two thirds of
 * the portrait — the whole burger, centred — and 9:8 shows three fifths, which is the
 * burger from bun to lettuce with the plate's edge on either side, in a row the text
 * nearly fills.
 */
export function HomeHero({
  heading,
  intro,
  schedule,
  overrides,
  primaryPhone,
  directionsHref,
  image,
}: {
  heading: string
  intro: string | null
  image: PublicImage | null
  schedule: WeeklySchedule
  overrides: OpeningHoursOverride[]
  primaryPhone: string | null
  directionsHref: string | null
}) {
  return (
    <section aria-labelledby="forside-titel" className="bg-bg">
      <div className="mx-auto flex w-full max-w-content flex-col-reverse md:flex-row md:items-stretch">
        <div className="flex flex-1 flex-col justify-center gap-5 px-gutter py-7 md:gap-6 md:px-10 md:py-13">
          <AwardRibbon />

          <h1
            id="forside-titel"
            className="font-display text-hero text-balance"
          >
            {heading}
          </h1>

          {intro ? (
            <p className="text-neutral-ink text-lead max-w-[44ch]">{intro}</p>
          ) : null}

          <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
            <ActionLink href="/menu" size="large" block className="md:w-auto">
              Se menuen
            </ActionLink>

            <div className="flex gap-2.5">
              {directionsHref ? (
                <ActionLink href={directionsHref} variant="secondary" size="large" block className="md:w-auto">
                  Vis vej
                </ActionLink>
              ) : null}
              {primaryPhone ? (
                <PhoneAction
                  phone={primaryPhone}
                  /* The design labels this action "Ring" on a phone and "Bestil på
                     telefon" on a wide screen (1l and 1g). Two short spans rather than
                     two button trees: only one of them is in the accessibility tree at
                     any width, because the other is display:none. */
                  label={
                    <>
                      <span className="lg:hidden">Ring</span>
                      <span className="hidden lg:inline">Bestil på telefon</span>
                    </>
                  }
                  variant="quiet"
                  size="large"
                  block
                  className="md:w-auto"
                />
              ) : null}
            </div>
          </div>

          <OpenStatus
            schedule={schedule}
            overrides={overrides}
            variant="inline"
            showWeekday
          />
        </div>

        <SiteImage
          image={image}
          ratio="square"
          sizes="homeHero"
          loading="eager"
          placeholder={{
            label: 'Hero-foto',
            detail: 'signaturburger, tæt beskåret · min. 2400 × 1600 px',
          }}
          className="border-border w-full flex-1 border-0 border-b md:aspect-[9/8] md:min-h-[32.5rem] md:border-b-0 md:border-l lg:flex-[1.25]"
        />
      </div>
    </section>
  )
}
