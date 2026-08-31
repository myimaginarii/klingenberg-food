import { SubmitButton } from '@/components/admin/SubmitButton'
import { timeChoicesFor } from '@/lib/hours/clock-choices'
import {
  OVERRIDE_KIND_LABELS,
  OVERRIDE_KINDS,
  type OverrideErrorField,
  type OverrideFormValues,
} from '@/lib/hours/override-form'

/**
 * Ændrede tider en enkelt dag — design 1t (the lower card, "ENKELT ÆNDRING").
 *
 * A plain `<form>` posting to a Server Action, like every other editor in this
 * administration: no client component, no controlled inputs, no state library, and nothing
 * in the browser that has to be kept in step with the server. The card is a `<section>`
 * labelled by its own heading, beneath the recurring week's — which the same screen shows
 * only to an owner (§5).
 *
 * WHAT 1t DRAWS, AND WHAT SHIPS
 *
 * The frame draws two chips — *"Lukket en bestemt dato"* and *"Andre tider en enkelt dag"*
 * — a **Dato** field, **Fra** and **Til**, and a footer with *"Forhåndsvis"* and *"Gem og
 * offentliggør"*. All of that ships, in the frame's own words.
 *
 * The chips ship as a **radio group**, because that is what they are: two mutually
 * exclusive answers to one question, exactly one of which is always chosen. Drawn as
 * chips, operated with the arrow keys, and named by the legend above them — which is the
 * treatment 1r's label chips already use in this administration (`LabelFields`).
 *
 * One control is added to the frame's two, and one is left out:
 *
 *   * **"Gem"** is added, beside them. §6 makes Forhåndsvis the middle step of the path by
 *     which content reaches the hjemmeside, and a preview needs something to preview. Without
 *     a way to reach a pending state the frame's own Forhåndsvis could only ever show what
 *     had already gone live, and the promise this screen makes — *the hjemmeside does not
 *     move until you publish* — would have no state in which it was observable. It is the
 *     administration's established word for the established operation.
 *   * **"Vis også som besked øverst på hjemmesiden"**, the suggested message beneath it and
 *     the conflict sheet behind it are **not here at all** — they are phase 8C. They are
 *     absent rather than present and inert, for the same reason 1ah's image control was
 *     absent from the Månedens burger editor and 1ad's removal controls were absent from
 *     phase 7A: a control that lies is worse than a control that is not there yet. This
 *     card has no field for a message, a link or an expiry, and nothing it submits can
 *     reach `public.announcement`.
 *
 * WHY THE TWO TIME FIELDS APPEAR AND DISAPPEAR WITHOUT A LINE OF JAVASCRIPT
 *
 * The same mechanism the seven weekday rows use, for the same reason. The two radios are
 * *siblings* of everything that reacts to them, so `peer-checked/andre:` — a plain `~`
 * combinator, not `:has()` — draws both of the card's appearances. The controls stay in the
 * DOM and are still submitted when hidden (only `disabled` prevents that), which is what
 * makes "choose Andre tider and both times" **one save** rather than two.
 *
 * A closed override carries no times at all, and `toOverrideDraft` builds its answer from
 * the chosen kind outwards rather than from whatever the form contained — so a stale `fra`
 * left behind by somebody who switched back to *Lukket* reaches no column.
 *
 * NOTHING IS DECIDED HERE. The values, the choices, the state sentence and the refusals are
 * all computed by `lib/hours/override-form.ts` and handed in.
 */

export type OverrideFieldNames = {
  readonly date: string
  readonly kind: string
  readonly from: string
  readonly to: string
  readonly version: string
  readonly versionDate: string
}

export type OverrideEditorProps = {
  /** Gem — writes a pending change and publishes nothing. */
  readonly action: (formData: FormData) => Promise<void>
  /** 1t's own "Gem og offentliggør". */
  readonly publishAction: (formData: FormData) => Promise<void>
  readonly anchorId: string
  readonly fieldNames: OverrideFieldNames
  readonly values: OverrideFormValues
  /** The `updated_at` this date's row was rendered from, or `''` when it has no row. */
  readonly version: string
  /** Which date that version token belongs to. A version belongs to one row. */
  readonly versionDate: string
  /** The refusal for one control, or `undefined`. */
  readonly errorFor: (field: OverrideErrorField) => string | undefined
  /** The card's computed state, as a whole sentence. */
  readonly stateSentence: string
  /** "Kladde" / "På hjemmesiden", or `null` when the date has no override. */
  readonly stateBadge: string | null
  /** Whether that badge is a *pending* state. Decided by the domain, never from its text. */
  readonly statePending: boolean
  /** Where 1t's "Forhåndsvis" goes — the real public page, through Draft Mode. */
  readonly previewHref: string
  /** The removal control and the list, rendered by the screen beneath the form. */
  readonly children?: React.ReactNode
}

/** The placeholder a time with nothing chosen shows. Never a valid submitted value. */
const NO_TIME_LABEL = 'Vælg tidspunkt'

export function OverrideEditor({
  action,
  publishAction,
  anchorId,
  fieldNames,
  values,
  version,
  versionDate,
  errorFor,
  stateSentence,
  stateBadge,
  statePending,
  previewHref,
  children,
}: OverrideEditorProps) {
  const headingId = `${anchorId}-titel`
  const stateId = `${anchorId}-tilstand`
  const kindLabelId = `${anchorId}-art`
  const dateId = `${anchorId}-dato`
  const fromId = `${anchorId}-fra`
  const toId = `${anchorId}-til`

  const dateError = errorFor('dato')
  const kindError = errorFor('art')
  const fromError = errorFor('fra')
  const toError = errorFor('til')

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {/* 1t's own eyebrow above the card's contents. */}
          <p className="text-ink-3 font-mono text-[0.6875rem] tracking-[0.16em] uppercase">
            Enkelt ændring
          </p>
          <h2 className="text-heading font-sans font-semibold" id={headingId}>
            Ændrede tider en enkelt dag
          </h2>
        </div>
        {stateBadge === null ? null : (
          <StateBadge pending={statePending}>{stateBadge}</StateBadge>
        )}
      </div>

      {/*
        The computed state, in words — 1aa. It is the sentence that answers "what does the
        hjemmeside say about this date right now?", which is the one question a card with
        both a live value and a pending one has to be able to answer out loud.
      */}
      <p className="text-ink-2 text-meta mb-4" id={stateId}>
        {stateSentence}
      </p>

      <form
        action={action}
        aria-describedby={stateId}
        aria-label="Ændrede tider en enkelt dag"
        className="flex flex-col gap-4"
      >
        <input name={fieldNames.version} type="hidden" value={version} />
        <input name={fieldNames.versionDate} type="hidden" value={versionDate} />

        <div className="flex flex-col gap-1.5">
          <label className="text-meta text-neutral-ink font-medium" htmlFor={dateId}>
            Dato
          </label>
          {/*
            `type="date"` for the three reasons `components/admin/Field.tsx` records for
            1ah's period: it is the control the phone already has, its value is exactly the
            `YYYY-MM-DD` the column stores, and it needs no JavaScript — where a browser has
            no date control it degrades to a text field and the server parses the value
            either way.

            No `min` attribute. §7e item 7's "today or later" is a rule the *server* states,
            with a Danish sentence naming what is wrong; a browser-enforced bound would be a
            second rule in a second place, and one that a forged request would not meet.
          */}
          <input
            aria-describedby={
              [`${dateId}-hjaelp`, dateError === undefined ? null : `${dateId}-fejl`]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={dateError === undefined ? undefined : true}
            className={`bg-field-bg rounded-field text-ink min-h-12 w-full border-[1.5px] px-3 tabular-nums md:max-w-64 ${
              dateError === undefined ? 'border-field-border' : 'border-error bg-surface'
            }`}
            defaultValue={values.date}
            id={dateId}
            name={fieldNames.date}
            type="date"
          />
          <p className="text-ink-3 text-micro" id={`${dateId}-hjaelp`}>
            I dag eller en dag længere fremme. De normale ugetider ændrer sig ikke.
          </p>
          {dateError === undefined ? null : (
            <FieldError id={`${dateId}-fejl`}>{dateError}</FieldError>
          )}
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-meta text-neutral-ink mb-1.5 font-medium" id={kindLabelId}>
            Hvad sker der den dag?
          </legend>

          {/*
            The two radios and the two time fields are siblings in one container, which is
            what lets `peer-checked/andre:` reach the times. The order is load-bearing —
            `peer-checked/…:` compiles to a `~` combinator, which reaches only *following*
            siblings — so it is stated here rather than left to be rediscovered by whoever
            moves a control next.
          */}
          <div className="flex flex-wrap items-center gap-2.5">
            {OVERRIDE_KINDS.map((kind) => (
              <KindChip
                checked={values.kind === kind}
                describedBy={kindError === undefined ? undefined : `${kindLabelId}-fejl`}
                id={`${anchorId}-${kind}`}
                key={kind}
                name={fieldNames.kind}
                peer={kind === 'custom' ? 'andre' : 'lukket'}
                value={kind}
              >
                {OVERRIDE_KIND_LABELS[kind]}
              </KindChip>
            ))}

            <div className="hidden basis-full items-end gap-2.5 peer-checked/andre:flex">
              <TimeSelect
                error={fromError}
                id={fromId}
                label="Fra"
                name={fieldNames.from}
                value={values.from}
              />
              <TimeSelect
                error={toError}
                id={toId}
                label="Til"
                name={fieldNames.to}
                value={values.to}
              />
            </div>
          </div>

          {kindError === undefined ? null : (
            <FieldError id={`${kindLabelId}-fejl`}>{kindError}</FieldError>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
          {/*
            1t's own Forhåndsvis. It opens the **real** public page through the same Draft
            Mode route every other preview on the site uses, so what a person sees is the
            site's own rendering of the pending override rather than a summary of it. The
            open/closed badge in the header is where a date's own hours actually show, and
            the card's state sentence above supplements that for a date further ahead than
            today — it does not replace it.
          */}
          <a
            className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section min-h-tap bg-surface inline-flex items-center border-[1.5px] px-4 font-semibold"
            href={previewHref}
          >
            Forhåndsvis
          </a>
          <button
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex items-center px-5 font-semibold text-white"
            formAction={publishAction}
            type="submit"
          >
            Gem og offentliggør
          </button>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Gem og
          offentliggør.
        </p>
      </form>

      {children}
    </section>
  )
}

/**
 * One of 1t's two chips — a real radio, drawn as the frame draws it.
 *
 * `sr-only` rather than `appearance: none`, so the control a keyboard and a screen reader
 * use is a real radio in a real group: Tab enters the group at the chosen chip and the
 * arrow keys move within it, which is the behaviour a person operating this without a
 * mouse expects. The 44 px target is the label, and the focus ring follows the input onto
 * it (1aa's 3 px ring is set globally in `app/globals.css`).
 *
 * The chosen state is carried by the **border, the fill and the tick** as well as by the
 * radio's own checked state, so it survives a monochrome screen (1aa: status is never
 * colour alone).
 */
function KindChip({
  id,
  name,
  value,
  checked,
  peer,
  describedBy,
  children,
}: {
  id: string
  name: string
  value: string
  checked: boolean
  /** The named peer this chip's label and, for `andre`, the time fields react to. */
  peer: 'lukket' | 'andre'
  describedBy?: string
  children: React.ReactNode
}) {
  return (
    <>
      {/*
        `aria-describedby` and not `aria-invalid`: ARIA does not support the latter on
        `role="radio"`, which a native radio has implicitly. The refusal is therefore
        carried to this control by the description alone — and it is unreachable from the
        drawn group in any case, because one of the two chips is always chosen. It exists
        for a forged submission naming neither, which the server refuses by name.
      */}
      <input
        aria-describedby={describedBy}
        className={peer === 'andre' ? 'peer/andre sr-only' : 'peer/lukket sr-only'}
        defaultChecked={checked}
        id={id}
        name={name}
        type="radio"
        value={value}
      />
      <label
        className={
          peer === 'andre'
            ? "rounded-field border-field-border text-neutral-ink bg-surface peer-checked/andre:border-brand-700 peer-checked/andre:bg-brand-50 peer-checked/andre:text-brand-700 peer-checked/andre:before:mr-2 peer-checked/andre:before:content-['✓'] peer-focus-visible/andre:outline-focus min-h-12 inline-flex cursor-pointer items-center border-[1.5px] px-5 font-semibold peer-focus-visible/andre:outline-[3px] peer-focus-visible/andre:outline-offset-2"
            : "rounded-field border-field-border text-neutral-ink bg-surface peer-checked/lukket:border-brand-700 peer-checked/lukket:bg-brand-50 peer-checked/lukket:text-brand-700 peer-checked/lukket:before:mr-2 peer-checked/lukket:before:content-['✓'] peer-focus-visible/lukket:outline-focus min-h-12 inline-flex cursor-pointer items-center border-[1.5px] px-5 font-semibold peer-focus-visible/lukket:outline-[3px] peer-focus-visible/lukket:outline-offset-2"
        }
        htmlFor={id}
      >
        {children}
      </label>
    </>
  )
}

/**
 * One of the two time dropdowns — 1t's "17:00 ▾".
 *
 * A `<select>` over the quarter-hour grid, exactly as the weekly card's is and from the
 * same module (`lib/hours/clock-choices.ts`), so the four dropdowns on this screen offer
 * one list. A stored time that is not on the grid is added to the choices rather than
 * dropped, so no save can silently move an existing `17:20` to the nearest quarter.
 *
 * The label is visible here, because 1t draws "Fra" and "Til" above the fields — unlike
 * the weekly rows, where the weekday at the head of the row is the visible label.
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
    /*
     * Half the line on a phone, and 1t's own narrow field from `md` up — the same
     * arrangement the weekly card's fourteen dropdowns use, so the four time controls on
     * this screen are one control at two sizes rather than two controls.
     */
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 md:w-32 md:flex-none">
      <label className="text-meta text-neutral-ink font-medium" htmlFor={id}>
        {label}
      </label>
      <select
        aria-describedby={error === undefined ? undefined : `${id}-fejl`}
        aria-invalid={error === undefined ? undefined : true}
        className={`bg-field-bg rounded-field text-ink min-h-12 w-full min-w-0 border-[1.5px] px-2.5 text-center tabular-nums ${
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
      {error === undefined ? null : <FieldError id={`${id}-fejl`}>{error}</FieldError>}
    </div>
  )
}

/**
 * The card's own state pill — the phase-5 vocabulary and the phase-5 tokens (1aa).
 *
 * Written here rather than imported from the weekly editor beside it, for the reason every
 * other section screen keeps its own: it is eight lines of the shared token vocabulary, and
 * two cards that share nothing else should not begin sharing a badge. It is not a `role`
 * region — the pending band above the card is the screen's status announcement.
 */
function StateBadge({
  pending,
  children,
}: {
  pending: boolean
  children: React.ReactNode
}) {
  return (
    <span
      className={`rounded-badge text-meta inline-flex items-center gap-2 border px-3 py-1.5 font-semibold ${
        pending
          ? 'border-warning-border bg-warning-surface text-warning-ink'
          : 'border-success-border bg-success-surface text-success-ink'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 ${pending ? 'bg-warning rotate-45' : 'bg-success rounded-full'}`}
      />
      {children}
    </span>
  )
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p className="text-error-ink text-meta flex items-center gap-1.5 font-medium" id={id}>
      <span aria-hidden="true" className="border-error size-3.5 shrink-0 rounded-full border-2" />
      {children}
    </p>
  )
}
