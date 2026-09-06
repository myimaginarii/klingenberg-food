import Link from 'next/link'

import { telHref } from '@/lib/site/links'

import { ClockIcon, DirectionsIcon, MenuIcon, PhoneIcon } from './NavIcons'

/**
 * The persistent mobile bar — design 1l and 1aa ("Navigation").
 *
 * Four actions, not a copy of the main navigation: "Menu · Bestil · Vis vej · Tider —
 * ikon + tekst, 60 px + safe-area. Kun ét burgundy-felt: Bestil, som ringer direkte til
 * +45 63 90 83 00."
 *
 * Every item is a real link, so the bar works with JavaScript disabled and is in the
 * ordinary tab order. Each is a quarter of a 375 px screen and 60 px tall — well past
 * the 44 px minimum — and the label is always visible, so nothing depends on
 * recognising an icon.
 */
export function MobileBottomNav({
  primaryPhone,
  directionsHref,
}: {
  primaryPhone: string | null
  directionsHref: string | null
}) {
  return (
    <nav
      aria-label="Genveje"
      className="border-border bg-surface fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_14px_rgb(36_30_27/0.06)] md:hidden"
    >
      <ul className="flex">
        <BottomNavItem href="/menu" label="Menu" icon={<MenuIcon />} />
        <BottomNavItem
          href={primaryPhone ? telHref(primaryPhone) : null}
          label="Bestil"
          icon={<PhoneIcon />}
          highlighted
        />
        <BottomNavItem href={directionsHref} label="Vis vej" icon={<DirectionsIcon />} />
        <BottomNavItem href="/find-os#aabningstider" label="Tider" icon={<ClockIcon />} />
      </ul>
    </nav>
  )
}

function BottomNavItem({
  href,
  label,
  icon,
  highlighted = false,
}: {
  href: string | null
  label: string
  icon: React.ReactNode
  highlighted?: boolean
}) {
  if (href === null) return null

  const classes = `flex min-h-[3.75rem] flex-col items-center justify-center gap-1 pt-1 text-chip no-underline ${
    highlighted ? 'bg-brand-700 font-semibold text-white' : 'text-neutral-ink font-medium'
  }`

  return (
    <li className="flex-1">
      {href.startsWith('/') ? (
        <Link href={href} className={classes}>
          {icon}
          <span>{label}</span>
        </Link>
      ) : (
        <a href={href} className={classes}>
          {icon}
          <span>{label}</span>
        </a>
      )}
    </li>
  )
}
