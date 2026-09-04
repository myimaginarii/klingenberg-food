import Link from 'next/link'

import type { AdminImageThumbnail } from '@/lib/content/images-admin'
import { formatPrice } from '@/lib/format/danish'
import { describePendingChange, type AdminDish, type DishAvailability } from '@/lib/menu/admin'

import { ImageThumbnail } from '../images/ImageThumbnail'
import {
  AvailabilityResetNote,
  AvailabilitySwitch,
  type AvailabilityForm,
} from './AvailabilitySwitch'
import { ReorderControls, type ReorderForm } from './ReorderControls'

/**
 * One dish in the administration's list — design 1r (row) and 1y (card).
 *
 * The two frames are not the same layout at two sizes, and this component does not
 * pretend they are. 1r puts everything on one line: name, the line beneath it, the
 * price field, the availability control and the labels. 1y stacks a card — name and
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
 * AVAILABILITY IS THE ONE IMMEDIATE CONTROL
 *
 * The switch posts to its own Server Action and changes the hjemmeside at once (§6);
 * everything else on this row is a link into the editor, where a change becomes a
 * draft. The two are deliberately not the same shape: a Kladde row is drawn in the
 * warning tone and says what is waiting, and this control says what is *live*. When a
 * dish is sold out the row also carries the §7b reset sentence, so the person can see
 * when it lifts without opening anything.
 */

/** The price field from 1r, and the price line of the 1y card. */
function PriceTag({ priceOre, pending }: { priceOre: number | null; pending: boolean }) {
  return (
    <p
      className={`rounded-field min-h-12 flex min-w-[7rem] items-center justify-between gap-1 border-[1.5px] px-3 whitespace-nowrap md:justify-end ${
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
 * The frame both frames draw beside the name: 1y's 60 × 52 on the card, 1r's 72 × 58
 * on the row, 8 px corners, never shrinking. One box whether or not there is a photo in
 * it, so a row without one is exactly as tall as its neighbour.
 */
const THUMBNAIL_FRAME = 'rounded-field h-13 w-15 shrink-0 md:h-14.5 md:w-18'

/**
 * The row's photo — the FOTO frame 1r and 1y both draw beside the name (phase 12A).
 *
 * WHICH PHOTO. The dish's *current* selection: the published image with the draft
 * over it — the same overlay the name and the price on this row already show, and
 * the same one the editor's slot shows one tap away. A pending photo is therefore
 * visible here exactly as a pending price is, and the sentence beneath the name
 * ("Ny billede afventer offentliggørelse") says so in words; the public menu keeps
 * the published one until Offentliggør. Nothing here is a second read model.
 *
 * WHAT IT SAYS. Nothing. The link's own text names the dish, so the picture inside it
 * is a visual identifier and carries `alt=""` — the library's description would be
 * read as part of the link's name, in front of the dish's, and the row would
 * introduce itself twice. Its accessible name is one tap away, in the editor's slot.
 *
 * WHAT IT LOADS. The smallest public derivative pair through the one admin renderer,
 * composed by the read layer — never the private original, never a storage address
 * built here. A sold-out dish's photo is greyed and dimmed, as 1y draws Thor's.
 *
 * NO PHOTO. The design's own `.ph` frame, in the administration's dress: the
 * `bg-field-bg` box with the mono "Foto" the editor's slot already uses for a
 * selection without a thumbnail. No icon, no stock image, and hidden from assistive
 * technology — it is a reserved space, not information.
 */
function DishThumbnail({
  thumbnail,
  soldOut,
}: {
  thumbnail: AdminImageThumbnail | null
  soldOut: boolean
}) {
  if (thumbnail === null) {
    return (
      <span
        aria-hidden="true"
        className={`${THUMBNAIL_FRAME} bg-field-bg border-field-border text-ink-3 row-span-2 flex items-center justify-center border font-mono text-label uppercase`}
      >
        Foto
      </span>
    )
  }

  // The `<picture>` is the renderer's; the grid placement is this row's, so it goes on
  // a wrapper — one that holds no span, for the same reason the text rows have none.
  return (
    <span className="row-span-2 flex">
      <ImageThumbnail
        altText={null}
        className={`${THUMBNAIL_FRAME} object-cover ${soldOut ? 'opacity-70 grayscale' : ''}`}
        sizes="(min-width: 768px) 4.5rem, 3.75rem"
        thumbnail={thumbnail}
      />
    </span>
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

export function DishRow({
  dish,
  href,
  thumbnail,
  availability,
  availabilityForm,
  reorder,
  section,
}: {
  dish: AdminDish
  href: string
  /**
   * The public thumbnail of the dish's current image selection, or `null` when it has
   * none (or none the caller may see). Resolved by the page from `dish.imageId` in one
   * read for the whole section (phase 12A); the row never reads.
   */
  thumbnail: AdminImageThumbnail | null
  availability: DishAvailability
  /** The immediate Server Action and the field names it reads (§6). */
  availabilityForm: AvailabilityForm
  /**
   * Everything this row needs to be movable, or `null` when it is not — a section with
   * one dish in it has no order to change (phase 5E).
   */
  reorder: {
    readonly form: ReorderForm
    /** Zero-based position in the section's list. */
    readonly index: number
    readonly total: number
    /** The fingerprint of the order this screen was rendered from (§7e item 2). */
    readonly baseline: string
    /** True when this is the dish the last reorder moved. Focus recovery only. */
    readonly justMoved: boolean
  } | null
  /** The section chip the immediate action should reopen. Navigation only. */
  section: string
}) {
  const pending = describePendingChange(dish)
  const priceChanged = dish.draftFields.includes('price_ore')

  return (
    <li
      /*
       * `relative` and the two `data-` states exist for the drag gesture and for nothing
       * else. `ReorderHandle` sets `data-dragging` on the row under the pointer and
       * `data-drop` on the row it would land beside; both are removed when the gesture
       * ends. The styling is stated here, with the rest of the row's appearance, so the
       * client component moves an attribute rather than carrying a stylesheet.
       */
      className={`rounded-card relative border p-3 data-[dragging=true]:shadow-panel md:px-4 data-[drop=after]:border-b-[3px] data-[drop=after]:border-b-brand-700 data-[drop=before]:border-t-[3px] data-[drop=before]:border-t-brand-700 ${
        pending === null
          ? 'border-border bg-surface'
          : 'border-warning-border bg-warning-surface border-[1.5px]'
      }`}
    >
      {/*
        `md:flex-wrap` plus the name column's own minimum is what keeps 1r's row from
        crushing itself. The row carries four things beside the name — the reorder
        cluster, the price, the availability control and the label slot — and their
        widths are fixed, so in a narrow container the only thing left to shrink was the
        name: at 768 px, and at any width with the editor panel open, "Glade Gris"
        wrapped onto two lines and its description truncated to "P…". Now the trailing
        group drops onto a second line instead, which is the arrangement 1y already
        draws on the phone. Nothing about the wide row changes.
      */}
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-4">
        {reorder === null ? null : (
          <ReorderControls
            baseline={reorder.baseline}
            dishId={dish.id}
            dishName={dish.name}
            form={reorder.form}
            index={reorder.index}
            justMoved={reorder.justMoved}
            section={section}
            total={reorder.total}
          />
        )}

        <div className="min-w-0 flex-1 md:min-w-60">
          {/*
            The photo is *inside* the link (phase 12A): 1y's card is tapped on its top
            row — "Tryk for at rette" — so the frame is part of the target rather than
            a dead 60 px beside it, and the link keeps its one name, the dish's. A grid
            of two columns: the frame in the first, spanning both rows; the name row
            and the line beneath it in the second, which may shrink to nothing — the
            frame may not. Deliberately no wrapper around the two text rows: the
            suites read a row's name as the first span inside a span of this link.
          */}
          <Link
            className="min-h-tap grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 md:gap-x-4"
            href={href}
          >
            <DishThumbnail soldOut={availability.soldOut} thumbnail={thumbnail} />
            <span className="flex flex-wrap items-center gap-2">
              {/*
                `wrap-anywhere` (phase 12A): a name is up to 200 characters and may be one
                unbroken word, and the card is 343 px wide. `overflow-wrap: anywhere`
                rather than `break-word`, because this span is a flex item — only
                `anywhere` lets the word count as breakable when the item's minimum
                width is worked out, so the card stops growing past the screen and the
                word breaks inside it. Without it the name was the one thing on this
                screen that could make the whole page scroll sideways.
              */}
              <span className="text-ink min-w-0 font-semibold wrap-anywhere">{dish.name}</span>
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
              <span className="text-warning-ink-2 text-meta wrap-anywhere">{pending}</span>
            )}
          </Link>
        </div>

        {/*
          The price, the availability control and the label slot travel together, so a
          row that has to wrap wraps once rather than shedding them one at a time.
        */}
        {/*
          `flex-wrap` (phase 12A): the highest price the schema allows is "9.999,99 kr.",
          and beside the availability control that is wider than a 375 px card. The
          control drops under the price rather than the card growing past the screen.
        */}
        <div className="flex flex-wrap items-center gap-2 md:ml-auto md:gap-3">
          <PriceTag priceOre={dish.priceOre} pending={priceChanged} />
          <AvailabilitySwitch
            availability={availability}
            form={availabilityForm}
            dishId={dish.id}
            dishName={dish.name}
            section={section}
            version={dish.updatedAt}
          />

          {/*
            1r reserves a narrow slot for the labels beside the row — and reserves it on
            every row, labelled or not, which is what keeps the price fields of six
            dishes in one column. 1y has no room for them at all, and the editor is one
            tap away, so below `md` the slot is not there rather than empty.
          */}
          <div className="hidden w-32 shrink-0 md:block">
            {dish.labels.length === 0 ? null : (
              <ul className="flex flex-wrap gap-1">
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
        </div>
      </div>

      {/* Only a sold-out dish has something pending about it, so only a sold-out dish
          gets a second line. §7b's sentence, computed from the current hours. */}
      {availability.resetText === null ? null : (
        <div className="mt-2">
          <AvailabilityResetNote>{availability.resetText}</AvailabilityResetNote>
        </div>
      )}
    </li>
  )
}
