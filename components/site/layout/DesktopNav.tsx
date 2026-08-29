import type { NavItem } from '@/lib/site/navigation'

import { NavLink } from './NavLink'

/**
 * The desktop navigation — design 1g, 1ai.
 *
 * Hidden below 1024 px, where the fullscreen disclosure takes over. The approved
 * frames draw this bar at 1200 px and above; six Danish labels plus the logo and the
 * "Ring" button do not fit a tablet without shrinking the type below the design's
 * 15 px navigation size, so the disclosure — which is a complete navigation in its own
 * right — covers that range instead. Each target is at least 44 px tall (1aa).
 */
export function DesktopNav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav aria-label="Hovedmenu" className="hidden lg:block">
      <ul className="flex items-center gap-6 lg:gap-7">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink
              href={item.href}
              className="inline-flex min-h-tap items-center border-b-2 pt-0.5 text-nav no-underline"
              activeClassName="border-brand-700 text-ink font-medium"
              inactiveClassName="text-neutral-ink hover:text-brand-700 border-transparent"
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
