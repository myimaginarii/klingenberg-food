import { formatPrice } from '@/lib/format/danish'

/**
 * A price on the menu — design 1b ("price · Bricolage 600 tabular") and 1h.
 *
 * Tabular figures so a column of prices lines up, and one place that decides what a
 * sold-out price looks like: struck through and quietened, never removed. The guest can
 * still see what the dish costs when it is back tomorrow (1af).
 */
export type DishPriceSize = 'card' | 'row' | 'portion'

const SIZE_CLASSES: Record<DishPriceSize, string> = {
  /** The burger cards on the menu and the Forside. */
  card: 'text-[1.0625rem] md:text-[1.625rem]',
  /** The two-column price lists. */
  row: 'text-[1.1875rem]',
  /** Ugens ret's Lille / Stor portions, and the Lørdagsmenu. */
  portion: 'text-[1.375rem] font-bold',
}

export function DishPrice({
  priceOre,
  soldOut = false,
  size = 'card',
  className = '',
}: {
  priceOre: number | null
  soldOut?: boolean
  size?: DishPriceSize
  className?: string
}) {
  if (priceOre === null) return null

  return (
    <b
      className={`tabular-price whitespace-nowrap ${SIZE_CLASSES[size]} ${
        soldOut ? 'text-ink-3 line-through decoration-[1.5px]' : 'text-ink'
      } ${className}`}
    >
      {formatPrice(priceOre)}
    </b>
  )
}
