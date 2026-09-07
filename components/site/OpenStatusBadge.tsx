import type { OpenStatusSnapshot } from '@/lib/hours/status'

/**
 * The "Åbent nu · til kl. 20:00" badge — design 1g, 1k, 1l, 1n, 1o.
 *
 * Presentation only: it is handed an already-decided answer and renders it. Nothing
 * here reads a clock, so every place the badge appears words the same state the same
 * way.
 *
 * `status` is `null` before the browser has decided — which, on a static site, is what
 * the prerendered HTML always carries, and what a visitor without JavaScript reads
 * (`./OpenStatus.tsx` explains why). The badge then names the subject instead of
 * claiming a state: the same shape and the same place, with the neutral ring dot and
 * the word "Åbningstider". It says nothing that could be false.
 *
 * Status is never colour alone (1aa). The state is written out in words, and the dot
 * changes **shape** as well as colour — filled when open, a ring when closed or
 * undecided — so the difference survives a monochrome screen or a colour-vision
 * difference.
 */

/** What the badge says before the browser has decided anything. */
const UNDECIDED_LABEL = 'Åbningstider'

export type OpenStatusVariant =
  /** Bare line of text, as the Forside hero and the fullscreen menu draw it (1g, 1n). */
  | 'inline'
  /** Bordered pill on a light surface (1g, 1k, 1l, 1o). */
  | 'pill'
  /** Translucent pill on the burgundy fullscreen menu (1n). */
  | 'on-brand'

const CONTAINER_CLASSES: Record<OpenStatusVariant, string> = {
  inline: 'text-detail font-medium',
  pill: 'rounded-badge border px-3.5 py-2 text-nav font-semibold',
  'on-brand': 'rounded-badge bg-white/15 px-3.5 py-2 text-nav font-semibold text-white',
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
  /** The decided state, or `null` before the browser has decided one. */
  status: OpenStatusSnapshot | null
  variant?: OpenStatusVariant
  /** The Forside hero prints the weekday after the badge (1g). */
  showWeekday?: boolean
  className?: string
}) {
  const isOpen = status?.isOpen ?? false
  const tone = variant === 'on-brand' ? '' : isOpen ? OPEN_TONE[variant] : CLOSED_TONE[variant]

  return (
    <p
      /*
        Which of the three states this badge is in, as an attribute.
        The words alone cannot say it: "Lukket" is also what the hours table prints
        beside a closed day, so a test that reads text cannot tell a badge from a row.
        This is the hook the no-JavaScript suite uses to assert that the prerendered
        HTML claims nothing, and it is never styled or read by the site itself.
      */
      data-open-status={status === null ? 'undecided' : status.isOpen ? 'open' : 'closed'}
      className={`inline-flex items-center gap-2.5 ${CONTAINER_CLASSES[variant]} ${tone} ${className}`}
    >
      <StatusDot isOpen={isOpen} variant={variant} />
      <span>
        {status === null ? UNDECIDED_LABEL : status.label}
        {status === null || status.detail === null ? null : ` · ${status.detail}`}
      </span>
      {showWeekday && status !== null ? (
        <span className="text-ink-3 font-normal">· {status.todayLabel}</span>
      ) : null}
    </p>
  )
}
