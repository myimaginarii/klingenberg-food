'use client'

import { useEffect, useState } from 'react'

import { type OpenStatusSnapshot, readOpenStatus } from '@/lib/hours/status'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'

import { OpenStatusBadge, type OpenStatusVariant } from './OpenStatusBadge'

/**
 * The open/closed badge, corrected in the browser — technical plan §7a, correction C1's
 * sibling.
 *
 * The public site is served from a cache that can be up to five minutes old, which is
 * invisible for a menu and wrong for a badge that says "Åbent nu" four minutes after
 * the doors shut. This component fixes exactly that, and does nothing else:
 *
 *  * The **server** renders the badge. `initialStatus` is the server's own answer, so
 *    the first client render is byte-identical to the HTML and there is no flash and no
 *    hydration mismatch.
 *  * On mount it recomputes from the same pure engine and then once a minute, and it
 *    re-checks on `visibilitychange` — a phone restored from the background hours later
 *    will not have fired a pending interval reliably, and on mobile that is the case
 *    that actually matters.
 *
 * **What it does not do:** no `fetch`, no Supabase client, no realtime subscription, no
 * polling of the server, no cookie, no state library. It reads two props and a clock.
 * The schedule and overrides it needs are already in the page's HTML; this adds no
 * request of any kind, which is what keeps §12's "a visitor receives zero cookies and
 * no tracking" true.
 *
 * With JavaScript disabled the server-rendered value stands — at most five minutes
 * stale, exactly as §7a specifies.
 */

const RECHECK_INTERVAL_MS = 60_000

export function OpenStatus({
  initialStatus,
  schedule,
  overrides,
  variant,
  showWeekday,
  className,
}: {
  initialStatus: OpenStatusSnapshot
  schedule: WeeklySchedule
  overrides: OpeningHoursOverride[]
  variant?: OpenStatusVariant
  showWeekday?: boolean
  className?: string
}) {
  const [status, setStatus] = useState(initialStatus)

  useEffect(() => {
    const recompute = () => {
      setStatus(readOpenStatus(new Date(), schedule, overrides))
    }

    recompute()

    const interval = window.setInterval(recompute, RECHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', recompute)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', recompute)
    }
  }, [schedule, overrides])

  return (
    <OpenStatusBadge
      status={status}
      variant={variant}
      showWeekday={showWeekday}
      className={className}
    />
  )
}
