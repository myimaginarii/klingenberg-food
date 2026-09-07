'use client'

import { useEffect, useState } from 'react'

import { type OpenStatusSnapshot, readOpenStatus } from '@/lib/hours/status'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'

import { OpenStatusBadge, type OpenStatusVariant } from './OpenStatusBadge'

/**
 * The open/closed badge, computed in the browser — technical plan §7a.
 *
 * The site is a **static export**: every page is rendered once, at build time, and then
 * served unchanged for as long as it stands. A clock read during that render is not a
 * stale answer, it is an answer to a question nobody asked — "was the restaurant open
 * when this site was built". Printing it as "Åbent nu" would be a claim the HTML cannot
 * support, and it would be wrong far more often than it was right.
 *
 * So nothing here is decided on the server. The badge is rendered from the schedule and
 * the published overrides that are already in the page, by the same pure engine the
 * hours table reads, and it is decided at the only moment the answer is meaningful:
 *
 *  * The **server** renders the neutral state — the word "Åbningstider" beside a neutral
 *    dot. It claims nothing about now, and it is what a visitor without JavaScript
 *    reads. The opening hours themselves are on the page regardless: the footer carries
 *    the grouped week on every page, and Forside and Find os draw the full table.
 *  * On mount the browser computes the real state, then recomputes once a minute, and
 *    re-checks on `visibilitychange` — a phone restored from the background hours later
 *    will not have fired a pending interval reliably, and on mobile that is the case
 *    that actually matters.
 *
 * The first client render matches the server's, so there is no hydration mismatch; the
 * live value replaces it in the same tick as the mount effect.
 *
 * **What it does not do:** no `fetch`, no polling of a server, no cookie, no state
 * library. It reads two props and a clock — which is what keeps §12's "a visitor
 * receives zero cookies and no tracking" true.
 */

const RECHECK_INTERVAL_MS = 60_000

export function OpenStatus({
  schedule,
  overrides,
  variant,
  showWeekday,
  className,
}: {
  schedule: WeeklySchedule
  overrides: OpeningHoursOverride[]
  variant?: OpenStatusVariant
  showWeekday?: boolean
  className?: string
}) {
  const [status, setStatus] = useState<OpenStatusSnapshot | null>(null)

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
