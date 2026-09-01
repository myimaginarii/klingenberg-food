import { NO_SATURDAY_MENU } from '@/lib/menu/weekly'
import type { WeeklySpecialView } from '@/lib/menu/view'

import { SiteImage } from '../SiteImage'
import { SoldOutBadge } from './DishBadge'
import { DishPrice } from './DishPrice'

/**
 * Ugens ret and Lørdagsmenu — design 1h and, for every state, 1af.
 *
 * "Ugens ret skifter hver uge — layoutet må ikke." The section keeps its size whether
 * there is a photograph, whether the dish is sold out and whether there is a Saturday
 * menu at all: an absent Saturday menu becomes the calm dashed card that says
 * "Ingen lørdagsmenu denne uge" rather than a hole (1af).
 *
 * Nothing here is written by us. The week, the days, the dish and both prices come from
 * `weekly_special`, which the kitchen fills in each week; phase 6A built the editor.
 *
 * The empty state's wording is imported rather than written here, because the
 * administration promises it word for word — 1ag's toggle reads *"Slå fra, og der står
 * 'Ingen lørdagsmenu denne uge'"*. Two copies of an approved sentence is one copy too
 * many, so it is stated once in `lib/menu/weekly.ts` and read by both sides.
 *
 * The week's photograph (phase 10C-2) is the row's library image in 1h/1af's 4:3
 * frame — full width above the text on a phone (1m), a column beside it from `md` —
 * or the reserved frame when the kitchen selected none. The Saturday menu has no
 * photo slot in any frame, and none is invented.
 */

export function WeeklySpecial({ weekly }: { weekly: WeeklySpecialView }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      {weekly.name ? <WeekDishCard weekly={weekly} /> : null}
      <SaturdayCard weekly={weekly} />
    </div>
  )
}

function WeekDishCard({ weekly }: { weekly: WeeklySpecialView }) {
  return (
    <article
      className={`rounded-card-lg border-border flex flex-1 flex-col overflow-hidden border md:flex-row lg:flex-[1.5] ${
        weekly.soldOut ? 'bg-surface-muted' : 'bg-surface'
      }`}
    >
      <SiteImage
        image={weekly.image}
        ratio="card"
        sizes="weeklyCard"
        placeholder={{ label: 'Foto', detail: 'valgfrit' }}
        className={`border-border w-full shrink-0 border-0 border-b md:w-50 md:border-r md:border-b-0 ${
          weekly.soldOut ? 'opacity-70 grayscale' : ''
        }`}
      />

      <div className="flex-1 p-4 md:p-5">
        <p className="flex flex-wrap items-center gap-2.5">
          {weekly.isoWeek === null ? null : (
            <span className="bg-brand-50 text-brand-700 rounded-badge px-2.5 py-1.5 text-micro leading-none font-medium tabular-nums">
              {`Uge ${weekly.isoWeek}`}
            </span>
          )}
          {weekly.daysLabel ? (
            <span className="text-ink-3 text-[0.84375rem]">{weekly.daysLabel}</span>
          ) : null}
          {weekly.soldOut ? <SoldOutBadge /> : null}
        </p>

        <h3
          className={`font-display mt-2 text-[1.375rem] font-semibold md:text-2xl ${
            weekly.soldOut ? 'text-ink-2' : 'text-ink'
          }`}
        >
          {weekly.name}
        </h3>

        {weekly.description ? (
          <p className={`mt-1.5 ${weekly.soldOut ? 'text-ink-3' : 'text-ink-2'}`}>
            {weekly.description}
          </p>
        ) : null}

        <div className="mt-3.5 flex gap-7">
          <PortionPrice label="Lille portion" priceOre={weekly.priceSmallOre} soldOut={weekly.soldOut} />
          <PortionPrice label="Stor portion" priceOre={weekly.priceLargeOre} soldOut={weekly.soldOut} />
        </div>
      </div>
    </article>
  )
}

function PortionPrice({
  label,
  priceOre,
  soldOut,
}: {
  label: string
  priceOre: number | null
  soldOut: boolean
}) {
  if (priceOre === null) return null

  return (
    <p>
      <span className="text-ink-3 block text-[0.8125rem]">{label}</span>
      <DishPrice priceOre={priceOre} soldOut={soldOut} size="portion" />
    </p>
  )
}

function SaturdayCard({ weekly }: { weekly: WeeklySpecialView }) {
  const saturday = weekly.saturday

  if (!saturday.enabled || saturday.name === null) {
    return (
      <aside className="border-rule bg-field-bg rounded-card-lg flex flex-1 flex-col justify-center border-[1.5px] border-dashed p-4 md:p-5">
        <h3 className="font-mono text-label text-ink-3 uppercase">Lørdagsmenu</h3>
        <p className="text-ink-2 mt-2.5 text-[1.0625rem] font-semibold">{NO_SATURDAY_MENU}</p>
      </aside>
    )
  }

  return (
    <aside
      className={`rounded-card-lg border-border flex flex-1 flex-col border p-4 md:p-5 ${
        saturday.soldOut ? 'bg-surface-muted' : 'bg-surface'
      }`}
    >
      <h3 className="font-mono text-label text-ink-3 uppercase">Lørdagsmenu</h3>
      <p className="font-display mt-2.5 text-[1.3125rem] font-semibold">{saturday.name}</p>
      {saturday.description ? (
        <p className="text-ink-2 mt-1.5 text-[0.9375rem]">{saturday.description}</p>
      ) : null}
      {saturday.soldOut ? (
        <p className="mt-2.5">
          <SoldOutBadge />
        </p>
      ) : null}
      <div className="mt-3 flex items-baseline justify-between gap-4">
        {saturday.deadline ? (
          <span className="text-ink-3 text-[0.84375rem]">{saturday.deadline}</span>
        ) : null}
        <DishPrice priceOre={saturday.priceOre} soldOut={saturday.soldOut} size="portion" />
      </div>
    </aside>
  )
}
