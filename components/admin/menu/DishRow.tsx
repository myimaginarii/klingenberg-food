import Link from 'next/link'

import { formatPrice } from '@/lib/format/danish'
import { describePendingChange, type AdminDish } from '@/lib/menu/admin'

/**
 * One dish in the administration's list — design 1r (row) and 1y (card).
 *
 * The two frames are not the same layout at two sizes, and this component does not
 * pretend they are. 1r puts everything on one line: name, the line beneath it, the
 * price field, the availability state and the labels. 1y stacks a card — name and
 * "Tryk for at rette" first, then a row holding the price and the availability. The
 * markup below is the *card*, and from the `md` breakpoint the same elements lay
 * themselves out as the row. One list, one tab order, one set of states, two
 * arrangements — which is what "mobil er ikke en skrumpet desktop" (1aa) asks for.
 *
 * KLADDE IS DERIVED, NEVER REMEMBERED
 *
 * The warning surface, the badge and the sentence beneath the name all come from the
 * stored draft — `hasDraft` and the fields it actually changes — by way of
 * `describePendingChange`. Nothing about pending state is held in the browser, so the
 * row cannot claim a change the database does not have.
 *
 * UDSOLGT IS SHOWN, NOT OFFERED
 *
 * Availability is rendered from `sold_out_on` and is **read-only in phase 5B**. The
 * toggle in 1r is the immediate path with a 10-second Fortryd (§6) and belongs to the
 * next increment; drawing a control that does nothing would be worse than drawing the
 * state it already has, so the slot shows the state as a badge.
 */

/** The price field from 1r, and the price line of the 1y card. */
function PriceTag({ priceOre, pending }: { priceOre: number | null; pending: boolean }) {
  return (
    <p
      className={`rounded-field min-h-12 flex min-w-[7rem] items-center justify-between gap-1 border-[1.5px] px-3 md:justify-end ${
        pending ? 'border-warning bg-surface' : 'border-field-border bg-field-bg'
      }`}
    >
      <span className="text-ink-3 text-micro md:sr-only">Pris</span>
      <span className="text-ink font-semibold tabular-nums">
        {priceOre === null ? 'Ingen pris' : formatPrice(priceOre)}
      </span>
    </p>
  )
}

/**
 * Tilgængelig / Udsolgt, as state rather than as a control (1r, 1y, 1aa).
 *
 * Icon shape *and* text *and* colour: a ring for sold out, a filled dot for available,
 * so the two are distinguishable with the colours switched off (1aa).
 */
function AvailabilityState({ soldOut }: { soldOut: boolean }) {
  return (
    <p
      className={`rounded-field min-h-12 flex items-center gap-2 border-[1.5px] px-3 text-meta font-semibold ${
        soldOut
          ? 'border-field-border bg-surface-muted text-ink-2'
          : 'border-success-border bg-success-surface text-success-ink'
      }`}
    >
      {soldOut ? (
        <span aria-hidden="true" className="border-error size-2 shrink-0 rounded-full border-2" />
      ) : (
        <span aria-hidden="true" className="bg-success size-2 shrink-0 rounded-full" />
      )}
      {soldOut ? 'Udsolgt' : 'Tilgængelig'}
    </p>
  )
}

/** The Kladde badge from 1aa: a rotated square, the word, and the warning tone. */
export function KladdeBadge() {
  return (
    <span className="rounded-badge border-warning-border bg-warning-surface text-warning-ink inline-flex items-center gap-1.5 border px-2.5 py-1 text-micro leading-none font-semibold">
      <span aria-hidden="true" className="bg-warning size-2 rotate-45" />
      Kladde
    </span>
  )
}

export function DishRow({ dish, href, soldOut }: { dish: AdminDish; href: string; soldOut: boolean }) {
  const pending = describePendingChange(dish)
  const priceChanged = dish.draftFields.includes('price_ore')

  return (
    <li
      className={`rounded-card border p-3 md:px-4 ${
        pending === null
          ? 'border-border bg-surface'
          : 'border-warning-border bg-warning-surface border-[1.5px]'
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <div className="min-w-0 flex-1">
          <Link className="min-h-tap flex flex-col justify-center gap-1" href={href}>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-ink font-semibold">{dish.name}</span>
              {pending === null ? null : <KladdeBadge />}
            </span>
            {/*
              The line beneath the name differs between the two frames, so it is not one
              string at two sizes. 1y's card says "Tryk for at rette" — on a phone the
              description is three lines the person did not ask for. 1r's row shows the
              description, truncated to one line. A pending change outranks both: it is
              the reason the row is drawn in the warning tone, so it is shown at every
              width.
            */}
            {pending === null ? (
              <>
                <span className="text-ink-2 text-meta md:hidden">Tryk for at rette</span>
                <span className="text-ink-2 text-meta hidden truncate md:block">
                  {dish.description ?? 'Tryk for at rette'}
                </span>
              </>
            ) : (
              <span className="text-warning-ink-2 text-meta">{pending}</span>
            )}
          </Link>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <PriceTag priceOre={dish.priceOre} pending={priceChanged} />
          <AvailabilityState soldOut={soldOut} />
        </div>

        {/* 1r reserves a narrow slot for the labels beside the row; 1y has no room for
            them, and the editor is one tap away. */}
        {dish.labels.length === 0 ? null : (
          <ul className="hidden flex-wrap gap-1 md:flex md:w-32">
            {dish.labels.map((label) => (
              <li
                className="rounded-badge bg-brand-50 text-brand-700 px-2.5 py-1 text-micro leading-none font-medium"
                key={label}
              >
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}
