import { Eyebrow } from '@/components/site/Eyebrow'
import { InlineLink } from '@/components/site/InlineLink'
import { MediaPlaceholder } from '@/components/site/MediaPlaceholder'
import { PhoneAction } from '@/components/site/PhoneAction'
import { Section } from '@/components/site/Section'
import { SoldOutBadge } from '@/components/site/menu/DishBadge'
import { DishPrice } from '@/components/site/menu/DishPrice'
import { formatDatePeriod } from '@/lib/format/danish'
import type { MonthlyBurgerView } from '@/lib/menu/view'

/**
 * "Månedens burger" on the Forside — its own section, beside the three featured dishes
 * rather than instead of one of them.
 *
 * The design language is the approved one throughout (1a, 1aa, 1g, 1l): the beige band
 * that already separates a group of sections, one `surface` card on it, Bricolage for
 * the name, Work Sans for the rest, the existing radius and spacing tokens. No new
 * colour, no gradient, no animation.
 *
 * **Prominence comes from scale and from the heading, not from a new surface.** The
 * card is the full width of the container with the photograph running down its side,
 * and — the one deliberate move here — the *burger's own name* is the section heading
 * at section scale, with "Månedens burger" demoted to the eyebrow above it. This is the
 * only part of the site whose subject changes every month, and giving the changing
 * thing the heading is what makes the change legible. A generic "Månedens burger"
 * headline with the real name buried in a card would read as a fixture instead.
 *
 * The eyebrow carries the window beside the label — "MÅNEDENS BURGER · 01.09.2026–
 * 30.09.2026" — in the same mono label the rest of the site uses. It is structure that
 * encodes something true (this is temporary, and here is until when) rather than
 * ornament, and it is the whole of the section's decoration.
 *
 * **This component decides nothing.** Whether there is a burger to show at all —
 * content, date window, `show_on_homepage` — is answered by `buildMenuView` and
 * `selectHomepageMonthlyBurger` (§7d); whether it is sold out is answered by the phase 2
 * rule in `lib/menu/availability.ts` (§7b). A `null` burger renders nothing, which is
 * what hides the section: a guest is never shown a placeholder for a burger that does
 * not exist. That sentence belongs in the administration.
 */
const HEADING_ID = 'maanedens-burger-titel'

export function MonthlyBurgerFeature({
  burger,
  primaryPhone,
}: {
  burger: MonthlyBurgerView | null
  primaryPhone: string | null
}) {
  if (burger === null) return null

  const period = formatDatePeriod(burger.startsOn, burger.endsOn)
  const soldOut = burger.soldOut

  return (
    <Section tone="beige" ariaLabelledBy={HEADING_ID}>
      <article
        className={`rounded-card-lg border-border flex flex-col overflow-hidden border md:flex-row ${
          soldOut ? 'bg-surface-muted' : 'bg-surface'
        }`}
      >
        <MediaPlaceholder
          ratio="card"
          label="Månedens burger"
          detail="4:3 · afventer"
          className={`border-border w-full shrink-0 border-0 border-b md:w-[17.5rem] md:border-r md:border-b-0 lg:w-[21.25rem] ${
            soldOut ? 'opacity-70 grayscale' : ''
          }`}
        />

        <div className="min-w-0 flex-1 p-4 md:p-7">
          {/* The dot only separates two things that are on the same line. On a phone the
              dateline drops beneath the label, and a trailing dot at the end of the
              first line would be a mark with nothing left to separate. */}
          <div className="flex flex-col items-start gap-1.5 md:flex-row md:items-center md:gap-3">
            <Eyebrow>Månedens burger</Eyebrow>
            {period ? (
              <>
                <span
                  aria-hidden="true"
                  className="bg-rule hidden size-1 shrink-0 rounded-full md:block"
                />
                <span className="text-ink-3 font-mono text-label tabular-nums uppercase">
                  {period}
                </span>
              </>
            ) : null}
          </div>

          <h2
            id={HEADING_ID}
            className={`font-display mt-3 text-[1.75rem] md:text-title-sm ${
              soldOut ? 'text-ink-2' : ''
            }`}
          >
            {burger.name}
          </h2>

          {burger.description ? (
            <p className={`mt-2.5 max-w-[60ch] ${soldOut ? 'text-ink-3' : 'text-ink-2'}`}>
              {burger.description}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <DishPrice priceOre={burger.priceOre} soldOut={soldOut} size="portion" />
            {soldOut ? <SoldOutBadge /> : null}
          </div>

          {/* Sold out removes the ordering action rather than dimming it: a burgundy
              "Bestil på telefon" beside "Udsolgt i dag" would invite a call that ends
              in a no. The number is still one tap away in the header, the bottom bar
              and the footer, and the price stays visible so the guest can see what it
              costs when it is back (1af).

              The number sits on its own line beneath the label (`stacked`, the approved
              treatment from 1ai) rather than after it. At 375 px a single line would
              break the number itself across two lines — "+45 63 90 83" over "00" — which
              is worse than not printing it. */}
          <div className="mt-5 flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-5">
            {soldOut || primaryPhone === null ? null : (
              <PhoneAction
                phone={primaryPhone}
                label="Bestil på telefon"
                stacked
                size="large"
                block
                className="md:w-auto"
              />
            )}
            <InlineLink href="/menu">Se menuen</InlineLink>
          </div>
        </div>
      </article>
    </Section>
  )
}
