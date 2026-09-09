import type { MonthlyBurgerView } from '@/lib/menu/view'

import { SiteImage } from '../SiteImage'
import { DishLabelBadge, SoldOutBadge } from './DishBadge'
import { DishPrice } from './DishPrice'

/**
 * Månedens burger — design 1h and 1m.
 *
 * Two states, both approved and both drawn in the frames:
 *
 *  * **Not filled in.** A card that says so in the design's own words. This is the
 *    current state: 1ab lists "Månedens burger — navn, tekst, pris, periode" among the
 *    things the restaurant has not supplied, so nothing is invented here.
 *  * **Filled in and inside its window.** An ordinary card carrying the "Skiftende"
 *    chip. Whether today falls inside the window is decided by `buildMenuView` from the
 *    published dates (§7d) — a read-time comparison, never a scheduled job.
 *
 * The editor that fills it in is phase 6; its photograph (phase 10C-2) is the row's
 * library image in the same 4:3 / 1:1 frame the dish cards use.
 *
 * The empty state draws **no image frame at all**. It used to reserve the hatched box
 * the filled card's photograph occupies, which read as a burger card whose picture had
 * failed to load rather than as a slot the kitchen has not filled in. The text takes
 * the card's width instead, the same way `WeeklySpecial` handles a week with no
 * photograph (1af, "Uden foto flytter teksten helt ud til kanten").
 *
 * It sits on the site's ordinary card surface — `bg-surface`, the solid `border-border`
 * rule, the large card radius — the same surface as the burger cards it follows on the
 * menu and the news empty state on the Forside's beige band. The first version drew a
 * dashed rule on the form-field background, which is the vocabulary of an unfilled
 * input and made a public page look like an administration screen; the sentence and
 * the "Skiftende" chip say "nothing yet" clearly enough on a plain card. The chip sits
 * in the badge row under the text, where every dish card keeps its labels, rather than
 * beside the heading.
 *
 * The empty card is its own export because the Forside draws the same card in its own
 * Månedens burger section when there is nothing to show. One sentence, one surface, two
 * places: the menu page and the Forside can never disagree about what "no burger" says.
 * The heading level is the caller's, because on the menu the card sits under the
 * "Burgere" `<h2>` and on the Forside it is the section's own heading.
 */
const EMPTY_STATE_TEXT =
  'Der er ingen månedens burger lige nu. Når der er en, står den her med navn, beskrivelse og pris.'

export function MonthlyBurgerEmptyCard({
  heading: Heading = 'h3',
  headingId,
}: {
  heading?: 'h2' | 'h3'
  headingId?: string
}) {
  return (
    <article className="bg-surface border-border rounded-card-lg border p-3.5 md:p-4">
      <Heading id={headingId} className="font-display text-card">
        Månedens burger
      </Heading>
      <p className="text-ink-2 text-support mt-1.5 max-w-[66ch]">{EMPTY_STATE_TEXT}</p>
      <p className="mt-2 flex flex-wrap gap-2">
        <span className="bg-warning-surface text-warning-ink rounded-badge px-2.5 py-1.5 text-chip leading-none font-medium">
          Skiftende
        </span>
      </p>
    </article>
  )
}

export function MonthlyBurgerCard({ burger }: { burger: MonthlyBurgerView | null }) {
  if (burger === null) return <MonthlyBurgerEmptyCard />

  return (
    <article
      className={`rounded-card md:rounded-card-lg border-border flex gap-3 border p-2.5 md:gap-5 md:p-4 ${
        burger.soldOut ? 'bg-surface-muted' : 'bg-surface'
      }`}
    >
      <SiteImage
        image={burger.image}
        ratio="square"
        sizes="dishCard"
        placeholder={{ label: 'Månedens burger' }}
        className={`w-24 shrink-0 self-start rounded-[0.5rem] md:aspect-card md:w-[9.375rem] md:self-center ${
          burger.soldOut ? 'opacity-70 grayscale' : ''
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-card">{burger.name}</h3>
          <DishPrice priceOre={burger.priceOre} soldOut={burger.soldOut} />
        </div>
        {burger.description ? (
          <p className="text-ink-2 text-support mt-1.5 max-w-[66ch]">
            {burger.description}
          </p>
        ) : null}
        <p className="mt-2 flex flex-wrap gap-2">
          {burger.soldOut ? <SoldOutBadge /> : null}
          <DishLabelBadge label="Månedens burger" />
        </p>
      </div>
    </article>
  )
}
