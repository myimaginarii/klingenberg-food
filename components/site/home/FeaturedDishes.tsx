import { InlineLink } from '@/components/site/InlineLink'
import { Eyebrow } from '@/components/site/Eyebrow'
import { FeaturedDishCard } from '@/components/site/menu/FeaturedDishCard'
import { Section } from '@/components/site/Section'
import type { DishView } from '@/lib/menu/view'

/**
 * "Tre fra menuen" — design 1g and 1l.
 *
 * Which three is an editorial choice the owner makes in the Forsiden editor
 * (`pages.home.featured_dish_ids`, §5); this component only renders whichever dishes
 * that list currently points at. A dish that has since been deleted simply drops out
 * rather than leaving a hole (§7e, item 4).
 *
 * The menu-price line beneath the cards is page copy from 1g. It moves into the Forsiden
 * document when that editor is built in phase 11; until then it lives here, beside the
 * cards it describes, rather than being invented per render.
 */
const MENU_PRICE_NOTE =
  'Alle burgere kan bestilles som menu med pommes frites og sodavand — 124 kr., Ragnar 132 kr.'

export function FeaturedDishes({ dishes }: { dishes: DishView[] }) {
  if (dishes.length === 0) return null

  return (
    <Section ariaLabelledBy="udvalgte-titel">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Udvalgte</Eyebrow>
          <h2 id="udvalgte-titel" className="font-display mt-2 text-[1.75rem] md:text-title-sm">
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

      <p className="text-ink-2 mt-4 flex items-center gap-2.5 tabular-nums">
        <span aria-hidden="true" className="bg-rule size-2 shrink-0 rounded-full" />
        {MENU_PRICE_NOTE}
      </p>
    </Section>
  )
}
