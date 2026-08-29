import Link from 'next/link'

/**
 * The underlined text link the design uses to move between pages — "Se hele menuen →",
 * "Alle nyheder →", "Læs vores historie →" (1g, 1l).
 *
 * The arrow is decoration: the words already say where the link goes, so it is hidden
 * from assistive technology rather than read out as "right arrow". The target is at
 * least 44 px tall (1aa).
 */
export function InlineLink({
  href,
  children,
  className = '',
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={`text-brand-700 border-brand-700 hover:text-brand-500 hover:border-brand-500 inline-flex min-h-tap items-center gap-1.5 border-b-[1.5px] text-nav font-medium no-underline ${className}`}
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  )
}
