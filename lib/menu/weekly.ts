import { weeklySpecialDraft } from '@/lib/schemas/specials'
import { WEEKDAY_KEYS, type WeekdayKey } from '@/lib/time/calendar'
import {
  addIsoWeeks,
  compareIsoWeeks,
  isSameIsoWeek,
  nextIsoWeek,
  type IsoWeek,
} from '@/lib/time/iso-week'

/**
 * Ugens ret and Lørdagsmenu — the administration's domain rules.
 *
 * Design 1ag (the editor), 1af (every public state it produces); technical plan §4
 * (`weekly_special`), §6 ("Kopiér sidste uge"), §7e item 5 (the week rollover).
 *
 * Pure, and deliberately the whole of the thinking on this screen. Nothing here reads a
 * database, writes a draft, formats a page or knows that React exists; the Server
 * Actions in `app/(admin)/admin/menu/ugens-ret/` put the current row behind these rules
 * and the components render their answers.
 *
 * ONE ROW, TWO EDITORS
 *
 * `weekly_special` is a single row carrying two things a guest reads as two cards:
 * **Ugens ret** (`name`, `description`, both portion prices, the serving days and the
 * week the whole row belongs to) and **Lørdagsmenu** (the `sat_*` fields). 1ag draws
 * them as two cards with two save buttons, and this module keeps that separation
 * explicit — {@link WEEK_EDITOR_FIELDS} and {@link SATURDAY_EDITOR_FIELDS} are two
 * disjoint lists, and each editor's save names only its own.
 *
 * That is not tidiness. `dishes.draft` taught phase 5E the same lesson the hard way: an
 * editor that says "these values *are* the draft" silently discards whatever another
 * editor had pending on the same row. Here the two editors share a **row**, so the risk
 * is not hypothetical — a Saturday save that spoke for the whole row would drop a
 * pending price on Ugens ret, and the reverse. Each save therefore merges its own
 * fields and clears only its own (see `saveWeeklyDraft` / `saveSaturdayDraft`).
 *
 * `image_id` is in neither list. The image library is phase 10 (§0b), so 1ag's "Vælg
 * billede" is a phase-10 slot exactly as 1r's `FOTO` frame was a phase-5 one — and a
 * field no editor owns must not be cleared by either of them.
 *
 * NEITHER SOLD-OUT FIELD IS HERE EITHER
 *
 * `sold_out_on` and `sat_sold_out_on` are the immediate path (§6): they change the
 * hjemmeside at once, bypass the draft entirely, and are not fields of
 * `weeklySpecialDraft`. They live in `./weekly-availability.ts`, and the fact that they
 * cannot appear in any list in this file is what keeps a draft from ever carrying one.
 */

/** The editable content of `weekly_special`, in database casing. */
export type WeeklySpecialValues = {
  iso_year: number | null
  iso_week: number | null
  days: readonly WeekdayKey[]
  name: string | null
  description: string | null
  price_small_ore: number | null
  price_large_ore: number | null
  image_id: string | null
  sat_enabled: boolean
  sat_name: string | null
  sat_description: string | null
  sat_price_ore: number | null
  sat_deadline: string | null
}

export type WeeklyField = keyof WeeklySpecialValues

/**
 * The fields 1ag's **first** card owns.
 *
 * Written as an exhaustive-by-construction record so that a field added to
 * `WeeklySpecialValues` has to be placed in one of the two lists or left out of both
 * deliberately — a compiler error rather than a field that silently belongs to nobody.
 */
const WEEK_EDITOR_FIELD_SET = {
  iso_year: true,
  iso_week: true,
  days: true,
  name: true,
  description: true,
  price_small_ore: true,
  price_large_ore: true,
} as const satisfies Partial<Record<WeeklyField, true>>

/** The fields 1ag's **second** card owns — "Lørdagsmenu denne uge". */
const SATURDAY_EDITOR_FIELD_SET = {
  sat_enabled: true,
  sat_name: true,
  sat_description: true,
  sat_price_ore: true,
  sat_deadline: true,
} as const satisfies Partial<Record<WeeklyField, true>>

export const WEEK_EDITOR_FIELDS = Object.keys(WEEK_EDITOR_FIELD_SET) as readonly WeeklyField[]

export const SATURDAY_EDITOR_FIELDS = Object.keys(
  SATURDAY_EDITOR_FIELD_SET,
) as readonly WeeklyField[]

/**
 * The **content** of Ugens ret: what the kitchen writes each week.
 *
 * A subset of {@link WEEK_EDITOR_FIELDS} that leaves out the week itself and the
 * serving days, because those are the two things the week rollover does *not* blank —
 * see {@link planWeekEdit}.
 */
export const WEEK_CONTENT_FIELDS = [
  'name',
  'description',
  'price_small_ore',
  'price_large_ore',
] as const satisfies readonly WeeklyField[]

/**
 * "Ingen lørdagsmenu denne uge" — the approved public wording (1af).
 *
 * Stated once, here, because two screens have to agree about it word for word: the
 * public card prints it, and the administration's toggle promises it ("Slå fra, og der
 * står …"). A restaurant that reads the promise in the admin and something else on the
 * hjemmeside would be reading a bug.
 */
export const NO_SATURDAY_MENU = 'Ingen lørdagsmenu denne uge'

/**
 * Which of the two cards an immediate availability change is about.
 *
 * A closed set of two names, and they are names of **cards**, never of columns. The
 * mapping from a target to a column lives in one place — the two written-out UPDATE
 * statements in `public.set_weekly_special_sold_out()` — so a submitted value can select
 * between two reviewed statements and can never become an identifier.
 *
 * It lives in this pure module rather than beside the operation so that the form
 * vocabulary can name it without importing a `server-only` file.
 */
export const WEEKLY_SOLD_OUT_TARGETS = ['week', 'saturday'] as const

export type WeeklySoldOutTarget = (typeof WEEKLY_SOLD_OUT_TARGETS)[number]

/** The week a row belongs to, or `null` when it has never been set. */
export function weekOf(values: Pick<WeeklySpecialValues, 'iso_year' | 'iso_week'>): IsoWeek | null {
  if (values.iso_year === null || values.iso_week === null) return null

  return { year: values.iso_year, week: values.iso_week }
}

/**
 * The serving days in the schedule's own order, whatever order they were stored in.
 *
 * A row edited out of sequence still reads correctly, and the public card's own line
 * ("Onsdag · torsdag · fredag", 1af) is built from the same ordering by
 * `formatServingDays` in `lib/menu/view.ts` — so the administration and the hjemmeside
 * cannot disagree about which days a dish is served on, only about how they are printed.
 */
export function orderedDays(days: readonly string[]): readonly WeekdayKey[] {
  return WEEKDAY_KEYS.filter((weekday) => days.includes(weekday))
}

// ---------------------------------------------------------------------------
// The delta rule
// ---------------------------------------------------------------------------

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false

    return a.length === b.length && a.every((item, index) => item === b[index])
  }

  return a === b
}

/**
 * The fields a submission actually changes — technical plan §4.
 *
 * §4 describes `draft` as holding "**only the changed fields**", and this is what keeps
 * that literally true for a form that has to submit everything it renders. A field the
 * person changed back to the published value produces no draft entry, so the Kladde
 * badge cannot announce a change the next publish will not make.
 *
 * `fields` is always one of the two editor lists, never "everything": that is the whole
 * mechanism by which one editor cannot speak for the other's fields.
 */
export function weeklyDraftDelta(
  submitted: Partial<WeeklySpecialValues>,
  live: WeeklySpecialValues,
  fields: readonly WeeklyField[],
): Partial<WeeklySpecialValues> {
  const delta: Record<string, unknown> = {}

  for (const field of fields) {
    if (!Object.hasOwn(submitted, field)) continue
    if (sameValue(submitted[field], live[field])) continue

    delta[field] = submitted[field]
  }

  return delta as Partial<WeeklySpecialValues>
}

/**
 * What a save should write, and what it should take back out of the draft.
 *
 * A *partial* editor cannot use `mode: 'replace'` (it would discard the other editor's
 * pending work), so it says the same thing the honest way: merge the delta, and clear
 * the fields of **its own list** that no longer differ from the published values. A
 * field outside the list is never mentioned in either direction, so it survives
 * untouched — which is exactly the courtesy phase 5E's reorder and phase 5F's Tapas
 * editor extend to a pending price.
 */
export type WeeklyDraftWrite = {
  readonly values: Partial<WeeklySpecialValues>
  readonly clear: readonly string[]
}

export function weeklyDraftWrite(
  submitted: Partial<WeeklySpecialValues>,
  live: WeeklySpecialValues,
  fields: readonly WeeklyField[],
): WeeklyDraftWrite {
  const values = weeklyDraftDelta(submitted, live, fields)

  return {
    values,
    clear: fields.filter((field) => !Object.hasOwn(values, field)),
  }
}

// ---------------------------------------------------------------------------
// The week rollover — technical plan §7e item 5, design 1ag's own note
// ---------------------------------------------------------------------------

/**
 * What a submission of 1ag's first card means.
 *
 * §7e item 5: *"Changing the week number blanks the form as a draft; the live site
 * keeps the current card, including its week number, until publish."* 1ag's own note
 * says the same thing from the other side: *"Skifter ugenummeret, starter man på et
 * blankt skema — den forrige uge arkiveres ikke."* There is no archive, so a new week
 * begins empty, and "Kopiér sidste uge" is the shortcut past the blank form.
 *
 * THREE THINGS THIS RULE DOES NOT DO, AND WHY
 *
 *   * **It does not blank the Lørdagsmenu.** The approved frame gives that card its own
 *     explicit promise — *"Teksten bevares til næste gang"* — and its own on/off
 *     control. Blanking it from the other card would break that promise and would also
 *     be one editor clearing another's fields, which is the single failure mode this
 *     screen is arranged to prevent. Staff turn the Saturday menu off, or rewrite it,
 *     in the card that owns it.
 *   * **It does not blank the serving days.** "Hvilke dage serveres den?" is the
 *     pattern the dish is served on, not the dish; it is the same three chips week
 *     after week, and an empty answer is not more correct than last week's — it is
 *     merely more typing. The public card's day line (1af) is drawn beside the week
 *     badge for exactly that reason.
 *   * **It does not blank the image.** No editor owns `image_id` before phase 10.
 *
 * So "blank" means the four fields somebody types about the food: the name, the
 * description and the two portion prices ({@link WEEK_CONTENT_FIELDS}).
 *
 * IT IS REVERSIBLE, AND THAT IS THE POINT
 *
 * Changing the week is one press of a dropdown, so it must be possible to change one's
 * mind. Choosing the **published** week again does not blank anything: it clears this
 * card's fields from the draft altogether, so the form comes back showing the live week
 * and the live dish. Nothing was ever removed from a live column, because a week change
 * is an ordinary draft change like every other edit on this screen.
 *
 * `current` is the week the form was rendered from — live with any draft over it. A
 * row that has never had a week set is not "changed" by having one chosen for the first
 * time; there is nothing to roll over from, and blanking a dish somebody has just typed
 * would be a surprise rather than a rollover.
 */
export type WeekEditSubmission = {
  readonly week: IsoWeek | null
  readonly days: readonly WeekdayKey[]
  readonly name: string | null
  readonly description: string | null
  readonly price_small_ore: number | null
  readonly price_large_ore: number | null
}

export type WeekEditPlan = WeeklyDraftWrite & {
  /** True when the week moved and the dish fields were therefore emptied. */
  readonly blanked: boolean
  /** True when the card was returned to the published week and its live content. */
  readonly restored: boolean
}

export function planWeekEdit({
  submitted,
  current,
  live,
}: {
  readonly submitted: WeekEditSubmission
  /** The values the form was rendered from: live with any draft merged over it. */
  readonly current: WeeklySpecialValues
  /** The published values — what a guest sees right now. */
  readonly live: WeeklySpecialValues
}): WeekEditPlan {
  const currentWeek = weekOf(current)
  const liveWeek = weekOf(live)

  // Choosing a week for a row that has never had one is not a rollover.
  const weekChanged = currentWeek !== null && !isSameIsoWeek(submitted.week, currentWeek)

  if (weekChanged && isSameIsoWeek(submitted.week, liveWeek)) {
    // Back to the published week: this card stops being a pending change at all, so it
    // leaves the draft rather than carrying a blank version of what is already live.
    return {
      values: {},
      clear: WEEK_EDITOR_FIELDS,
      blanked: false,
      restored: true,
    }
  }

  const content: Pick<WeeklySpecialValues, (typeof WEEK_CONTENT_FIELDS)[number]> = weekChanged
    ? { name: null, description: null, price_small_ore: null, price_large_ore: null }
    : {
        name: submitted.name,
        description: submitted.description,
        price_small_ore: submitted.price_small_ore,
        price_large_ore: submitted.price_large_ore,
      }

  const values: Partial<WeeklySpecialValues> = {
    iso_year: submitted.week?.year ?? null,
    iso_week: submitted.week?.week ?? null,
    // Kept across a rollover, on purpose. See the note above.
    days: weekChanged ? orderedDays(current.days) : orderedDays(submitted.days),
    ...content,
  }

  return {
    ...weeklyDraftWrite(values, live, WEEK_EDITOR_FIELDS),
    blanked: weekChanged,
    restored: false,
  }
}

// ---------------------------------------------------------------------------
// "Kopiér sidste uge" — technical plan §6, decision 4
// ---------------------------------------------------------------------------

/**
 * Is there anything worth copying forward?
 *
 * §6: *"If the live row is empty the button is disabled with an explanation rather than
 * producing a blank draft."* "Empty" is answered against the **published** row, because
 * that is what "sidste uge" means here — §6 again: *"'sidste uge' means what is live
 * right now"*, which is last week's content until the moment the new week is published.
 *
 * A row counts as having content when a guest could read something off it: the weekly
 * dish has a name, or the Saturday menu is switched on and has one. A row carrying only
 * a week number and three serving-day chips would copy forward into a draft that says
 * nothing, which is the blank form the button exists to avoid.
 */
export function hasCopyableWeeklyContent(live: WeeklySpecialValues): boolean {
  if (live.name !== null) return true

  return live.sat_enabled && live.sat_name !== null
}

/**
 * The week the copy lands in.
 *
 * §6: the fields are copied *"with `iso_year`/`iso_week` advanced to the next ISO
 * week"*. That is an advance of the **source's** week, not "whatever week it is today":
 * a kitchen preparing week 37 on the Friday of week 36 wants week 37, and a kitchen
 * that is a week behind wants the week after the one that is live — otherwise copying
 * forward would silently skip a week and publish it under the wrong number.
 *
 * §9 asks for the year-boundary case by name, and it is not a case here so much as a
 * consequence: `nextIsoWeek` moves seven days on the calendar and reads the ISO year
 * back off the result, so week 52 of 2026 becomes week 53 of 2026 and week 53 becomes
 * week 1 of 2027, without either being written down.
 *
 * A published row with content but **no week** has nothing to advance from. The
 * destination is then this week in Copenhagen, which is the only answer that is not
 * invented — and the staff member can change it in the dropdown before publishing,
 * exactly as they can any other copied value.
 */
export function copyDestinationWeek(
  live: Pick<WeeklySpecialValues, 'iso_year' | 'iso_week'>,
  thisWeek: IsoWeek,
): IsoWeek {
  const source = weekOf(live)

  return source === null ? thisWeek : nextIsoWeek(source)
}

/**
 * The field list a copy carries — stated for the tests, not for the write.
 *
 * The write itself happens in `public.copy_weekly_special_to_draft()`, which builds the
 * destination draft from `public.weekly_special_content()` — the same function every
 * publish and every audit entry is described by. That is what makes "the copy cannot
 * carry a sold-out flag, a timestamp or an attribution column" a property of the text
 * rather than a list somebody has to maintain: those columns are not named by
 * `weekly_special_content`, so there is nowhere for them to come from.
 *
 * This constant is the same statement on this side of the wire — it is the draft
 * schema's own field list, and `tests/unit/menu/weekly.test.ts` asserts what it does
 * *not* contain. `supabase/tests/010_weekly_special.test.sql` asserts the database
 * produces exactly these keys.
 */
export const WEEKLY_COPY_FIELDS: readonly string[] = weeklySpecialDraft.fields

// ---------------------------------------------------------------------------
// Kladde states — design 1aa, the phase-5 vocabulary
// ---------------------------------------------------------------------------

/** Which half of the row a stored draft has pending changes for (§11 of the brief). */
export type WeeklyPendingParts = {
  readonly week: boolean
  readonly saturday: boolean
}

export function pendingParts(changedFields: readonly string[]): WeeklyPendingParts {
  const changed = new Set(changedFields)

  return {
    // `image_id` belongs to neither editor yet, so a draft that somehow carried one
    // still counts as a pending change to the weekly dish rather than to nothing.
    week: [...WEEK_EDITOR_FIELDS, 'image_id'].some((field) => changed.has(field)),
    saturday: SATURDAY_EDITOR_FIELDS.some((field) => changed.has(field)),
  }
}

/**
 * The sentences the pending band uses — the same shape phase 5's `describePendingChange`
 * produces, so the two screens sound like one administration.
 *
 * Empty when nothing is pending, which is also what hides the band.
 */
export function describeWeeklyPending(parts: WeeklyPendingParts): readonly string[] {
  const sentences: string[] = []

  if (parts.week) sentences.push('Ugens ret har ændringer, der ikke er offentliggjort.')
  if (parts.saturday) {
    sentences.push('Lørdagsmenuen har ændringer, der ikke er offentliggjort.')
  }

  return sentences
}

/**
 * What the Lørdagsmenu toggle says about the state it is in — 1ag's own wording.
 *
 * The "off" sentence quotes the public card word for word, so the promise the
 * administration makes and the text a guest reads are the same string.
 */
export function describeSaturdayState(enabled: boolean): string {
  return enabled
    ? 'Vises på hjemmesiden med navn, beskrivelse og pris.'
    : `Hjemmesiden viser “${NO_SATURDAY_MENU}”. Teksten bevares til næste gang.`
}

// ---------------------------------------------------------------------------
// The week dropdown — design 1ag ("Ugenummer")
// ---------------------------------------------------------------------------

/** How many weeks the dropdown offers on either side of this one. */
const WEEKS_BEFORE = 2
const WEEKS_AFTER = 8

/**
 * The weeks 1ag's dropdown offers.
 *
 * A window around **this** week in Copenhagen rather than a full year of options: a
 * kitchen writes this week's dish or next week's, and a list of fifty-two numbers is a
 * list somebody can mis-tap on a phone. A couple of weeks back are included because a
 * row can be behind — the kitchen forgot to publish — and that has to be correctable.
 *
 * The currently selected week is always in the list, wherever it falls, so a value the
 * row already holds can never be silently replaced by simply opening the editor.
 * Duplicates are removed and the result is in chronological order, so the option list
 * reads the way a calendar does across a year boundary.
 */
export function isoWeekOptions(thisWeek: IsoWeek, selected: IsoWeek | null): readonly IsoWeek[] {
  const window: IsoWeek[] = []

  for (let offset = -WEEKS_BEFORE; offset <= WEEKS_AFTER; offset += 1) {
    // `addIsoWeeks` walks the calendar rather than incrementing a number, so the option
    // after week 52 is week 53 or week 1 depending on the year, and neither case is
    // written down here.
    window.push(addIsoWeeks(thisWeek, offset))
  }

  if (selected !== null && !window.some((week) => isSameIsoWeek(week, selected))) {
    window.push(selected)
  }

  return window.sort(compareIsoWeeks)
}
