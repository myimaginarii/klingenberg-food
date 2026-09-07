'use client'

import { useEffect, useState } from 'react'

import { formatDailyHours } from '@/lib/hours/format'
import type { WeeklySchedule } from '@/lib/hours/types'
import { weekdayOf, type WeekdayKey } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

/**
 * All seven days, one row each — design 1g, 1k, 1o.
 *
 * A description list, because that is what it is: seven terms and their hours. The rows
 * come from `formatDailyHours`, the same formatter the footer's grouped lines are built
 * on, so the two presentations of the schedule can never disagree.
 *
 * Today is marked with the words "· i dag" as well as a tint. The design shows both in
 * 1k; carrying the marker everywhere means the row is still identifiable without colour
 * (1aa).
 *
 * WHICH ROW IS TODAY IS DECIDED IN THE BROWSER, for the same reason the open/closed
 * badge is (`components/site/OpenStatus.tsx`): the site is a static export, so a
 * weekday read while it was built would mark the same row forever. The prerendered
 * HTML therefore marks no row — seven plain rows, every one of them true — and the
 * browser tints the right one. A visitor without JavaScript reads the whole week
 * correctly and is told nothing false about which day it is.
 *
 * It subscribes to the clock rather than reading it once, on the same terms as the
 * badge: a page left open past midnight, or a phone restored from the background the
 * next morning, would otherwise keep yesterday's row marked.
 */
const RECHECK_INTERVAL_MS = 60_000

export function DailyHoursList({ schedule }: { schedule: WeeklySchedule }) {
  const [today, setToday] = useState<WeekdayKey | null>(null)

  useEffect(() => {
    const recompute = () => {
      setToday(weekdayOf(copenhagenDateOf(new Date())))
    }

    recompute()

    const interval = window.setInterval(recompute, RECHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', recompute)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', recompute)
    }
  }, [])

  return (
    <dl className="text-support">
      {formatDailyHours(schedule).map((row, index, rows) => {
        const isToday = row.weekday === today

        return (
          <div
            key={row.weekday}
            className={`flex items-baseline justify-between gap-4 py-2 ${
              index < rows.length - 1 ? 'border-border border-b' : ''
            } ${isToday ? 'bg-brand-50 rounded-[6px] px-2 -mx-2' : ''}`}
          >
            <dt className={isToday ? 'font-semibold' : ''}>
              {row.day}
              {isToday ? <span className="text-brand-700 font-medium"> · i dag</span> : null}
            </dt>
            <dd
              className={`tabular-nums ${isToday ? 'font-semibold' : ''} ${
                row.isOpen ? '' : 'text-ink-3'
              }`}
            >
              {row.hours}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
