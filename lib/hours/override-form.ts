import { isIsoDate, type IsoDate, type IsoTime } from '@/lib/time/calendar'

import { isClockTime } from './clock-choices'
import { formatTimeRange, formatWeekdayDate } from './format'
import type { OverrideKind, OverrideStatus } from './types'

/**
 * The one-off opening-hours override's domain — design 1t (lower card, "ENKELT ÆNDRING");
 * technical plan §4, §5, §6, §7b, §7e items 6 and 7.
 *
 * Everything the override card has to *decide* lives here, as pure functions with no
 * React, no Supabase and no clock: what the fields show, what somebody chose means, which
 * field a refusal belongs to, what is different from what is published, and what state a
 * date is in. The screen renders answers; it computes none, and it holds no query.
 *
 * WHAT THIS MODULE IS **NOT**
 *
 * It is not `./weekly-form.ts` with a date bolted on, and the two share no rule. The
 * recurring editor answers a question about **seven weekdays** and names its refusals by
 * weekday ("om onsdagen"); this one answers a question about **one calendar date** and
 * names its refusals by the date. What they genuinely share is the *control* — 1t's
 * quarter-hour dropdown, which is `./clock-choices.ts` and is imported by both. A shared
 * `<select>` is not a shared editor.
 *
 * It is also not a second opening-hours engine. Whether the restaurant is open, when it
 * opens next and how a day is worded are `./engine.ts`, `./schedule.ts` and `./format.ts`
 * — the phase-2 modules that have honoured a published override in both directions since
 * before this screen existed. This module calls `./format.ts` for its Danish wording and
 * neither of the other two, and it converts no civil value into an instant.
 *
 * THE TWO KINDS ARE THE MODEL'S OWN
 *
 * `overrides_kind_check` allows exactly `'closed'` and `'custom'`, and
 * `overrides_shape_check` states what each one may carry: closed with **no** times, or
 * custom with **both** and `opens_at < closes_at`. There is no third kind here because
 * there is no third kind in the database — no split service, no holiday name, no label,
 * and no overnight range, which the same `<` is what forbids (and which the phase-2 engine
 * relies on: `openDay()` says in as many words that opening hours never cross midnight).
 *
 * DATES ARE COPENHAGEN CIVIL DATES, AND THE BROWSER IS NOT ASKED
 *
 * A `YYYY-MM-DD` from `lib/time/calendar.ts`, which contains no timezone and no `Intl`
 * call, compared against a *today* the caller resolves with `copenhagenDateOf(new Date())`
 * on the server. Nothing here reads a clock, so a browser in another timezone cannot move
 * an override to another day — and `today` is a parameter precisely so that it cannot be
 * taken from ambient state by accident.
 */

// ---------------------------------------------------------------------------
// What the card holds
// ---------------------------------------------------------------------------

/** 1t's lower card, exactly as the form carries it. */
export type OverrideFormValues = {
  /** `YYYY-MM-DD`, or `''` when nothing has been chosen yet. */
  readonly date: string
  /** 1t's two chips: "Lukket en bestemt dato" / "Andre tider en enkelt dag". */
  readonly kind: string
  /** `HH:MM`, or `''`. Asked for only by `custom`. */
  readonly from: string
  readonly to: string
}

/**
 * What an override *says* about a date — the three content columns and nothing else.
 *
 * Not `date`: that is the row's identity rather than its content (`date` is UNIQUE, and an
 * override moved to another date is a different override). Not `status`: that is where it
 * is in its lifecycle. And not whether this date owns the generated announcement, which
 * is a column on the *announcement* row since 8C-3A
 * (`announcement.source_override_id`) and is therefore not something an override's
 * content could carry even by accident.
 */
export type OverrideContent = {
  readonly kind: OverrideKind
  readonly opens_at: IsoTime | null
  readonly closes_at: IsoTime | null
}

/** 1t's two chips, in the frame's own words. The value is the column's own vocabulary. */
export const OVERRIDE_KIND_LABELS: Readonly<Record<OverrideKind, string>> = {
  closed: 'Lukket en bestemt dato',
  custom: 'Andre tider en enkelt dag',
}

/** The order the two chips are drawn in (1t): closed first, custom second. */
export const OVERRIDE_KINDS: readonly OverrideKind[] = ['closed', 'custom']

export function isOverrideKind(value: unknown): value is OverrideKind {
  return value === 'closed' || value === 'custom'
}

/** A date with no override yet: 1t's card as it is drawn before anything is chosen. */
export function emptyOverrideForm(date: IsoDate): OverrideFormValues {
  return { date, kind: 'closed', from: '', to: '' }
}

/**
 * A stored override as the card shows it.
 *
 * A closed override comes back with empty times because the row has none — the shape CHECK
 * requires `opens_at` and `closes_at` to be null for `kind = 'closed'`, so there is nowhere
 * for a remembered pair to live. That is the same answer `weeklyFormValues` gives a closed
 * weekday, arrived at from the same place: the model, not the editor, decides what is kept.
 */
export function overrideFormValues(date: IsoDate, content: OverrideContent): OverrideFormValues {
  return {
    date,
    kind: content.kind,
    from: content.opens_at ?? '',
    to: content.closes_at ?? '',
  }
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/** What can be wrong with the card. */
export type OverrideProblem =
  /** No date was chosen at all. */
  | 'dato_mangler'
  /** Not a `YYYY-MM-DD` date that exists in the calendar — 31 February, say. */
  | 'dato_ugyldig'
  /**
   * A date that has already been.
   *
   * §7e item 7: *"The date must be today or later."* It is the plan's rule rather than
   * this module's, and the database agrees from the other side: `overrides_select_public`
   * hands a guest only rows dated today or later, so an override on a past date is a row
   * nothing could ever read. Today itself is allowed — 1q's "Ret kun i dag" is the case
   * the whole feature is named after.
   */
  | 'dato_fortid'
  /** Neither of the model's two kinds. Unreachable from the drawn radio group. */
  | 'art_ugyldig'
  /** `custom`, and no opening time was chosen. */
  | 'fra_mangler'
  /** `custom`, and no closing time was chosen. */
  | 'til_mangler'
  | 'fra_ugyldig'
  | 'til_ugyldig'
  /**
   * Closing is at or before opening.
   *
   * The same rule, with the same two readings, that `./weekly-form.ts` records for a
   * weekday: it is also what refuses an opening across midnight, which the phase-2 engine
   * relies on. It is one code because it is one rule.
   */
  | 'ikke_efter'

/** Which control a refusal is bound to, for `aria-describedby` and `aria-invalid`. */
export type OverrideErrorField = 'dato' | 'art' | 'fra' | 'til'

const PROBLEM_FIELD: Readonly<Record<OverrideProblem, OverrideErrorField>> = {
  dato_mangler: 'dato',
  dato_ugyldig: 'dato',
  dato_fortid: 'dato',
  art_ugyldig: 'art',
  fra_mangler: 'fra',
  fra_ugyldig: 'fra',
  til_mangler: 'til',
  til_ugyldig: 'til',
  // Reported on the closing time, because that is the field a person moves to fix it.
  ikke_efter: 'til',
}

export const OVERRIDE_ERROR_MESSAGES: Readonly<Record<OverrideProblem, string>> = {
  dato_mangler: 'Vælg den dato, ændringen gælder.',
  dato_ugyldig: 'Datoen findes ikke. Skriv den som ÅÅÅÅ-MM-DD.',
  dato_fortid: 'Datoen er passeret. Vælg i dag eller en dag længere fremme.',
  art_ugyldig: 'Vælg, om I holder lukket den dag, eller har andre tider.',
  fra_mangler: 'Vælg, hvornår I åbner den dag.',
  til_mangler: 'Vælg, hvornår I lukker den dag.',
  fra_ugyldig: 'Åbningstidspunktet skal skrives som TT:MM.',
  til_ugyldig: 'Lukketidspunktet skal skrives som TT:MM.',
  ikke_efter:
    'Lukketiden skal ligge efter åbningstiden. Åbningstider kan ikke gå over midnat.',
}

const PROBLEMS = Object.keys(OVERRIDE_ERROR_MESSAGES) as OverrideProblem[]

/** True when `value` is a code this module defined. Everything else is not a refusal. */
export function isOverrideProblem(value: unknown): value is OverrideProblem {
  return typeof value === 'string' && (PROBLEMS as string[]).includes(value)
}

/** Only codes this module defined. Anything else in the URL contributes nothing. */
export function decodeOverrideProblems(values: readonly string[]): OverrideProblem[] {
  return values.filter(isOverrideProblem)
}

export function overrideErrorField(problem: OverrideProblem): OverrideErrorField {
  return PROBLEM_FIELD[problem]
}

/** The message for one field, or `undefined` — what a control binds itself to. */
export function overrideErrorFor(
  problems: readonly OverrideProblem[],
  field: OverrideErrorField,
): string | undefined {
  const problem = problems.find((candidate) => PROBLEM_FIELD[candidate] === field)

  return problem === undefined ? undefined : OVERRIDE_ERROR_MESSAGES[problem]
}

// ---------------------------------------------------------------------------
// Reading the card
// ---------------------------------------------------------------------------

export type OverrideFormResult =
  | { readonly ok: true; readonly date: IsoDate; readonly content: OverrideContent }
  | { readonly ok: false; readonly errors: readonly OverrideProblem[] }

/**
 * Read 1t's lower card.
 *
 * Every problem is collected rather than only the first, for the same reason the seven
 * weekday rows are: the card is submitted whole, and somebody correcting it should see
 * everything wrong with it at once.
 *
 * The two times are read **only** for `custom`. A closed override carries none, so a stale
 * `from` left in a hidden field by a person who switched the radio contributes nothing —
 * the result is built from the kind outwards rather than from whatever the form contained,
 * which is the structural half of "no extra values reach the row". The strict draft schema
 * and `overrides_shape_check` are the other two.
 */
export function toOverrideDraft(
  form: OverrideFormValues,
  today: IsoDate,
): OverrideFormResult {
  const errors: OverrideProblem[] = []

  const date = form.date.trim()
  if (date.length === 0) errors.push('dato_mangler')
  else if (!isIsoDate(date)) errors.push('dato_ugyldig')
  else if (date < today) errors.push('dato_fortid')

  if (!isOverrideKind(form.kind)) {
    errors.push('art_ugyldig')
    return { ok: false, errors }
  }

  if (form.kind === 'closed') {
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, date, content: { kind: 'closed', opens_at: null, closes_at: null } }
  }

  const from = form.from.trim()
  const to = form.to.trim()
  const timeProblems: OverrideProblem[] = []

  if (from.length === 0) timeProblems.push('fra_mangler')
  else if (!isClockTime(from)) timeProblems.push('fra_ugyldig')

  if (to.length === 0) timeProblems.push('til_mangler')
  else if (!isClockTime(to)) timeProblems.push('til_ugyldig')

  // Only when both times are readable: an ordering complaint about a value nobody could
  // parse would be a second message about the same mistake.
  if (timeProblems.length === 0 && from >= to) timeProblems.push('ikke_efter')

  errors.push(...timeProblems)

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, date, content: { kind: 'custom', opens_at: from, closes_at: to } }
}

// ---------------------------------------------------------------------------
// What is different from what is published
// ---------------------------------------------------------------------------

export function overrideContentEqual(a: OverrideContent, b: OverrideContent): boolean {
  return a.kind === b.kind && a.opens_at === b.opens_at && a.closes_at === b.closes_at
}

/** The three fields a draft may carry, in the order the schema declares them. */
export const OVERRIDE_CONTENT_FIELDS = ['kind', 'opens_at', 'closes_at'] as const

/**
 * What one Gem should write to an **already published** override — technical plan §4, §6.
 *
 * §4: a draft holds only the changed fields. Here that is all three or none of them, and
 * the all-or-none is deliberate rather than incidental: `overrides_shape_check` is a rule
 * *between* the three columns, so a draft carrying `kind: 'closed'` without also clearing
 * the two times would be a draft that can never be published. Writing the triple whole —
 * or clearing the triple whole when the edit has been undone — is what keeps every stored
 * draft on this table publishable by construction.
 *
 * `clear` rather than `mode: 'replace'`, for the reason `lib/drafts/overlay.ts` spells
 * out: `replace` is a claim that this is the entity's only editor, and this one shares its
 * row with a lifecycle (`status`) it does not own.
 */
export function overrideDraftWrite(
  next: OverrideContent,
  live: OverrideContent,
): {
  readonly values: Partial<OverrideContent>
  readonly clear: readonly string[]
} {
  return overrideContentEqual(next, live)
    ? { values: {}, clear: [...OVERRIDE_CONTENT_FIELDS] }
    : { values: { ...next }, clear: [] }
}

// ---------------------------------------------------------------------------
// Saying what a date is
// ---------------------------------------------------------------------------

/** A sentence begins with a capital, and `formatWeekdayName` returns a lowercase noun. */
function capitalise(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

/** "Lukket hele dagen" / "13:00–18:00" — one override, in words. */
export function describeOverrideContent(content: OverrideContent): string {
  if (content.kind === 'closed') return 'Lukket hele dagen'

  if (content.opens_at === null || content.closes_at === null) {
    // Unreachable while the shape CHECK holds, and stated rather than assumed: a `custom`
    // row without both times is a row the database refused to store.
    throw new TypeError('A custom override must carry both an opening and a closing time.')
  }

  return formatTimeRange(content.opens_at, content.closes_at)
}

/** "Søndag 14.09 · Lukket hele dagen" — the line the admin list prints per date. */
export function describeOverrideDay(date: IsoDate, content: OverrideContent): string {
  return `${capitalise(formatWeekdayDate(date))} · ${describeOverrideContent(content)}`
}

/**
 * Where one date's override is in its lifecycle — the four states the model can hold.
 *
 * `status` and `draft` are two independent facts, so there are four combinations and all
 * four are real. Naming them once here is what stops the screen, the badge, the pending
 * band, the publish action and the removal control from each deciding for themselves.
 */
export type OverrideLifecycle =
  /** No row: the date follows the normal weekly schedule. */
  | 'ingen'
  /** `status = 'draft'`: waiting to go live, and never yet live. A guest sees nothing. */
  | 'kladde'
  /** `status = 'published'`, no draft: live, and honoured by the phase-2 engine. */
  | 'live'
  /** `status = 'published'` with a draft: live, with an edit waiting behind it. */
  | 'live_med_kladde'

export function overrideLifecycle(
  row: { readonly status: OverrideStatus; readonly hasDraft: boolean } | null,
): OverrideLifecycle {
  if (row === null) return 'ingen'
  if (row.status === 'draft') return 'kladde'

  return row.hasDraft ? 'live_med_kladde' : 'live'
}

/** True while something on this date is waiting for Offentliggør. */
export function overrideIsPending(lifecycle: OverrideLifecycle): boolean {
  return lifecycle === 'kladde' || lifecycle === 'live_med_kladde'
}

/** The pill beside the card's heading — the word, never the colour alone (1aa). */
export function overrideStateBadge(lifecycle: OverrideLifecycle): string | null {
  switch (lifecycle) {
    case 'ingen':
      return null
    case 'kladde':
      return 'Kladde'
    case 'live':
      return 'På hjemmesiden'
    case 'live_med_kladde':
      return 'Kladde'
  }
}

/**
 * What the screen says about the selected date, in a sentence — 1aa's computed state.
 *
 * Derived from the two stored facts rather than from anything the browser sent, so it
 * cannot claim a state the database does not hold. The `live_med_kladde` sentence names
 * **both** answers on purpose: the whole promise of §6 is that the guest is still reading
 * the published one, and a screen showing only the pending edit would be the one place
 * that promise looked broken.
 */
export function describeOverrideState(
  date: IsoDate,
  lifecycle: OverrideLifecycle,
  live: OverrideContent | null,
  pending: OverrideContent | null,
): string {
  const day = capitalise(formatWeekdayDate(date))

  switch (lifecycle) {
    case 'ingen':
      return `${day}: de normale åbningstider gælder. Der er ingen ændring for den dag.`
    case 'kladde':
      return `${day}: ${describeOverrideContent(pending as OverrideContent)} — gemt som kladde. Hjemmesiden viser stadig de normale tider.`
    case 'live':
      return `${day}: ${describeOverrideContent(live as OverrideContent)} — det står på hjemmesiden nu.`
    case 'live_med_kladde':
      return `${day}: hjemmesiden viser ${describeOverrideContent(live as OverrideContent)}. Kladden siger ${describeOverrideContent(pending as OverrideContent)} og venter på at blive offentliggjort.`
  }
}

/** 1aa's pending band, in the two lengths the screen needs it in. */
export type OverridePending = {
  /** The badge beside the heading. Short, because a badge is. */
  readonly badge: string
  /** The band's own sentence. */
  readonly sentence: string
}

/**
 * What is waiting on this date — or `null` when nothing is.
 *
 * It names the date and what will happen on it rather than saying "Ændringer", for the
 * same reason the weekly band names the days: a band that cannot say what is pending is a
 * band a person has to open the editor to understand.
 */
export function describeOverridePending(
  date: IsoDate,
  lifecycle: OverrideLifecycle,
  pending: OverrideContent | null,
): OverridePending | null {
  if (!overrideIsPending(lifecycle) || pending === null) return null

  const day = capitalise(formatWeekdayDate(date))
  const what = describeOverrideContent(pending)

  return {
    badge: overrideStateBadge(lifecycle) ?? 'Kladde',
    sentence:
      lifecycle === 'kladde'
        ? `${day}: ${what} venter på at blive offentliggjort.`
        : `${day}: ændringen til ${what} venter på at blive offentliggjort.`,
  }
}

/**
 * What "Fjern" does to this date, in the administration's own words.
 *
 * **The central decision table** for removal, and deliberately the only one: the Server
 * Action asks it what a press means rather than branching on the lifecycle itself, and the
 * screen draws whatever it returns. The **server** decides the inputs from the rows it
 * read, never from a field the browser sent; this function only words the decision.
 *
 *   * `kladde` — the row has never been live, so removing it deletes it and no guest sees
 *     anything change. There is nothing to confirm.
 *   * `live_med_kladde` — only the pending edit goes; the published override stays exactly
 *     as the hjemmeside is showing it. Also nothing to confirm. **Never** touches an
 *     announcement, even one this override owns: the published hours it describes are
 *     exactly as they were.
 *   * `live` — the override leaves the hjemmeside and the date goes back to the normal
 *     weekly schedule, at once. That one asks first (§6: a change a guest can see is never
 *     made by a single unconfirmed press on this screen).
 *   * `live` **and it owns the generated announcement** — §7e item 6. Both go, in one
 *     transaction, and the confirmation says so. There is deliberately **no** branch that
 *     keeps the message and deletes the hours it describes: that would leave guests
 *     reading about opening times that no longer exist, and the source of truth asks for
 *     no such feature.
 */
export type OverrideRemoval = {
  readonly label: string
  readonly description: string
  /** True when the press changes what a guest reads and must therefore be confirmed. */
  readonly confirms: boolean
  /**
   * True when going ahead also takes the generated announcement down (§7e item 6).
   *
   * The Server Action sends this to the database as its one confirmation bit, so the
   * sentence a person read and the transition that runs are decided in the same place.
   */
  readonly removesAnnouncement: boolean
}

export function describeOverrideRemoval(
  lifecycle: OverrideLifecycle,
  /**
   * Whether this override owns the announcement the hjemmeside is showing.
   *
   * Decided by `isOwnedByOverride()` from the two ownership columns — an id compared to
   * an id, never the message's wording, its weekday, its expiry or its link (§7e item 6:
   * the suggested text is editable and is therefore evidence of nothing).
   */
  ownsAnnouncement = false,
): OverrideRemoval | null {
  switch (lifecycle) {
    case 'ingen':
      return null
    case 'kladde':
      return {
        label: 'Fjern kladden',
        description:
          'Kladden slettes. Den har aldrig været på hjemmesiden, så der ændrer sig ikke noget for gæsterne.',
        confirms: false,
        removesAnnouncement: false,
      }
    case 'live_med_kladde':
      return {
        label: 'Fortryd den ventende ændring',
        description:
          'Kun kladden slettes. Den ændring, der allerede står på hjemmesiden, bliver stående.',
        confirms: false,
        removesAnnouncement: false,
      }
    case 'live':
      return ownsAnnouncement
        ? {
            label: 'Fjern ændring og besked',
            description:
              'Datoen følger igen de normale åbningstider, og beskeden om de ændrede tider fjernes fra hjemmesiden. Beskeden fortæller om tider, der ikke længere gælder, så de to hører sammen. Det sker med det samme og kan ikke fortrydes — men ændringen kan altid laves igen herover.',
            confirms: true,
            removesAnnouncement: true,
          }
        : {
            label: 'Fjern ændringen fra hjemmesiden',
            description:
              'Datoen følger igen de normale åbningstider. Det sker med det samme og kan ikke fortrydes — men ændringen kan altid laves igen herover.',
            confirms: true,
            removesAnnouncement: false,
          }
  }
}
