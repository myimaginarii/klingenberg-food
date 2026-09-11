import type { SiteContact } from '@/lib/content/types'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { directionsUrl } from '@/lib/site/links'
import type { NavItem } from '@/lib/site/navigation'

import { ActionLink } from '../ActionLink'
import { OpenStatus } from '../OpenStatus'
import { PhoneAction } from '../PhoneAction'
import { MobileMenuDisclosure } from './MobileMenuDisclosure'
import { CloseIcon, HamburgerIcon } from './NavIcons'
import { NavLink } from './NavLink'
import { SiteLogo } from './SiteLogo'

/**
 * The fullscreen menu on mobile — design 1n.
 *
 * A `<details>` element. The browser gives us the open state, the `aria-expanded`
 * announcement and keyboard operation for free, and the whole thing keeps working with
 * JavaScript disabled — which matters because this is the only way to reach four of the
 * six pages from a phone (§7e, item 11). This component itself stays on the server; the
 * element is rendered by `MobileMenuDisclosure`, a wrapper of a few lines whose only job
 * is to close the panel once it has taken you somewhere, since a client-side route
 * change leaves the layout — and so the open panel — mounted.
 *
 * The single control is the `<summary>`: the hamburger in the header while closed, and
 * the × in the panel's corner while open. The CSS that moves it lives beside the rest
 * of the site's component styles in `app/globals.css`.
 */
export function MobileMenu({
  items,
  contact,
  schedule,
  overrides,
}: {
  items: readonly NavItem[]
  contact: SiteContact
  schedule: WeeklySchedule
  overrides: OpeningHoursOverride[]
}) {
  const address =
    contact.addressLine1 && contact.postalCode && contact.city
      ? {
          addressLine1: contact.addressLine1,
          postalCode: contact.postalCode,
          city: contact.city,
        }
      : null

  return (
    <MobileMenuDisclosure className="site-menu lg:hidden">
      <summary className="border-ink rounded-button flex cursor-pointer items-center justify-center border-[1.5px]">
        <span className="sr-only">Menu</span>
        <HamburgerIcon className="site-menu-open-icon" />
        <CloseIcon className="site-menu-close-icon" />
      </summary>

      <div className="site-menu-panel bg-brand-700 fixed inset-0 z-50 flex flex-col overflow-y-auto">
        <div className="flex items-center px-gutter py-2.5">
          <SiteLogo size="compact" tone="inverse" showVenue={false} />
        </div>

        <nav aria-label="Alle sider" className="px-5 pt-4 pb-8">
          <ul>
            {items.map((item, index) => (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  className={`font-display block py-3 text-[2.125rem] leading-tight font-bold no-underline ${
                    index < items.length - 1 ? 'border-b border-white/20' : ''
                  }`}
                  activeClassName="text-white underline decoration-2 underline-offset-8"
                  inactiveClassName="text-white"
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>

          <OpenStatus
            schedule={schedule}
            overrides={overrides}
            variant="on-brand"
            className="mt-6"
          />

          <div className="mt-6 flex flex-col gap-2.5">
            {contact.primaryPhone ? (
              <PhoneAction
                phone={contact.primaryPhone}
                label="Ring"
                showNumber
                variant="inverse"
                size="large"
                block
              />
            ) : null}
            {address ? (
              <ActionLink href={directionsUrl(address)} variant="inverse-outline" size="large" block>
                Vis vej
              </ActionLink>
            ) : null}
          </div>

          {address ? (
            <p className="text-detail mt-6 leading-relaxed text-white/70">
              {address.addressLine1}
              <br />
              {`${address.postalCode} ${address.city}`}
            </p>
          ) : null}
        </nav>
      </div>
    </MobileMenuDisclosure>
  )
}
