import Link from 'next/link'

import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { describeAvailability, type AdminMenuSection } from '@/lib/menu/admin'
import type { IsoDate } from '@/lib/time/calendar'

import type { AvailabilityForm } from './AvailabilitySwitch'
import { DishRow } from './DishRow'

/**
 * The dishes in the open section — design 1r (list) and 1y (cards).
 *
 * The list ends with the design's own dashed "+ Tilføj ret til <sektion>" row, which is
 * a link to the editor panel in its create state rather than a button that inserts an
 * empty dish. A row nobody finished should not exist at all.
 *
 * SOLD-OUT IS RESOLVED, NOT READ
 *
 * `dishes.sold_out_on` is a date, not a boolean: whether it still means "sold out"
 * depends on the opening hours (§7b). `describeAvailability` answers that here — once
 * per dish, from the same pure function the public menu uses — and hands each row both
 * the state and the reset sentence, so the administration and the public site can never
 * disagree about whether Thor is currently sold out. The hours are passed in: a
 * component does not read a database, and nothing below this line computes a date.
 */
export function DishList({
  section,
  hrefForDish,
  createHref,
  hours,
  now,
  availabilityForm,
}: {
  section: AdminMenuSection
  hrefForDish: (dishId: string) => string
  createHref: string
  hours: { schedule: WeeklySchedule; overrides: readonly OpeningHoursOverride[] }
  now: Date
  /** The immediate Server Action each row's switch posts to, and its field names (§6). */
  availabilityForm: AvailabilityForm
}) {
  return (
    <div className="flex flex-col gap-3">
      {section.dishes.length === 0 ? (
        <p className="text-ink-2 text-meta">
          Der er ingen retter i {section.category.name} endnu.
        </p>
      ) : (
        <ul aria-label={`Retter i ${section.category.name}`} className="flex flex-col gap-3">
          {section.dishes.map((dish) => (
            <DishRow
              availability={describeAvailability(
                dish.soldOutOn as IsoDate | null,
                hours.schedule,
                hours.overrides,
                now,
              )}
              availabilityForm={availabilityForm}
              dish={dish}
              href={hrefForDish(dish.id)}
              key={dish.id}
              section={section.category.slug}
            />
          ))}
        </ul>
      )}

      <Link
        className="rounded-card border-rule text-ink-2 bg-surface hover:text-ink flex min-h-[3.75rem] items-center justify-center border-[1.5px] border-dashed px-4 text-center font-medium"
        href={createHref}
      >
        + Tilføj ret til {section.category.name}
      </Link>
    </div>
  )
}
