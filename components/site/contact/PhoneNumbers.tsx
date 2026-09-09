import { PhoneAction } from '../PhoneAction'

/**
 * The two numbers, with the primary one visually dominant — design 1g, 1k, 1o, 1ai.
 *
 * The order matters more than the styling: ordering is by telephone, so the number a
 * guest should ring is the largest thing in the block, and the second one is labelled
 * "eller" rather than presented as an equal choice.
 *
 * The "eller" line is set in `neutral-ink`, not the label grey: at 14 px the label grey
 * read as faint beside the burgundy display number, and a second number a guest may
 * need to ring has to be legible at a glance. It stays clearly secondary through size
 * and weight — regular detail text against a bold display-size primary — rather than
 * through a lighter colour.
 *
 * Two sizes, one rule: one tappable target per number.
 *
 * - `default` (the Forside's visit panel) prints both numbers as text; the call to
 *   action beside them (`PhoneAction`) is the link.
 * - `prominent` (Find os) *is* the call to action: the primary number is rendered as
 *   the site's "Ring +45 …" button, because it is the only place on that page the
 *   number appears, and the "eller" line sits beneath it. Nothing else on Find os
 *   links the number, so the button is the one target rather than a second one.
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
      {prominent ? (
        <PhoneAction
          phone={primaryPhone}
          label="Ring"
          showNumber
          size="large"
          block
          className="md:w-auto"
        />
      ) : (
        <p className="font-display text-brand-700 text-card tabular-nums">{primaryPhone}</p>
      )}
      {secondaryPhone ? (
        <p className={`text-detail text-neutral-ink tabular-nums ${prominent ? 'mt-3' : 'mt-1.5'}`}>
          eller{' '}
          {prominent ? <strong className="font-semibold">{secondaryPhone}</strong> : secondaryPhone}
        </p>
      ) : null}
    </div>
  )
}
