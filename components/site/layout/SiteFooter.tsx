import Link from 'next/link'

import type { SiteContact } from '@/lib/content/types'
import { formatWeeklyHoursLines } from '@/lib/hours/format'
import type { WeeklySchedule } from '@/lib/hours/types'
import { mailtoHref, telHref } from '@/lib/site/links'
import type { NavItem } from '@/lib/site/navigation'

import { Eyebrow } from '../Eyebrow'
import { PageContainer } from '../PageContainer'
import { SiteLogo } from './SiteLogo'

/**
 * The footer — design 1g and 1l.
 *
 * The opening hours here are the *same* hours as the badge at the top of the page: both
 * come from `opening_hours` through `lib/hours`, grouped into "Ons–fre 15:00–20:00" by
 * the formatter phase 2 tested. There is no second copy to fall out of step.
 *
 * "Følg os" disappears entirely when the Facebook link is not filled in — "Er linket
 * ikke udfyldt …, forsvinder hele kolonnen … Gæsten ser aldrig et tomt Følg os" (1g).
 * The same rule applies to each phone number and to the address: a `null` in
 * `content/site/contact.json` removes the block rather than emptying it.
 *
 * On a phone the four groups stack, and the gap between them is one step tighter than
 * the desktop column gap: at 375 px a 32 px gap between short single-column groups
 * read as four separate blocks rather than one footer. From `md` the gaps are as
 * drawn. The second number is `white/88` where the footer's body text is `white/78`:
 * a number a guest may need to ring has to read at a glance, and it stays secondary
 * to the primary one through weight alone.
 *
 * **Every value appears once.** The venue name is the logo lockup's second line
 * everywhere else on the site, so in the footer the lockup gives it up
 * (`showVenue={false}`) and the `address` prints it, which is the element that should
 * carry it: the column used to say "Carl Nielsen Hallen" twice, three lines apart.
 *
 * **One heading, one block.** The two numbers and the e-mail address are three ways to
 * reach the same restaurant, so they sit under a single "Kontakt" eyebrow — the same
 * label the three other columns get — rather than under a "Telefon:" and an "Email:"
 * that cut a five-line column into two mini-sections. The heading is skipped entirely
 * when all three values are missing, the same rule as every other block here. Order
 * inside the block is by speed of answer: the number to ring, then the second number,
 * then the address to write to. `break-all` keeps a long e-mail inside the narrow
 * column at 375 px instead of widening the footer.
 *
 * **The columns are aligned on their first line of text, not on their first box.**
 * Every link here is a full `min-h-tap` target — the site's 44 px floor, which
 * `tests/a11y` checks on every page and at every width — so a link row carries ~11 px
 * of centring above its text that a plain line of text (the hours) does not. Each
 * list's top margin therefore compensates for its own leading: `mt-0.5` under an
 * eyebrow whose first row is a 44 px link, `mt-3` under one whose first row is text.
 * Read as numbers the margins look inconsistent; on screen the four columns start on
 * the same baseline, which is the thing being kept.
 *
 * That 44 px floor also sets the footer's height: three contact rows and five page
 * links cannot be shorter than 132 px and 220 px, whatever the spacing around them
 * does. The tightening here is therefore all in the gaps — and in not printing the
 * same value twice.
 *
 * The columns are `items-start` rather than the grid's stretched default, and the last
 * one is narrower than the three before it (`0.9fr`): Følg os is one link, and giving
 * it an equal share only widens the empty space beside it. The first column takes
 * 1.35fr, which is what keeps "Lumbyvej 62, 5792 Nørre Lyndelse" on one line at 1440.
 */
export function SiteFooter({
  items,
  contact,
  schedule,
}: {
  items: readonly NavItem[]
  contact: SiteContact
  schedule: WeeklySchedule
}) {
  const hours = formatWeeklyHoursLines(schedule)
  const hasContact = Boolean(contact.primaryPhone || contact.secondaryPhone || contact.email)

  /** One line of the Kontakt block, and one 44 px tap target (1g, `tests/a11y`). */
  const contactRow = 'flex min-h-tap w-fit items-center no-underline hover:underline'

  return (
    <footer className="bg-brand-900 text-white/78">
      <PageContainer className="py-7 md:py-8">
        <div className="grid items-start gap-6 md:grid-cols-2 md:gap-8 lg:grid-cols-[1.35fr_1fr_1fr_0.9fr] lg:gap-10">
          <div>
            <SiteLogo size="compact" tone="inverse" showVenue={false} />
            <address className="text-detail mt-3 not-italic">
              {contact.venueName ? (
                <>
                  {contact.venueName}
                  <br />
                </>
              ) : null}
              {contact.addressLine1 && contact.postalCode && contact.city
                ? `${contact.addressLine1}, ${contact.postalCode} ${contact.city}`
                : null}
              {hasContact ? (
                <>
                  <Eyebrow tone="inverse" className="mt-3.5">
                    Kontakt
                  </Eyebrow>
                  <span className="mt-0.5 flex flex-col">
                    {contact.primaryPhone ? (
                      <a
                        href={telHref(contact.primaryPhone)}
                        className={`${contactRow} font-semibold text-white tabular-nums`}
                      >
                        {contact.primaryPhone}
                      </a>
                    ) : null}
                    {contact.secondaryPhone ? (
                      <a
                        href={telHref(contact.secondaryPhone)}
                        className={`${contactRow} text-detail text-white/88 tabular-nums`}
                      >
                        {`eller ${contact.secondaryPhone}`}
                      </a>
                    ) : null}
                    {contact.email ? (
                      <a
                        href={mailtoHref(contact.email)}
                        className={`${contactRow} text-detail break-all text-white/78`}
                      >
                        {contact.email}
                      </a>
                    ) : null}
                  </span>
                </>
              ) : null}
            </address>
          </div>

          <nav aria-label="Sider i bunden">
            <Eyebrow tone="inverse">Sider</Eyebrow>
            <ul className="mt-0.5 flex flex-col">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-flex min-h-tap items-center text-nav text-white no-underline hover:underline"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <Eyebrow tone="inverse">Åbningstider</Eyebrow>
            <ul className="mt-3 flex flex-col gap-1.5 text-nav text-white tabular-nums">
              {hours.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          {contact.facebookUrl ? (
            <div>
              <Eyebrow tone="inverse">Følg os</Eyebrow>
              <a
                href={contact.facebookUrl}
                rel="noopener noreferrer"
                target="_blank"
                className="rounded-badge mt-2.5 inline-flex min-h-tap items-center border border-white/45 px-4 font-medium text-white no-underline hover:border-white"
              >
                Facebook
              </a>
            </div>
          ) : null}
        </div>
      </PageContainer>
    </footer>
  )
}
