import Link from 'next/link'

import type { AdminImageThumbnail } from '@/lib/content/images-admin'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { describeAvailability, type AdminMenuSection } from '@/lib/menu/admin'
import { describeMove, orderFingerprint } from '@/lib/menu/reorder'
import type { IsoDate } from '@/lib/time/calendar'

import type { AvailabilityForm } from './AvailabilitySwitch'
import { DishRow } from './DishRow'
import type { ReorderForm } from './ReorderControls'

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
 *
 * THE ORDER IS THE SERVER'S, AND SO IS THE FINGERPRINT OF IT (phase 5E)
 *
 * `section.dishes` arrives already ordered by `groupDishesBySection`, drafts applied, so
 * this list shows the order the next publish will produce while the public menu keeps
 * the published one. Each row carries the same **fingerprint** of that order, computed
 * here, once, from the dishes the server just read. A move submits it back, the Server
 * Action recomputes it from its own read, and a mismatch is refused with "Nogen andre
 * har rettet dette." rather than applied to a list the person never saw (§7e item 2).
 *
 * THE LIVE REGION IS SERVER-RENDERED, AND THAT IS THE POINT
 *
 * The polite status below announces *"Odin flyttet til plads 3 af 6."* It is rendered on
 * every request — empty when nothing moved — so the element is already in the accessibility
 * tree when its text changes after a move. A live region that appears at the same moment
 * as its content is the one that does not get announced, which is exactly the mistake
 * this ordering avoids. Nothing in the browser composes the sentence, and nothing
 * remembers it: it comes from the dish id in the URL and the order the server just read.
 */
export function DishList({
  section,
  hrefForDish,
  createHref,
  hours,
  now,
  availabilityForm,
  reorderForm,
  movedDishId,
  thumbnails,
}: {
  section: AdminMenuSection
  hrefForDish: (dishId: string) => string
  createHref: string
  /**
   * The public thumbnails of this section's current image selections, by image id —
   * one read by the page (phase 12A). A dish whose id is not in the map draws its
   * empty frame; the list itself reads nothing.
   */
  thumbnails: ReadonlyMap<string, AdminImageThumbnail>
  hours: { schedule: WeeklySchedule; overrides: readonly OpeningHoursOverride[] }
  now: Date
  /** The immediate Server Action each row's switch posts to, and its field names (§6). */
  availabilityForm: AvailabilityForm
  /** The draft Server Action each row's reorder form posts to, and its field names. */
  reorderForm: ReorderForm
  /** The dish the last reorder moved, from the URL. Presentation only. */
  movedDishId?: string
}) {
  const total = section.dishes.length

  // One dish cannot be reordered, and two identical disabled buttons plus an inert
  // handle would be three controls that say "you may move this" and then do not.
  const movable = total > 1
  const baseline = orderFingerprint(section.category.id, section.dishes)

  const movedIndex = section.dishes.findIndex((dish) => dish.id === movedDishId)
  const moved = movedIndex === -1 ? null : section.dishes[movedIndex]

  return (
    <div className="flex flex-col gap-3">
      {/*
        Always present, usually empty, and never drawn. See the note above: a live region
        has to be in the accessibility tree *before* the thing it announces arrives, so
        it cannot be conditionally rendered and it cannot be `display: none` — both take
        it out of the tree and take the announcement with it. `sr-only` keeps it there
        while taking it out of the layout, which is why it does not leave a gap above the
        list on every ordinary request.

        Nothing is lost for a sighted person: they can see where the dish went, and the
        Kladde notice above the list says in words that the new order is not live yet.
      */}
      <p aria-label="Rækkefølge" aria-live="polite" className="sr-only" role="status">
        {moved === undefined || moved === null
          ? ''
          : describeMove({ dishName: moved.name, position: movedIndex + 1, total })}
      </p>

      {total === 0 ? (
        <p className="text-ink-2 text-meta">
          Der er ingen retter i {section.category.name} endnu.
        </p>
      ) : (
        <ul aria-label={`Retter i ${section.category.name}`} className="flex flex-col gap-3">
          {section.dishes.map((dish, index) => (
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
              reorder={
                movable
                  ? {
                      baseline,
                      form: reorderForm,
                      index,
                      justMoved: dish.id === movedDishId,
                      total,
                    }
                  : null
              }
              section={section.category.slug}
              thumbnail={dish.imageId === null ? null : (thumbnails.get(dish.imageId) ?? null)}
            />
          ))}
        </ul>
      )}

      {/*
        1r's own note about the handle, and 1y's about holding a row — each at the width
        it was drawn for. The last sentence is at both widths because it is the path that
        does not depend on a gesture, on a pointer, or on JavaScript being available.
      */}
      {movable ? (
        <p className="text-ink-2 text-meta">
          <span className="md:hidden">Hold på håndtaget for at flytte en række. </span>
          <span className="hidden md:inline">
            Rækkefølgen ændres ved at trække i håndtaget til venstre.{' '}
          </span>
          Du kan også bruge Flyt op og Flyt ned. Den nye rækkefølge er en kladde, indtil du
          offentliggør den.
        </p>
      ) : null}

      <Link
        className="rounded-card border-rule text-ink-2 bg-surface hover:text-ink flex min-h-[3.75rem] items-center justify-center border-[1.5px] border-dashed px-4 text-center font-medium"
        href={createHref}
      >
        + Tilføj ret til {section.category.name}
      </Link>
    </div>
  )
}
