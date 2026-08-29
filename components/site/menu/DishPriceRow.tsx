import type { DishView } from '@/lib/menu/view'

import { SoldOutBadge } from './DishBadge'
import { DishPrice } from './DishPrice'

/**
 * A dish in a priced list — design 1h ("Andre retter", "Pommes & snacks", "Børn",
 * "Drikkevarer", "Dessert", "Varm selv").
 *
 * These sections carry no photography in the approved design, so they are a plain
 * two-column list: what it is on the left, what it costs on the right, in tabular
 * figures so the column lines up (1b). The price is never hidden behind an interaction.
 */
export function DishPriceRow({ dish }: { dish: DishView }) {
  return (
    <div className="border-border flex items-baseline justify-between gap-4 border-b py-3">
      <div className="min-w-0">
        <h3
          className={`text-[1.0625rem] font-semibold ${dish.soldOut ? 'text-ink-3' : 'text-ink'}`}
        >
          {dish.name}
        </h3>
        {dish.secondaryNote ? (
          <p className="text-ink-2 text-[0.90625rem]">{dish.secondaryNote}</p>
        ) : null}
        {dish.soldOut ? (
          <p className="mt-1.5">
            <SoldOutBadge />
          </p>
        ) : null}
      </div>
      <DishPrice priceOre={dish.priceOre} soldOut={dish.soldOut} size="row" />
    </div>
  )
}
