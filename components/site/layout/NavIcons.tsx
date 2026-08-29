/**
 * The four icons of the persistent mobile bar — design 1aa ("Kun stregikoner, 2 px,
 * 24 px ramme. Ingen emoji. Ingen fyldte ikoner.") and 1l.
 *
 * Every icon is decorative: each one sits directly above its own word, so announcing it
 * as well would be a duplicate. They are marked `aria-hidden` and the label carries the
 * meaning — which is also why the bar still makes sense in monochrome.
 */

type IconProps = { className?: string }

function Frame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-6 ${className}`}
    >
      {children}
    </svg>
  )
}

/** Menu — the list of dishes. */
export function MenuIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Frame>
  )
}

/** Bestil — the telephone. */
export function PhoneIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M6 3h3l2 5-2.5 1.5a12 12 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.2 2 2 0 0 1 6 3Z" />
    </Frame>
  )
}

/** Vis vej — the direction marker. */
export function DirectionsIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z" />
      <path d="M9.5 14v-2.5A2 2 0 0 1 11.5 9.5H15" />
      <path d="M13 7.5 15 9.5 13 11.5" />
    </Frame>
  )
}

/** Tider — the clock. */
export function ClockIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Frame>
  )
}

/** The header's mobile disclosure, in both of its states. */
export function HamburgerIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Frame>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Frame>
  )
}
