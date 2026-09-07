import Link from 'next/link'

import type { SiteContact } from '@/lib/content/types'
import { formatWeeklyHoursLines } from '@/lib/hours/format'
import type { WeeklySchedule } from '@/lib/hours/types'
import { telHref } from '@/lib/site/links'
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

  return (
    <footer className="bg-brand-900 text-white/78">
      <PageContainer className="py-8 md:py-9">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr] lg:gap-10">
          <div>
            <SiteLogo size="compact" tone="inverse" />
            <address className="text-detail mt-3 leading-relaxed not-italic">
              {contact.venueName ? (
                <>
                  {contact.venueName}
                  <br />
                </>
              ) : null}
              {contact.addressLine1 && contact.postalCode && contact.city
                ? `${contact.addressLine1}, ${contact.postalCode} ${contact.city}`
                : null}
              {contact.primaryPhone ? (
                <a
                  href={telHref(contact.primaryPhone)}
                  className="mt-1 flex min-h-tap w-fit items-center font-semibold text-white tabular-nums no-underline hover:underline"
                >
                  {contact.primaryPhone}
                </a>
              ) : null}
              {contact.secondaryPhone ? (
                <a
                  href={telHref(contact.secondaryPhone)}
                  className="text-detail flex min-h-tap w-fit items-center text-white/78 tabular-nums no-underline hover:underline"
                >
                  {`Ekstra nummer ${contact.secondaryPhone}`}
                </a>
              ) : null}
            </address>
          </div>

          <nav aria-label="Sider i bunden">
            <Eyebrow tone="inverse">Sider</Eyebrow>
            <ul className="mt-3 flex flex-col">
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
            <ul className="mt-3 flex flex-col gap-1 text-nav text-white tabular-nums">
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
                className="rounded-badge mt-3 inline-flex min-h-tap items-center border border-white/45 px-4 font-medium text-white no-underline hover:border-white"
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
