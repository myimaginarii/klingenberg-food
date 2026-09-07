import { formatWeeklyHours } from '@/lib/hours/format'
import type { WeeklySchedule } from '@/lib/hours/types'

import { DailyHoursList } from './DailyHoursList'

/**
 * The opening-hours block — design 1g (seven rows) and 1l (grouped, with "Vis alle syv
 * dage").
 *
 * These are two genuinely different structures, not one structure at two sizes: on a
 * phone the schedule is collapsed to three grouped lines behind a disclosure, and on a
 * wider screen all seven are simply shown. The seven-day list is therefore the same
 * component rendered in both branches — one implementation, two placements — and each
 * branch is `display:none` at the other breakpoint, so assistive technology is offered
 * exactly one of them.
 *
 * The disclosure is a `<details>`, so it needs no JavaScript and is announced correctly
 * without any ARIA of our own.
 */
export function OpeningHours({
  schedule,
  className = '',
}: {
  schedule: WeeklySchedule
  className?: string
}) {
  const grouped = formatWeeklyHours(schedule)

  return (
    <div className={className}>
      <details className="group md:hidden">
        <summary className="cursor-pointer list-none">
          <dl className="text-base">
            {grouped.map((row, index) => (
              <div
                key={row.days}
                className={`flex items-baseline justify-between gap-4 py-2 ${
                  index < grouped.length - 1 ? 'border-border border-b' : ''
                }`}
              >
                <dt className={row.isOpen ? 'font-semibold' : ''}>{row.days}</dt>
                <dd className={`tabular-nums ${row.isOpen ? 'font-semibold' : 'text-ink-3'}`}>
                  {row.hours}
                </dd>
              </div>
            ))}
          </dl>
          <span className="border-border bg-surface rounded-button mt-3 flex min-h-tap items-center justify-between border px-3.5 text-detail font-medium">
            Vis alle syv dage
            <span aria-hidden="true" className="text-ink-3 group-open:hidden">
              +
            </span>
            <span aria-hidden="true" className="text-ink-3 hidden group-open:inline">
              −
            </span>
          </span>
        </summary>
        <div className="mt-3">
          <DailyHoursList schedule={schedule} />
        </div>
      </details>

      <div className="hidden md:block">
        <DailyHoursList schedule={schedule} />
      </div>
    </div>
  )
}
