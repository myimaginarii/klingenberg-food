import { InlineLink } from '@/components/site/InlineLink'
import { Eyebrow } from '@/components/site/Eyebrow'
import { FeaturedDishCard } from '@/components/site/menu/FeaturedDishCard'
import { Section } from '@/components/site/Section'
import type { DishView } from '@/lib/menu/view'

/**
 * "Tre fra menuen" — design 1g and 1l.
 *
 * Which three is an editorial choice made in the Forside document
 * (`content/site/pages/home.json`, `featured.dishIds`); this component only renders
 * whichever dishes that list currently points at. A dish that has since been deleted
 * simply drops out rather than leaving a hole (§7e, item 4).
 *
 * The menu-price line beneath the cards is the same document's `featured.note` — it
 * states a price, so it is the restaurant's to edit beside the cards it describes.
 * Without one, no line is drawn.
 */
export function FeaturedDishes({ dishes, note }: { dishes: DishView[]; note: string | null }) {
  if (dishes.length === 0) return null

  return (
    <Section ariaLabelledBy="udvalgte-titel">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Udvalgte</Eyebrow>
          <h2 id="udvalgte-titel" className="font-display text-subhead mt-2">
            Tre fra menuen
          </h2>
        </div>
        <InlineLink href="/menu">Se hele menuen</InlineLink>
      </div>

      <ul className="grid gap-3 md:grid-cols-3 md:gap-5">
        {dishes.map((dish) => (
          <li key={dish.id} className="flex">
            <FeaturedDishCard dish={dish} />
          </li>
        ))}
      </ul>

      {note ? (
        <p className="text-ink-2 mt-4 flex items-center gap-2.5 tabular-nums">
          <span aria-hidden="true" className="bg-rule size-2 shrink-0 rounded-full" />
          {note}
        </p>
      ) : null}
    </Section>
  )
}
