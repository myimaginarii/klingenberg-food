import type { DishView } from '@/lib/menu/view'

import { MediaPlaceholder } from '../MediaPlaceholder'
import { DishLabelBadge, SoldOutBadge } from './DishBadge'
import { DishPrice } from './DishPrice'

/**
 * One of the three burgers the Forside features — design 1g and 1l.
 *
 * A different shape from the menu page's card, not a variant of it: here the photograph
 * sits above the text in a three-up grid on a wide screen and beside it on a phone,
 * because the Forside is showing a selection rather than listing a section. What the two
 * share — the price format, the label chips, the sold-out treatment — is shared as
 * components rather than copied.
 */
export function FeaturedDishCard({ dish }: { dish: DishView }) {
  return (
    <article
      className={`border-border rounded-card md:rounded-card-lg flex w-full overflow-hidden border md:flex-col ${
        dish.soldOut ? 'bg-surface-muted' : 'bg-surface'
      }`}
    >
      <MediaPlaceholder
        ratio="square"
        label="Retfoto"
        className={`border-border w-24 shrink-0 self-start border-0 md:aspect-hero md:w-full md:border-b ${
          dish.soldOut ? 'opacity-70 grayscale' : ''
        }`}
      />

      <div className="min-w-0 flex-1 p-2.5 md:p-4.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-[1.125rem] font-semibold md:text-[1.3125rem]">
            {dish.name}
          </h3>
          <DishPrice
            priceOre={dish.priceOre}
            soldOut={dish.soldOut}
            className="md:text-[1.3125rem]"
          />
        </div>

        {dish.description ? (
          <p className="text-ink-2 mt-1.5 text-[0.90625rem]">{dish.description}</p>
        ) : null}

        {dish.soldOut || dish.labels.length > 0 ? (
          <p className="mt-3 flex flex-wrap gap-2">
            {dish.soldOut ? <SoldOutBadge /> : null}
            {dish.labels.map((label) => (
              <DishLabelBadge key={label} label={label} />
            ))}
          </p>
        ) : null}
      </div>
    </article>
  )
}
