import { SubmitButton } from '@/components/admin/SubmitButton'
import { formatWeekdayName } from '@/lib/hours/format'
import {
  timeChoicesFor,
  WEEKDAY_STATE_LABELS,
  type WeekdayErrorField,
  type WeekdayFormValues,
  type WeeklyFormValues,
} from '@/lib/hours/weekly-form'
import { WEEKDAY_KEYS, type WeekdayKey } from '@/lib/time/calendar'

/**
 * De normale åbningstider — design 1t (the upper card).
 *
 * A plain `<form>` posting to a Server Action, like every other editor in this
 * administration: no client component, no controlled inputs, no state library, and nothing
 * in the browser that has to be kept in step with the server. The card is a `<section>`
 * labelled by its own heading, so the screen has one `<h1>` in the bar and one named region
 * beneath it.
 *
 * SEVEN ROWS, AND ONLY SEVEN
 *
 * Mandag to Søndag, in the order the document and every Danish opening-hours table use
 * them, from `WEEKDAY_KEYS`. The values come from the stored schedule and nothing is
 * hard-coded: the current week — Mon/Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00 —
 * is *data*, seeded in `supabase/seed/confirmed.sql`, and this file contains none of those times.
 *
 * **1t's lower half is not here.** "ENKELT ÆNDRING", the date field, "Andre tider en enkelt
 * dag", the suggested message and "Vis også som besked øverst på hjemmesiden" live in
 * `OverrideEditor` and `GeneratedAnnouncementField` (phases 8B and 8C-3B); this card cannot
 * express a date, and the form it submits has no field for one.
 *
 * WHY THE TIMES DISAPPEAR WHEN A DAY IS CLOSED, WITHOUT A LINE OF JAVASCRIPT
 *
 * 1t draws a closed row as three things — the weekday, a grey switch and the word "Lukket"
 * — and an open row as the weekday, a green switch and two dropdowns. That is one row with
 * two appearances, and the checkbox is a *sibling* of everything that changes, so
 * `peer-checked:` (a plain `~` sibling combinator, not `:has()`) is enough to draw both.
 * The controls stay in the DOM and are still submitted when hidden — only `disabled`
 * prevents that — so turning a closed day on and choosing its two times is **one save**,
 * which is what the phase brief requires and what a two-step "save, then the fields
 * appear" flow would not be.
 *
 * THE TIME CONTROL IS A `<select>`, BECAUSE 1t DRAWS ONE
 *
 * The frame draws "15:00 ▾" and says *"Tider vælges i kvarter-spring"*, so the options are
 * the quarter-hour grid — 96 of them, the whole day, because inventing a narrower range
 * would be inventing a business rule. A stored time that is not on the grid is added to the
 * list rather than dropped (`timeChoicesFor`), so no save can silently move an existing
 * `15:20` to the nearest quarter. On a phone a native `<select>` is the platform's own
 * wheel, which is the right control on the device §15 calls the primary admin device.
 *
 * A closed day's selects are empty, because the stored document has no times for a closed
 * day (`{"closed": true}` and nothing else — §4). Reopening a day therefore starts from
 * "Vælg tidspunkt", and saving without choosing is refused by name rather than publishing a
 * time nobody picked.
 *
 * NOTHING IS DECIDED HERE. The rows, the choices, the state words and the refusals are all
 * computed by `lib/hours/weekly-form.ts` and handed in.
 */

export type WeeklyHoursFieldNames = {
  readonly version: string
}

export type WeekdayFieldNames = {
  readonly open: string
  readonly from: string
  readonly to: string
}

export type WeeklyHoursEditorProps = {
  readonly action: (formData: FormData) => Promise<void>
  readonly anchorId: string
  readonly fieldNames: WeeklyHoursFieldNames
  /** The three submitted names for one weekday, built by the screen's `./forms.ts`. */
  readonly weekdayFieldNames: (weekday: WeekdayKey) => WeekdayFieldNames
  readonly values: WeeklyFormValues
  /** The `updated_at` the screen was rendered from — the concurrency token (§6). */
  readonly version: string
  /** The refusal for one weekday and one of its two time fields, or `undefined`. */
  readonly errorFor: (weekday: WeekdayKey, field: WeekdayErrorField) => string | undefined
  /** 1aa's pending band sentence, or `null` when nothing is waiting. */
  readonly pending: string | null
}

/** The placeholder a day with no chosen time shows. Never a valid submitted value. */
const NO_TIME_LABEL = 'Vælg tidspunkt'

export function WeeklyHoursEditor({
  action,
  anchorId,
  fieldNames,
  weekdayFieldNames,
  values,
  version,
  errorFor,
  pending,
}: WeeklyHoursEditorProps) {
  const headingId = `${anchorId}-titel`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading font-sans font-semibold" id={headingId}>
          Normale åbningstider
        </h2>
        {pending === null ? null : <PendingBadge>{pending}</PendingBadge>}
      </div>

      <form action={action} aria-label="Normale åbningstider" className="flex flex-col gap-4">
        <input name={fieldNames.version} type="hidden" value={version} />

        {/*
          A list, because that is what seven weekdays are, and because a screen reader
          announcing "list, 7 items" is what tells somebody how far through the week they
          are. The rows carry their own `role="group"` names, so the list adds structure
          without adding a second naming mechanism.
        */}
        <ul className="border-border rounded-card border">
          {WEEKDAY_KEYS.map((weekday) => (
            <li className="border-border border-b px-3 last:border-b-0 md:px-4" key={weekday}>
              <WeekdayRow
                errorFor={errorFor}
                fieldNames={weekdayFieldNames(weekday)}
                idPrefix={anchorId}
                row={values[weekday]}
                weekday={weekday}
              />
            </li>
          ))}
        </ul>

        {/*
          1t's own note, verbatim. It is the sentence that explains why there is no field
          for "Ons–fre 15:00–20:00": the public footer groups the days itself
          (`groupWeeklyHours` in `lib/hours/format.ts`), so nobody writes a range by hand.
        */}
        <p className="text-ink-3 text-micro">
          Tider vælges i kvarter-spring. Ingen skriver “Ons–fre 15:00–20:00” i hånden —
          hjemmesiden samler dagene selv.
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør.
        </p>
      </form>
    </section>
  )
}

/**
 * One weekday — 1t's row, at both of the widths the design is drawn at.
 *
 * `role="group"` with `aria-labelledby` rather than a `<fieldset>`: the row is a flex line
 * whose parts reflow at `md`, and a `<legend>` cannot be placed inside one without
 * fighting the layout. The group still has a real, spoken name — the weekday — which is
 * what the accessibility requirement asks for, and each control inside it carries a name
 * that repeats the weekday, so a control read on its own is still unambiguous.
 *
 * The checkbox is placed **before** everything that reacts to it — the switch it draws, the
 * word "Lukket" and the two times — because `peer-checked:` compiles to a `~` combinator,
 * which reaches only following siblings in the same parent. That ordering is load-bearing,
 * so it is stated here rather than left to be rediscovered by whoever moves a row next.
 */
function WeekdayRow({
  weekday,
  row,
  fieldNames,
  idPrefix,
  errorFor,
}: {
  weekday: WeekdayKey
  row: WeekdayFormValues
  fieldNames: WeekdayFieldNames
  idPrefix: string
  errorFor: (weekday: WeekdayKey, field: WeekdayErrorField) => string | undefined
}) {
  const name = formatWeekdayName(weekday, 'long')
  const title = name.charAt(0).toUpperCase() + name.slice(1)

  const labelId = `${idPrefix}-${weekday}-dag`
  const openId = `${idPrefix}-${weekday}-aaben`
  const fromId = `${idPrefix}-${weekday}-fra`
  const toId = `${idPrefix}-${weekday}-til`

  const fromError = errorFor(weekday, 'fra')
  const toError = errorFor(weekday, 'til')

  return (
    <div
      aria-labelledby={labelId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3 md:gap-3.5"
      role="group"
    >
      {/*
        The switch's `<input>` comes first in the DOM and is `sr-only` — absolutely
        positioned and zero-sized, so it occupies no space and the row still *reads*
        weekday-then-switch. Everything that changes appearance with the day's state
        follows it, which is what `peer-checked:` needs.

        `sr-only` rather than `appearance: none`, so the control a keyboard and a screen
        reader use is a real checkbox with a real label, and the drawn track is decoration
        that follows it.
      */}
      <input
        className="peer sr-only"
        defaultChecked={row.open}
        id={openId}
        name={fieldNames.open}
        type="checkbox"
        value="1"
      />

      {/*
        1t draws a closed day's name in the muted ink and an open day's in the full one.
        Driven by the checkbox rather than by `row.open`, so flipping the switch recolours
        it at once — a name still reading "open" beside a switch somebody has just turned
        off would be the one part of the row that lied until the next save.
      */}
      <span className="text-ink-3 peer-checked:text-ink text-body w-24 shrink-0 font-semibold" id={labelId}>
        {title}
      </span>

      {/*
        The label is the 44 px target 1aa requires (1t draws the track at 52 × 30); the
        track and its knob are the label's own `::before` and `::after`, which is what lets
        both react to `peer-checked:`.
      */}
      <label
        className="min-h-tap peer-focus-visible:outline-focus relative inline-flex w-[3.25rem] shrink-0 items-center before:absolute before:inset-x-0 before:top-1/2 before:h-[1.875rem] before:-translate-y-1/2 before:rounded-[0.9375rem] before:bg-rule before:transition-colors before:content-[''] after:absolute after:top-1/2 after:left-[0.1875rem] after:size-6 after:-translate-y-1/2 after:rounded-full after:bg-white after:transition-[left] after:content-[''] peer-checked:before:bg-success peer-checked:after:left-[1.5625rem] peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2"
        htmlFor={openId}
      >
        {/*
          The control's whole accessible name. "Åbent" alone is ambiguous in a list of
          seven rows; the weekday makes it a sentence somebody can act on, which is what
          WCAG 2.5.3 asks of a control whose visible state is drawn rather than written.
        */}
        <span className="sr-only">Åbent om {name}en</span>
      </label>

      {/*
        1aa: status is icon **and** text, never colour alone. The switch's colour and its
        knob position both say the state; this is the third carrier, and the one that
        survives being read aloud or seen without colour.
      */}
      <span className="text-ink-3 text-body peer-checked:hidden">
        {WEEKDAY_STATE_LABELS.closed}
      </span>

      <div className="hidden basis-full items-center gap-2 peer-checked:flex md:basis-auto md:gap-2.5">
        <TimeSelect
          error={fromError}
          id={fromId}
          label={`${title} — åbner`}
          name={fieldNames.from}
          value={row.from}
        />

        <span aria-hidden="true" className="text-ink-2 text-meta shrink-0">
          til
        </span>

        <TimeSelect
          error={toError}
          id={toId}
          label={`${title} — lukker`}
          name={fieldNames.to}
          value={row.to}
        />
      </div>

      {/*
        The refusals, on their own line beneath the row they belong to. Each control also
        points at its own message with `aria-describedby` and carries `aria-invalid`, so
        the problem is never carried by the red border alone (1aa).
      */}
      {fromError === undefined && toError === undefined ? null : (
        <div className="basis-full">
          {fromError === undefined ? null : (
            <RowError id={`${fromId}-fejl`}>{fromError}</RowError>
          )}
          {toError === undefined ? null : <RowError id={`${toId}-fejl`}>{toError}</RowError>}
        </div>
      )}
    </div>
  )
}

/**
 * One of the two dropdowns — 1t's "15:00 ▾".
 *
 * The visible label is the weekday name at the head of the row, so this control's own
 * label is carried for a screen reader alone and repeats the weekday: "Onsdag — åbner".
 * A `<select>` read out of context is otherwise just a time.
 *
 * `min-h-12` rather than `min-h-tap`: 48 px is the height 1t draws the field at, and it is
 * above the 44 px minimum rather than below it.
 */
function TimeSelect({
  id,
  name,
  label,
  value,
  error,
}: {
  id: string
  name: string
  label: string
  value: string
  error?: string
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select
        aria-describedby={error === undefined ? undefined : `${id}-fejl`}
        aria-invalid={error === undefined ? undefined : true}
        className={`bg-field-bg rounded-field text-ink min-h-12 w-full min-w-0 flex-1 border-[1.5px] px-2.5 text-center tabular-nums md:w-26 md:flex-none ${
          error === undefined ? 'border-field-border' : 'border-error bg-surface'
        }`}
        defaultValue={value}
        id={id}
        name={name}
      >
        <option value="">{NO_TIME_LABEL}</option>
        {timeChoicesFor(value).map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    </>
  )
}

/**
 * The Kladde badge on this card — the phase-5 vocabulary and the phase-5 tokens (1aa).
 *
 * Written here rather than imported from the weekly or monthly editor, for the reason
 * those two also keep their own: it is eight lines of the shared token vocabulary, and a
 * component in one section screen importing a badge out of another would couple two
 * editors that otherwise share nothing. It is not a `role` region — the pending band above
 * the card is the screen's status announcement, and two live regions saying the same thing
 * would be one too many.
 */
function PendingBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-badge border-warning-border bg-warning-surface text-warning-ink inline-flex items-center gap-2 border px-3 py-1.5 text-meta font-semibold">
      <span aria-hidden="true" className="bg-warning size-2 shrink-0 rotate-45" />
      {children}
    </span>
  )
}

function RowError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p className="text-error-ink text-meta flex items-center gap-1.5 font-medium" id={id}>
      <span aria-hidden="true" className="border-error size-3.5 shrink-0 rounded-full border-2" />
      {children}
    </p>
  )
}
