import Link from 'next/link'

/**
 * The site's one button treatment — design 1aa ("Tilstande — knap") and 1g–1o.
 *
 * Every call to action on the public site is a link: there is no reservation system, no
 * online ordering and no form, so nothing here submits anything. Rendering them as
 * `<a>` rather than `<button>` is what keeps the whole site working with JavaScript
 * disabled (§7e, item 11).
 *
 * The variants are the ones the approved frames actually draw, and no others. Sizes
 * are the drawn heights, all comfortably past the 44 px minimum target (1aa).
 */

export type ActionVariant =
  /** Burgundy fill. One per screen — the primary action. */
  | 'primary'
  /** Ink outline on the page background. */
  | 'secondary'
  /** Hairline border, brand text. The Forside hero's third, quietest action (1g). */
  | 'quiet'
  /** White fill on a burgundy surface — the fullscreen mobile menu (1n). */
  | 'inverse'
  /** White outline on a burgundy surface (1n). */
  | 'inverse-outline'

export type ActionSize =
  /** 44 px — the header's "Ring" (1g). */
  | 'compact'
  /** 48 px — in-page actions (1g "Find os", 1h footer bar). */
  | 'default'
  /** 52–56 px — hero and full-width mobile actions (1g, 1l, 1ai). */
  | 'large'

type ActionLinkProps = {
  href: string
  variant?: ActionVariant
  size?: ActionSize
  /** Stretch to the container's width, as every mobile action does (1l, 1ai). */
  block?: boolean
  className?: string
  children: React.ReactNode
}

const VARIANT_CLASSES: Record<ActionVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-500 active:bg-brand-900',
  secondary: 'border-[1.5px] border-ink text-ink bg-transparent hover:bg-ink hover:text-white',
  quiet: 'border-[1.5px] border-border text-brand-700 hover:border-brand-500 hover:text-brand-500',
  inverse: 'bg-white text-brand-700 hover:bg-brand-50',
  'inverse-outline': 'border-[1.5px] border-white/70 text-white hover:border-white hover:bg-white/10',
}

const SIZE_CLASSES: Record<ActionSize, string> = {
  compact: 'min-h-tap px-[18px] text-nav',
  default: 'min-h-12 px-6 text-base',
  large: 'min-h-[3.375rem] px-7 text-body',
}

/**
 * `next/link` handles internal routes; anything else — a `tel:` dialler link or the
 * Facebook page — is a plain anchor, and an external one carries `rel` per §8.
 */
export function ActionLink({
  href,
  variant = 'primary',
  size = 'default',
  block = false,
  className = '',
  children,
}: ActionLinkProps) {
  const classes = [
    'rounded-button inline-flex items-center justify-center gap-2 text-center font-semibold no-underline transition-colors duration-fast ease-standard',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    block ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (href.startsWith('/')) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    )
  }

  const external = href.startsWith('http')

  return (
    <a
      href={href}
      className={classes}
      {...(external ? { rel: 'noopener noreferrer', target: '_blank' } : {})}
    >
      {children}
    </a>
  )
}
