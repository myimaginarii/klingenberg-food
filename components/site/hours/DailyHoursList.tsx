import { formatDailyHours } from '@/lib/hours/format'
import type { WeeklySchedule } from '@/lib/hours/types'
import type { WeekdayKey } from '@/lib/time/calendar'

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
 */
export function DailyHoursList({
  schedule,
  todayWeekday,
}: {
  schedule: WeeklySchedule
  todayWeekday: WeekdayKey
}) {
  return (
    <dl className="text-support">
      {formatDailyHours(schedule).map((row, index, rows) => {
        const isToday = row.weekday === todayWeekday

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
