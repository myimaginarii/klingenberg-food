import { formatDanishDayMonth, formatDanishLongDate } from '@/lib/format/danish'
import { monthlyBurgerDraft } from '@/lib/schemas/specials'
import { parseIsoDate, type IsoDate } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

/**
 * Månedens burger — the administration's domain rules.
 *
 * Design 1ah (the editor), 1h/1m (the menu card), the Forside's own section; technical
 * plan §4 (`monthly_burger`), §6 (the immediate path), §7d (the date window and the
 * computed admin state), §7e item 3 (what "Vis på forsiden" actually governs).
 *
 * Pure, and deliberately the whole of the thinking on this screen. Nothing here reads a
 * database, writes a draft, formats a page or knows that React exists; the Server
 * Actions in `app/(admin)/admin/menu/maanedens-burger/` put the current row behind these
 * rules and the components render their answers.
 *
 * THIS IS NOT A GENERIC "SPECIAL CONTENT" MODULE, AND MUST NOT BECOME ONE
 *
 * `lib/menu/weekly.ts` is its sibling in shape only. Ugens ret is keyed by an ISO week
 * whose *change* blanks the form; Månedens burger is keyed by two dates that decide, at
 * read time, whether an already-published row is currently shown. Ugens ret carries two
 * cards and two sold-out columns on one row; this carries one of each. Ugens ret has
 * "Kopiér sidste uge"; this has nothing of the kind, because "the previous one" is not a
 * thing this singleton has a notion of. §0c records the same boundary from the other
 * side. What the two genuinely share — the draft column, the publish function, the §7b
 * sold-out rule, the Kladde vocabulary — is shared through `lib/publishing/*`,
 * `lib/menu/availability.ts` and the design tokens, not through an abstraction over
 * their business rules.
 *
 * THREE QUESTIONS THAT ARE NOT ONE BOOLEAN
 *
 * §7d and §7e item 3 keep three things apart, and so does this module:
 *
 *   1. **Is there a burger at all?** A published `name` (`lib/content/menu.ts` returns
 *      `null` without one — a burger without a name is not a burger).
 *   2. **Is today inside its window?** {@link monthlyWindowPhase}, a Copenhagen-local
 *      date comparison, inclusive at both ends (§7d).
 *   3. **Is it configured to have its own Forside section?** `show_on_homepage`, and
 *      that alone. It governs **the dedicated Månedens burger section** and nothing
 *      else: it never displaces one of the three featured dishes, and there is no slot
 *      arithmetic anywhere in this system. The old 1ah helper line — *"Optager en af de
 *      tre pladser under 'Tre fra menuen'"* — was withdrawn by the approved requirement
 *      change of 29 August 2026 and must not reappear; {@link MONTHLY_HOMEPAGE_HELP} is
 *      the wording that replaced it.
 *
 * Collapsing any two of them would produce an administration that cannot explain why a
 * published burger is invisible, which is exactly the sentence §7d asks it to be able to
 * say.
 *
 * `sold_out_on` IS NOT HERE
 *
 * It is the immediate path (§6): it changes the hjemmeside at once, bypasses the draft
 * entirely, and is not a field of `monthlyBurgerDraft`. It lives in
 * `./monthly-availability.ts`, and the fact that it cannot appear in any list in this
 * file is what keeps a draft from ever carrying it.
 */

// ---------------------------------------------------------------------------
// The editable row
// ---------------------------------------------------------------------------

/** The editable content of `monthly_burger`, in database casing. */
export type MonthlyBurgerValues = {
  name: string | null
  description: string | null
  price_ore: number | null
  image_id: string | null
  starts_on: IsoDate | null
  ends_on: IsoDate | null
  show_on_homepage: boolean
}

export type MonthlyField = keyof MonthlyBurgerValues

/**
 * The fields 1ah's editor owns.
 *
 * Written as an exhaustive-by-construction record so that a field added to
 * {@link MonthlyBurgerValues} has to be placed here or left out deliberately — a
 * compiler error rather than a field that silently belongs to nobody.
 *
 * **`image_id` is not in the list**, and that is a phase boundary rather than an
 * omission. 1ah draws "Billede (valgfrit)" with a "Vælg billede" button; the image
 * library is phase 10 (§0b), exactly as 1r's `FOTO` frame was a phase-10 slot rather
 * than a phase-5 gap. A field no editor owns must not be *cleared* by one either, so
 * leaving it out of this list is what stops somebody saving a price from wiping a value
 * phase 10 eventually writes.
 */
const MONTHLY_EDITOR_FIELD_SET = {
  name: true,
  description: true,
  price_ore: true,
  starts_on: true,
  ends_on: true,
  show_on_homepage: true,
} as const satisfies Partial<Record<MonthlyField, true>>

export const MONTHLY_EDITOR_FIELDS = Object.keys(
  MONTHLY_EDITOR_FIELD_SET,
) as readonly MonthlyField[]

/**
 * Every field the stored draft may carry, from the schema itself.
 *
 * `image_id` is in this list and not in the one above: a draft *may* hold one — phase 10
 * will write it — and the pending band must be able to name it. What the editor owns and
 * what the column may contain are two different questions.
 */
export const MONTHLY_DRAFT_FIELDS: readonly string[] = monthlyBurgerDraft.fields

// ---------------------------------------------------------------------------
// The delta rule — technical plan §4
// ---------------------------------------------------------------------------

/**
 * The fields a submission actually changes.
 *
 * §4 describes `draft` as holding "**only the changed fields**", and this is what keeps
 * that literally true for a form that has to submit everything it renders. A field the
 * person changed back to the published value produces no draft entry, so the Kladde
 * badge cannot announce a change the next publish will not make.
 *
 * `fields` is always {@link MONTHLY_EDITOR_FIELDS}, never "everything": that is the
 * mechanism by which this editor cannot speak for a field it does not draw.
 */
export function monthlyDraftDelta(
  submitted: Partial<MonthlyBurgerValues>,
  live: MonthlyBurgerValues,
  fields: readonly MonthlyField[] = MONTHLY_EDITOR_FIELDS,
): Partial<MonthlyBurgerValues> {
  const delta: Record<string, unknown> = {}

  for (const field of fields) {
    if (!Object.hasOwn(submitted, field)) continue
    if (submitted[field] === live[field]) continue

    delta[field] = submitted[field]
  }

  return delta as Partial<MonthlyBurgerValues>
}

/**
 * What a save should write, and what it should take back out of the draft.
 *
 * `merge` plus an explicit `clear`, never `replace`. There is one editor on this screen
 * today, so `replace` would happen to work — and that is exactly the reasoning phase 5E
 * had to undo once already (`lib/publishing/drafts.ts` records it). A `replace` claims
 * "these values *are* the draft", which stops being true the moment a second control
 * touches this row: phase 10's image picker is already scheduled to be that control, and
 * `image_id` is a field this editor deliberately does not own.
 *
 * So the save merges the delta and clears only the fields of **its own list** that no
 * longer differ from the published values. A field outside the list is never mentioned
 * in either direction and survives untouched.
 */
export type MonthlyDraftWrite = {
  readonly values: Partial<MonthlyBurgerValues>
  readonly clear: readonly string[]
}

export function monthlyDraftWrite(
  submitted: Partial<MonthlyBurgerValues>,
  live: MonthlyBurgerValues,
  fields: readonly MonthlyField[] = MONTHLY_EDITOR_FIELDS,
): MonthlyDraftWrite {
  const values = monthlyDraftDelta(submitted, live, fields)

  return {
    values,
    clear: fields.filter((field) => !Object.hasOwn(values, field)),
  }
}

// ---------------------------------------------------------------------------
// The date window — technical plan §7d
// ---------------------------------------------------------------------------

/**
 * Where today falls relative to a published burger's window.
 *
 *   * `unset`   — neither boundary is set, so there is nothing to fall outside of.
 *   * `future`  — `starts_on` has not arrived yet.
 *   * `active`  — today is inside, inclusive at both ends.
 *   * `expired` — `ends_on` has passed.
 *
 * `unset` is kept apart from `active` even though both mean "shown". They are the same
 * answer to a different question, and the administration says different things about
 * them: a burger with no period is shown *and* has nothing that will ever take it down
 * again, which is worth a sentence.
 */
export type MonthlyWindowPhase = 'unset' | 'future' | 'active' | 'expired'

/**
 * Classify a window against an instant — the one place this comparison is made.
 *
 * Copenhagen-local calendar dates, inclusive at both ends (§7d). An open end is not a
 * boundary: a burger with only a `starts_on` runs until somebody changes it.
 *
 * `lib/menu/view.ts` answers the public site's *"is it shown?"* by asking this and
 * calling {@link isMonthlyWindowOpen}, so the administration's state and the guest's
 * page cannot disagree about a boundary date. There is exactly one comparison, and it
 * is here.
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

/** Is a published burger shown today, for this phase? */
export function isMonthlyWindowOpen(phase: MonthlyWindowPhase): boolean {
  return phase === 'unset' || phase === 'active'
}

/**
 * Is the window the right way round?
 *
 * The same rule as the `monthly_burger_window_check` CHECK, stated here because a draft
 * is `jsonb` and no CHECK can see inside one — the constraint would otherwise fire
 * later, at publish, on somebody else's press of a button. A window with only one end
 * set is ordered by definition.
 */
export function isOrderedWindow(startsOn: IsoDate | null, endsOn: IsoDate | null): boolean {
  return startsOn === null || endsOn === null || startsOn <= endsOn
}

// ---------------------------------------------------------------------------
// The computed admin state — technical plan §7d
// ---------------------------------------------------------------------------

/**
 * What is true of the **published** burger right now.
 *
 * Deliberately five fields rather than one enum, because §7d's promise is that the
 * administration can explain *why* a published burger is invisible — and "it is
 * configured, and inside its window, and the Forside toggle is off" is three facts, not
 * one state. A component that received a single verdict could not say which of them to
 * put right.
 *
 * Every field describes the hjemmeside, never the draft. A pending change is a separate
 * report (see {@link describeMonthlyPending}); mixing them would make the screen claim a
 * guest can see something they cannot.
 */
export type MonthlyAdminState = {
  /** A published name — the minimum a guest can read (§7d, `lib/content/menu.ts`). */
  readonly configured: boolean
  readonly phase: MonthlyWindowPhase
  /** On `/menu` right now: configured, and inside the window. Not gated by the toggle. */
  readonly onMenu: boolean
  /** The published `show_on_homepage`. A setting, not an outcome. */
  readonly showOnHomepage: boolean
  /** The dedicated Forside section is rendered right now: `onMenu` **and** the toggle. */
  readonly onHomepage: boolean
}

export function monthlyAdminState(
  published: MonthlyBurgerValues,
  now: Date,
): MonthlyAdminState {
  const configured = published.name !== null && published.name.trim().length > 0
  const phase = monthlyWindowPhase(published.starts_on, published.ends_on, now)
  const onMenu = configured && isMonthlyWindowOpen(phase)

  return {
    configured,
    phase,
    onMenu,
    showOnHomepage: published.show_on_homepage,
    onHomepage: onMenu && published.show_on_homepage,
  }
}

/**
 * A date as the state sentence says it: "1. september", or "1. september 2027".
 *
 * The year is printed only when it is not the current Copenhagen year. §7d writes the
 * sentences without one — *"vises fra 1. september"* — because a burger is normally
 * written in the month before it runs, and the year would be noise. A window that
 * genuinely crosses into another year is the case where it stops being noise and starts
 * being the whole of the information.
 */
function stateDate(date: IsoDate, now: Date): string {
  const sameYear = parseIsoDate(date).year === parseIsoDate(copenhagenDateOf(now)).year

  return sameYear ? formatDanishDayMonth(date) : formatDanishLongDate(date)
}

/** The tone the state badge and banner are drawn in — the design's three (1aa). */
export type MonthlyStateTone = 'neutral' | 'success' | 'warning'

/**
 * The computed state, in the administration's own words — §7d.
 *
 * The three sentences §7d names are here verbatim in shape:
 * *"Offentliggjort — vises fra 1. september"*, *"Vises nu — til og med 30. september"*,
 * *"Udløbet den 30. september"*. The month is **computed from the date**, never written
 * down, so a burger in March reads correctly without anybody editing this file.
 *
 * `menu` and `homepage` are the two separate consequences, said separately, because
 * they are governed by different things: the menu card follows the window alone, and the
 * Forside section follows the window **and** `show_on_homepage` (§7d, §7e item 3).
 */
export type MonthlyStateReport = {
  /** The short badge in the screen's bar — 1ah draws "Ikke udfyldt" there. */
  readonly badge: string
  /** The state sentence, with real dates. */
  readonly sentence: string
  readonly tone: MonthlyStateTone
  /** What `/menu` shows right now. */
  readonly menu: string
  /** What the Forside shows right now, and why. */
  readonly homepage: string
}

export function describeMonthlyState(
  published: MonthlyBurgerValues,
  now: Date,
): MonthlyStateReport {
  const state = monthlyAdminState(published, now)

  if (!state.configured) {
    return {
      badge: 'Ikke udfyldt',
      // 1ah's own header pill, and the sentence that makes it actionable. The public
      // site never prints anything like this: §7d puts it here, "where somebody can act
      // on it".
      sentence: 'Ikke udfyldt — skriv navn, beskrivelse, pris og periode, og offentliggør.',
      tone: 'neutral',
      menu: 'Menusiden viser feltet som “ikke oplyst endnu”, sådan som den gør nu.',
      homepage: 'Forsiden viser intet afsnit om Månedens burger.',
    }
  }

  // `starts_on` is what puts the phase in `future`, so it is set — but the compiler is
  // told rather than assumed, so this cannot become a throw inside a render if the phase
  // rule is ever changed. An impossible case falls through to the "vises nu" branch,
  // which is a wrong sentence rather than a broken screen.
  const startsOn = published.starts_on
  if (state.phase === 'future' && startsOn !== null) {
    const from = stateDate(startsOn, now)

    return {
      badge: 'Offentliggjort',
      sentence: `Offentliggjort — vises fra ${from}`,
      tone: 'neutral',
      menu: `Vises ikke på menusiden endnu. Den kommer af sig selv ${from}.`,
      homepage: state.showOnHomepage
        ? `“Vis på forsiden” er slået til, så afsnittet på forsiden kommer også ${from}.`
        : '“Vis på forsiden” er slået fra, så burgeren får intet afsnit på forsiden.',
    }
  }

  const endsOn = published.ends_on
  if (state.phase === 'expired' && endsOn !== null) {
    const until = stateDate(endsOn, now)

    return {
      badge: 'Udløbet',
      sentence: `Udløbet den ${until}`,
      tone: 'warning',
      menu: 'Vises ikke længere på menusiden — perioden er forbi.',
      homepage: 'Forsiden viser intet afsnit om Månedens burger, uanset “Vis på forsiden”.',
    }
  }

  const sentence =
    endsOn === null
      ? 'Vises nu — der er ingen slutdato, så den bliver stående'
      : `Vises nu — til og med ${stateDate(endsOn, now)}`

  return {
    badge: 'Vises nu',
    sentence,
    tone: 'success',
    menu: 'Vises på menusiden nu.',
    homepage: state.showOnHomepage
      ? 'Vises som sit eget afsnit på forsiden nu.'
      : '“Vis på forsiden” er slået fra, så burgeren har intet afsnit på forsiden.',
  }
}

// ---------------------------------------------------------------------------
// The homepage toggle — technical plan §7e item 3
// ---------------------------------------------------------------------------

/**
 * The helper line beneath "Vis på forsiden".
 *
 * **1ah's drawn wording is withdrawn.** The frame says *"Optager en af de tre pladser
 * under 'Tre fra menuen'"*, and the approved requirement change of 29 August 2026
 * removed the behaviour it describes: the Forside gained a **dedicated** Månedens burger
 * section *in addition to* its three featured dishes, not instead of one of them (§7e
 * item 3, which instructs phase 6 to ship this wording rather than the frame's). The
 * approved frame is left as drawn; this is the string that ships.
 *
 * Stated once, here, because two things have to agree about it word for word: the
 * toggle's promise and what the Forside actually does. It is asserted by the unit suite,
 * and the E2E suite asserts that the withdrawn sentence appears nowhere.
 */
export const MONTHLY_HOMEPAGE_HELP =
  'Vises som sit eget afsnit på forsiden — den tager ikke en af de tre pladser under “Tre fra menuen”.'

/**
 * The menu section a guest meets Månedens burger at the end of — design 1h.
 *
 * The one placement fixed by the approved design rather than by data. It is **not** a
 * category the burger belongs to: `monthly_burger` has no `category_id` and no row in
 * `menu_categories` (§4), and `mayHoldDishes` refuses to let a dish be created in or
 * moved to "Månedens burger" for that reason. This is only where the card is drawn.
 *
 * Stated once, because two screens have to agree about it: the public menu section
 * renders the card here, and the administration puts the way to its editor in the same
 * place, so a person looks for it where they last saw it.
 */
export const MONTHLY_BURGER_MENU_SECTION_SLUG = 'burgere'

/** The window's own helper line — 1ah's, unchanged, because the behaviour is unchanged. */
export const MONTHLY_WINDOW_HELP =
  'Uden for perioden forsvinder burgeren fra menuen og forsiden af sig selv — ingen skal huske at fjerne den.'

// ---------------------------------------------------------------------------
// Kladde states — design 1aa, the phase-5 vocabulary
// ---------------------------------------------------------------------------

/**
 * The Danish name of each editable field, for the pending sentence.
 *
 * Menu vocabulary, so it lives beside the menu rules rather than inside a component;
 * that also makes the wording assertable. Keyed by every field the *draft* may hold, so
 * a field added to `monthlyBurgerDraft` without a name here is a type error rather than
 * a band that silently says "Ændringer".
 */
const FIELD_NAMES: Record<MonthlyField, string> = {
  name: 'navn',
  description: 'beskrivelse',
  price_ore: 'pris',
  image_id: 'billede',
  starts_on: 'startdato',
  ends_on: 'slutdato',
  show_on_homepage: 'visning på forsiden',
}

/** A capitalised sentence, the way the design writes one. */
function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase('da-DK') + text.slice(1)
}

/**
 * What the pending band should say, or `null` when nothing is waiting.
 *
 * Derived entirely from the stored draft — the fields it actually changes — so the
 * message cannot claim a change the database does not hold. Nothing about pending state
 * is remembered anywhere in the browser.
 *
 * The same shape as phase 5's `describePendingChange` and phase 6A's
 * `describeWeeklyPending`, so the three screens sound like one administration.
 */
export function describeMonthlyPending(changedFields: readonly string[]): string | null {
  const changed = new Set(changedFields)
  const named = (MONTHLY_DRAFT_FIELDS as MonthlyField[])
    .filter((field) => changed.has(field))
    .map((field) => FIELD_NAMES[field])

  if (named.length === 0) return null
  if (named.length === 1) return sentenceCase(`ny ${named[0] ?? ''} afventer offentliggørelse`)

  const last = named[named.length - 1] ?? ''

  return sentenceCase(
    `nye ${named.slice(0, -1).join(', ')} og ${last} afventer offentliggørelse`,
  )
}

// ---------------------------------------------------------------------------
// Publish-time warnings — technical plan §7d
// ---------------------------------------------------------------------------

/**
 * What publishing this draft would mean for the hjemmeside.
 *
 *   * `expired`   — §7d: *"Publishing with `ends_on` already in the past warns first"*.
 *                   Nothing is refused and no date is changed; a person is asked.
 *   * `scheduled` — §7d: a future `starts_on` *"is allowed and the confirmation states
 *                   exactly when it will appear — that is the intended workflow"*. So it
 *                   is not a warning and never a refusal; it is a fact the screen has to
 *                   be able to state, with the date in it.
 *   * `immediate` — it will be on the hjemmeside as soon as it is published.
 *   * `incomplete`— there is no name, so publishing takes it *off* the menu rather than
 *                   putting it on. Worth saying, and not worth blocking: clearing the
 *                   burger at the end of a month is a legitimate thing to publish.
 *
 * Computed from the values the publish would produce — the live row with the draft
 * merged over it — because that is what a guest will read afterwards. It never mutates a
 * date: §7d's warnings are questions, not corrections.
 */
export type MonthlyPublishOutlook = 'expired' | 'scheduled' | 'immediate' | 'incomplete'

export function monthlyPublishOutlook(
  pending: MonthlyBurgerValues,
  now: Date,
): MonthlyPublishOutlook {
  if (pending.name === null || pending.name.trim().length === 0) return 'incomplete'

  const phase = monthlyWindowPhase(pending.starts_on, pending.ends_on, now)

  if (phase === 'expired') return 'expired'
  if (phase === 'future') return 'scheduled'

  return 'immediate'
}

/** §7d's own warning, word for word, with the period it is about. */
export function describeExpiredPublishWarning(
  pending: MonthlyBurgerValues,
  now: Date,
): string {
  const until = pending.ends_on === null ? null : stateDate(pending.ends_on, now)

  return until === null
    ? 'Denne periode er allerede forbi — den vises ikke på hjemmesiden.'
    : `Denne periode er allerede forbi — perioden sluttede ${until}, så burgeren vises ikke på hjemmesiden.`
}

/** What a publish that scheduled something says afterwards, with the date in it (§7d). */
export function describeScheduledPublish(startsOn: IsoDate | null, now: Date): string {
  return startsOn === null
    ? 'Månedens burger er offentliggjort.'
    : `Månedens burger er offentliggjort — den vises fra ${stateDate(startsOn, now)}.`
}
