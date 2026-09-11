'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { type SiteRoute, isCurrentRoute } from '@/lib/site/navigation'

import { useCloseMobileMenu } from './MobileMenuDisclosure'

/**
 * A navigation link that knows whether it is the page you are on.
 *
 * The active state is the one thing on the public site that a server-rendered layout
 * genuinely cannot work out for itself: a layout is given `params`, never the pathname.
 * Rather than thread the route through every page, or run the proxy over public
 * requests to stamp a header on them — which would put the site's zero-cookie property
 * (§12) at risk for a styling detail — this is a client component of eight lines.
 *
 * It is not a new entry in the JavaScript budget: the open/closed badge already
 * hydrates on every page, so this rides along in the same bundle and issues no request
 * of its own.
 *
 * `aria-current="page"` is the part that matters; the underline is its visible twin, so
 * the state is never carried by colour alone (1aa).
 *
 * One component is three navigations: the desktop bar, the footer column and the
 * fullscreen mobile panel. Inside the panel — and only there — a link also closes the
 * panel it was tapped in, which the disclosure hands it as `useCloseMobileMenu`;
 * outside one that is `null` and nothing changes. `onNavigate` rather than `onClick`, because the framework
 * calls it only when it is really taking you somewhere within the site: a
 * modifier-click that opens a new tab leaves the panel where it was.
 */
export function NavLink({
  href,
  className,
  activeClassName,
  inactiveClassName,
  children,
}: {
  href: SiteRoute
  className: string
  activeClassName: string
  inactiveClassName: string
  children: React.ReactNode
}) {
  const current = isCurrentRoute(usePathname(), href)
  const closeMenu = useCloseMobileMenu()

  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={`${className} ${current ? activeClassName : inactiveClassName}`}
      onNavigate={closeMenu ?? undefined}
    >
      {children}
    </Link>
  )
}
