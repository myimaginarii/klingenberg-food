import { telHref } from '@/lib/site/links'

import { ActionLink, type ActionSize, type ActionVariant } from './ActionLink'

/**
 * The phone call to action — design 1g, 1h, 1k, 1ai, 1o.
 *
 * Ordering is by telephone and nothing else: there is no reservation system, no online
 * ordering and no form anywhere on this site. That makes this the most important
 * control the public half has, which is why it exists once, here, rather than as an
 * `<a href="tel:…">` written out on six pages.
 *
 * The number is always rendered as visible text as well as being the link target, so it
 * can be read, dictated and copied on a device that cannot dial.
 */

type PhoneActionProps = {
  /** The number as the administration stores it: "+45 63 90 83 00". */
  phone: string
  /**
   * "Ring", "Bestil på telefon", "Ring og hør mere" — the approved wording per screen.
   * A node rather than a string, because the Forside hero is the one place the design
   * gives the same action two different labels at two different widths (1g and 1l).
   */
  label: React.ReactNode
  /** Show the number beside the label, as the header and the menu bar do (1g, 1h). */
  showNumber?: boolean
  /**
   * Put the number on its own line beneath the label, as the mobile takeaway CTA does
   * (1ai). Implies `showNumber`.
   */
  stacked?: boolean
  variant?: ActionVariant
  size?: ActionSize
  block?: boolean
  className?: string
}

export function PhoneAction({
  phone,
  label,
  showNumber = false,
  stacked = false,
  variant = 'primary',
  size = 'default',
  block = false,
  className,
}: PhoneActionProps) {
  const href = telHref(phone)

  if (stacked) {
    return (
      <ActionLink
        href={href}
        variant={variant}
        size={size}
        block={block}
        className={`flex-col gap-0.5 py-2 ${className ?? ''}`}
      >
        <span>{label}</span>
        <span className="text-meta font-medium tabular-nums opacity-85">{phone}</span>
      </ActionLink>
    )
  }

  return (
    <ActionLink
      href={href}
      variant={variant}
      size={size}
      block={block}
      className={`tabular-nums ${className ?? ''}`}
    >
      {label}
      {showNumber ? <span>{phone}</span> : null}
    </ActionLink>
  )
}
