import { ActionLink } from '@/components/site/ActionLink'
import { AwardRibbon } from '@/components/site/AwardRibbon'
import { OpenStatus } from '@/components/site/OpenStatus'
import { PhoneAction } from '@/components/site/PhoneAction'
import { SiteImage } from '@/components/site/SiteImage'
import type { OpenStatusSnapshot } from '@/lib/hours/status'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import type { PublicImage } from '@/lib/images/public'

/**
 * The Forside hero — design 1g (text beside the photograph) and 1l (photograph first).
 *
 * One primary action. "Én primær handling (Se menuen). Vis vej og Ring er sekundære,
 * men lige så store i højden — 52 px" (1g). On a phone the two secondary actions share a
 * row; `md:contents` dissolves that row on a wider screen so all three sit on one line
 * without a second copy of the markup.
 *
 * The heading and the introduction come from `pages.home`, which the owner edits
 * (§5). Both are placeholder text today — 1ab lists "Forsidens overskrift og intro"
 * among the things the restaurant still owes us.
 *
 * The photograph (phase 11A) is the Forside document's own hero image — 1u's
 * "Hovedbillede" — rendered by the one public renderer in exactly the box the
 * placeholder reserved: 4:3 above the text on a phone, the full-height column beside
 * it from `md`. It is the page's primary image, so it loads eagerly. No image, or an
 * image the read layer could not render safely, is the reserved frame as before.
 */
export function HomeHero({
  heading,
  intro,
  openStatus,
  schedule,
  overrides,
  primaryPhone,
  directionsHref,
  image,
}: {
  heading: string
  intro: string | null
  image: PublicImage | null
  openStatus: OpenStatusSnapshot
  schedule: WeeklySchedule
  overrides: OpeningHoursOverride[]
  primaryPhone: string | null
  directionsHref: string | null
}) {
  return (
    <section aria-labelledby="forside-titel" className="bg-bg">
      <div className="mx-auto flex w-full max-w-content flex-col-reverse md:flex-row md:items-stretch">
        <div className="flex flex-1 flex-col justify-center gap-5 px-gutter py-7 md:px-10 md:py-13">
          <AwardRibbon />

          <h1
            id="forside-titel"
            className="font-display text-[2.5rem] leading-none tracking-[-0.03em] text-balance md:text-[4.125rem]"
          >
            {heading}
          </h1>

          {intro ? (
            <p className="text-neutral-ink max-w-[44ch] md:text-[1.125rem]">{intro}</p>
          ) : null}

          <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
            <ActionLink href="/menu" size="large" block className="md:w-auto">
              Se menuen
            </ActionLink>

            <div className="flex gap-2.5 md:contents">
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
            initialStatus={openStatus}
            schedule={schedule}
            overrides={overrides}
            variant="inline"
            showWeekday
          />
        </div>

        <SiteImage
          image={image}
          ratio="card"
          sizes="homeHero"
          loading="eager"
          placeholder={{
            label: 'Hero-foto',
            detail: 'signaturburger, tæt beskåret · min. 2400 × 1600 px',
          }}
          className="border-border w-full flex-1 border-0 border-b md:aspect-auto md:min-h-[32.5rem] md:border-b-0 md:border-l lg:flex-[1.05]"
        />
      </div>
    </section>
  )
}
