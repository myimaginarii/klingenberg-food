import { MAX_OPENING_SEARCH_DAYS, findFirstOpeningFrom } from '@/lib/hours/engine'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { type IsoDate, addDays } from '@/lib/time/calendar'
import { assertValidInstant } from '@/lib/time/copenhagen'

/**
 * "Udsolgt i dag" and its automatic reset — technical plan §7b, decision 2.
 *
 * **The rule.** An item marked sold out stays sold out for the whole Copenhagen
 * calendar date it was marked on, and becomes available again at the opening instant
 * of the first opening day *strictly after* that date. Closed days are skipped, and
 * published one-off overrides are honoured in both directions — one that closes a day
 * skips it, one that opens a normally closed day makes it the reset day.
 *
 * The rule keys off **the date it was marked**, not "the next opening moment". That is
 * the whole point of the word *i dag*: a dish sold out at 11:00 during prep is sold out
 * for today's service too, not for the two hours until the doors open.
 *
 * **Nothing is stored.** There is no `sold_out_expires_at` column and no reset job (§4).
 * A stored instant would go stale the moment the opening hours or an override changed;
 * deriving it means an override entered after the toggle is honoured for free. The cost
 * is that this function must be the single source of that truth — which is why the
 * public menu and the reset both call it, and why it is pure.
 */

/** What a caller needs to know, and nothing it would have to compute again. */
export type SoldOutResolution = {
  /** Whether the item is sold out at `now`. */
  soldOut: boolean
  /**
   * The instant the marking resets: the opening of the first opening day after the
   * date it was marked.
   *
   * `null` means no opening day was found inside the {@link MAX_OPENING_SEARCH_DAYS}
   * window, so the item will **not** clear on its own and needs a manual toggle — the
   * case the design words as "Nulstilles ikke automatisk — I har ingen åbningsdage
   * planlagt". It is also `null` when nothing is marked at all.
   *
   * The instant is reported whether or not it has passed, so a caller can say both
   * "clears at" and "cleared at" without asking twice.
   */
  clearsAt: Date | null
}

/**
 * Resolve the sold-out state of one item.
 *
 * @param soldOutOn The Copenhagen-local date the item was marked (`dishes.sold_out_on`
 *   and the two `weekly_special` / `monthly_burger` equivalents). `null` = available.
 * @param schedule The published weekly opening hours.
 * @param overrides One-off opening-hours overrides; drafts are ignored by the engine.
 * @param now The instant to judge against.
 */
export function resolveSoldOut(
  soldOutOn: IsoDate | null,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
  now: Date,
): SoldOutResolution {
  assertValidInstant(now)

  if (soldOutOn === null) return { soldOut: false, clearsAt: null }

  // Strictly after the date it was marked: the search starts the following day, so
  // today's own opening can never clear it.
  const firstCandidateDay = addDays(soldOutOn, 1)

  const opening = findFirstOpeningFrom(
    firstCandidateDay,
    schedule,
    overrides,
    MAX_OPENING_SEARCH_DAYS,
  )

  if (opening === null) return { soldOut: true, clearsAt: null }

  return {
    soldOut: now.getTime() < opening.opensAt.getTime(),
    clearsAt: opening.opensAt,
  }
}
