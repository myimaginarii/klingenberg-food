import type { DishView } from '@/lib/menu/view'

import { MediaPlaceholder } from '../MediaPlaceholder'
import { DishLabelBadge, SoldOutBadge } from './DishBadge'
import { DishPrice } from './DishPrice'

/**
 * A dish with a photograph — design 1h (desktop) and 1m (mobile).
 *
 * One structure at both sizes. The design draws a 4:3 photograph beside the text on a
 * wide screen and a 1:1 thumbnail on a phone, with the price sitting at the card's right
 * edge either way; that is a matter of proportions and type size, not of different
 * markup, so there is one card here and no mobile twin to keep in step.
 *
 * A sold-out dish is dimmed and struck through rather than removed (1af), and the badge
 * says so in words.
 */
export function DishCard({ dish }: { dish: DishView }) {
  return (
    <article
      className={`rounded-card md:rounded-card-lg border-border flex gap-3 border p-2.5 md:gap-5 md:p-4 ${
        dish.soldOut ? 'bg-surface-muted' : 'bg-surface'
      }`}
    >
      <MediaPlaceholder
        ratio="square"
        label="Retfoto"
        className={`w-24 shrink-0 self-start rounded-[0.5rem] md:aspect-card md:w-[9.375rem] md:self-center ${
          dish.soldOut ? 'opacity-70 grayscale' : ''
        }`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3
            className={`font-display text-[1.125rem] font-semibold md:text-2xl ${
              dish.soldOut ? 'text-ink-2' : 'text-ink'
            }`}
          >
            {dish.name}
          </h3>
          <DishPrice priceOre={dish.priceOre} soldOut={dish.soldOut} />
        </div>

        {dish.description ? (
          <p
            className={`mt-1 max-w-[66ch] text-meta md:mt-1.5 md:text-[0.96875rem] ${
              dish.soldOut ? 'text-ink-3' : 'text-ink-2'
            }`}
          >
            {dish.description}
          </p>
        ) : null}

        {dish.secondaryNote ? (
          <p className="text-ink-3 mt-1.5 text-[0.78125rem] font-medium tabular-nums md:text-[0.875rem]">
            {dish.secondaryNote}
          </p>
        ) : null}

        {dish.soldOut || dish.labels.length > 0 ? (
          <p className="mt-2 flex flex-wrap gap-2">
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
