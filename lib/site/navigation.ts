/**
 * The public site's navigation — design 1g, 1ai, 1n, 1aa.
 *
 * One list, three presentations: the desktop header, the mobile fullscreen panel and
 * the footer's "Sider" column all read from here, so a route cannot appear in one and
 * be forgotten in another. The persistent mobile bottom bar is a different set of four
 * actions and is defined separately, because it is not a list of pages.
 */

export type SiteRoute =
  | '/'
  | '/menu'
  | '/mad-ud-af-huset'
  | '/om-os'
  | '/nyheder'
  | '/find-os'

export type NavItem = {
  href: SiteRoute
  label: string
}

/**
 * The approved main navigation, in the approved order (1ai — the frame that draws all
 * six items in their final order; the earlier frames 1g–1k place "Mad ud af huset"
 * after "Nyheder", which the footer's own column already contradicts).
 */
export const MAIN_NAV: readonly NavItem[] = [
  { href: '/', label: 'Forside' },
  { href: '/menu', label: 'Menu' },
  { href: '/mad-ud-af-huset', label: 'Mad ud af huset' },
  { href: '/om-os', label: 'Om os' },
  { href: '/nyheder', label: 'Nyheder' },
  { href: '/find-os', label: 'Find os' },
] as const

/** The footer's "Sider" column: the same list without the page you are already on top of. */
export const FOOTER_NAV: readonly NavItem[] = MAIN_NAV.filter((item) => item.href !== '/')

/** Is `pathname` this navigation item, for `aria-current="page"`? */
export function isCurrentRoute(pathname: string, href: SiteRoute): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
