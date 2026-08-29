import type { OpenStatusSnapshot } from '@/lib/hours/status'

/**
 * The "Åbent nu · til kl. 20:00" badge — design 1g, 1k, 1l, 1n, 1o.
 *
 * Presentation only: it is handed an already-decided answer and renders it. Nothing
 * here reads a clock, so the server-rendered badge and the browser's minute-by-minute
 * correction cannot word the same state differently.
 *
 * Status is never colour alone (1aa). The state is written out in words, and the dot
 * changes **shape** as well as colour — filled when open, a ring when closed — so the
 * difference survives a monochrome screen or a colour-vision difference.
 */

export type OpenStatusVariant =
  /** Bare line of text, as the Forside hero and the fullscreen menu draw it (1g, 1n). */
  | 'inline'
  /** Bordered pill on a light surface (1g, 1k, 1l, 1o). */
  | 'pill'
  /** Translucent pill on the burgundy fullscreen menu (1n). */
  | 'on-brand'

const CONTAINER_CLASSES: Record<OpenStatusVariant, string> = {
  inline: 'text-meta font-medium md:text-[0.90625rem]',
  pill: 'rounded-badge border px-3.5 py-2 text-meta font-semibold md:text-nav',
  'on-brand': 'rounded-badge bg-white/15 px-3.5 py-2 text-meta font-semibold text-white',
}

const OPEN_TONE: Record<OpenStatusVariant, string> = {
  inline: 'text-success',
  pill: 'bg-success-surface border-success-border text-success-ink',
  'on-brand': '',
}

const CLOSED_TONE: Record<OpenStatusVariant, string> = {
  inline: 'text-ink-2',
  pill: 'bg-neutral-surface border-border text-neutral-ink',
  'on-brand': '',
}

function StatusDot({ isOpen, variant }: { isOpen: boolean; variant: OpenStatusVariant }) {
  const colour =
    variant === 'on-brand'
      ? isOpen
        ? 'bg-success-on-brand'
        : 'border-2 border-white/70'
      : isOpen
        ? 'bg-success'
        : 'border-2 border-ink-3'

  return (
    <span
      aria-hidden="true"
      className={`size-2.5 shrink-0 rounded-full ${isOpen ? '' : 'bg-transparent'} ${colour}`}
    />
  )
}

export function OpenStatusBadge({
  status,
  variant = 'pill',
  showWeekday = false,
  className = '',
}: {
  status: OpenStatusSnapshot
  variant?: OpenStatusVariant
  /** The Forside hero prints the weekday after the badge (1g). */
  showWeekday?: boolean
  className?: string
}) {
  const tone = variant === 'on-brand' ? '' : status.isOpen ? OPEN_TONE[variant] : CLOSED_TONE[variant]

  return (
    <p className={`inline-flex items-center gap-2.5 ${CONTAINER_CLASSES[variant]} ${tone} ${className}`}>
      <StatusDot isOpen={status.isOpen} variant={variant} />
      <span>
        {status.label}
        {status.detail === null ? null : ` · ${status.detail}`}
      </span>
      {showWeekday ? <span className="text-ink-3 font-normal">· {status.todayLabel}</span> : null}
    </p>
  )
}
