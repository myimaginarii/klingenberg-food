import type { IsoDate } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

/**
 * Månedens burger — the date window the public site reads.
 *
 * Design 1h/1m (the menu card) and the Forside's own section; technical plan §7d (the
 * date window). Pure: it takes the two ends of the window and an instant, and answers
 * whether the burger is shown today. Nothing here reads content, formats a page or
 * knows that React exists.
 *
 * What remains after the static rebuild is exactly the classification
 * `lib/menu/view.ts` calls. *Which* menu section the card is drawn in is a fact about
 * the menu model rather than about the window, and is stated once as
 * `BURGER_MENU_SECTION_ID` in `lib/content/types.ts` — where the validator that keeps
 * that section in the document can read the same string.
 */

/**
 * Where an instant falls relative to a burger's period.
 *
 * `unset` is kept apart from `active` even though both mean "shown": they are the same
 * answer to a different question — a burger with no period is shown *and* has nothing
 * that will ever take it down again.
 */
export type MonthlyWindowPhase = 'unset' | 'future' | 'active' | 'expired'

/**
 * Classify a window against an instant — the one place this comparison is made.
 *
 * Copenhagen-local calendar dates, inclusive at both ends (§7d). An open end is not a
 * boundary: a burger with only a start date runs until somebody changes it.
 */
export function monthlyWindowPhase(
  startsOn: IsoDate | null,
  endsOn: IsoDate | null,
  now: Date,
): MonthlyWindowPhase {
  const today = copenhagenDateOf(now)

  // Lexicographic comparison is calendar comparison for `YYYY-MM-DD`, which is why the
  // wire format is kept as the domain format (`lib/time/calendar.ts`).
  if (startsOn !== null && today < startsOn) return 'future'
  if (endsOn !== null && today > endsOn) return 'expired'
  if (startsOn === null && endsOn === null) return 'unset'

  return 'active'
}

/** Is a burger shown today, for this phase? */
export function isMonthlyWindowOpen(phase: MonthlyWindowPhase): boolean {
  return phase === 'unset' || phase === 'active'
}
