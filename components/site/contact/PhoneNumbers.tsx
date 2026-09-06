/**
 * The two numbers, with the primary one visually dominant — design 1g, 1k, 1o, 1ai.
 *
 * The order matters more than the styling: ordering is by telephone, so the number a
 * guest should ring is the largest thing in the block, and the second one is labelled
 * "Ekstra nummer" rather than presented as an equal choice.
 *
 * The numbers are printed, not linked, here. The call to action beside them is the link
 * (`PhoneAction`), which keeps one tappable target per number instead of two.
 */
export function PhoneNumbers({
  primaryPhone,
  secondaryPhone,
  size = 'default',
  className = '',
}: {
  primaryPhone: string
  secondaryPhone: string | null
  /** `prominent` is the Find os page, where the number is the point of the page (1k). */
  size?: 'default' | 'prominent'
  className?: string
}) {
  const prominent = size === 'prominent'

  return (
    <div className={className}>
      <p
        className={`font-display text-brand-700 tabular-nums ${
          prominent ? 'text-subhead' : 'text-card'
        }`}
      >
        {primaryPhone}
      </p>
      {secondaryPhone ? (
        <p className={`text-detail mt-1.5 tabular-nums ${prominent ? 'text-neutral-ink' : 'text-ink-3'}`}>
          Ekstra nummer{' '}
          {prominent ? <strong className="font-semibold">{secondaryPhone}</strong> : secondaryPhone}
        </p>
      ) : null}
    </div>
  )
}
