import { DateField, TextAreaField, TextField } from '@/components/admin/Field'
import { SubmitButton } from '@/components/admin/SubmitButton'
import type { DishAvailability } from '@/lib/menu/admin'
import { MONTHLY_HOMEPAGE_HELP, MONTHLY_WINDOW_HELP } from '@/lib/menu/monthly'

import {
  MonthlyAvailabilityBlock,
  type MonthlyAvailabilityForm,
} from './MonthlyAvailability'

/**
 * Månedens burger — design 1ah.
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration: no client component, no controlled inputs, no state library, and
 * nothing in the browser that has to be kept in step with the server. The card is a
 * `<section>` labelled by its own heading, so the screen has one `<h1>` in the bar and
 * one named region beneath it.
 *
 * THE FIELDS ARE THE FRAME'S, AND ONLY THE FRAME'S
 *
 * Navn, Beskrivelse, Pris (kr.), Startdato, Slutdato and "Vis på forsiden". Nothing is
 * added: no ingredient list, no allergen claim, no label, no second price, no
 * calendar-month rule and no field the `monthly_burger` columns do not already have
 * (§4). Nothing about an actual burger is invented anywhere in this phase — 1ab lists
 * Månedens burger among the things the restaurant has not supplied, and it stays that
 * way until they type one.
 *
 * **The image slot arrived in phase 10C-1**, as `imageSlot` below — the shared
 * `ImagePickerField` over 1ah's "Billede (valgfrit)". It is deliberately not a field
 * of this form: the selection is its own draft write with its own action, so
 * `image_id` remains outside {@link MONTHLY_EDITOR_FIELDS} and a Gem here still
 * cannot wipe a pending photo, exactly as before the slot existed.
 *
 * THE TWO THINGS THAT ARE NOT PART OF THIS FORM, AND WHY
 *
 * HTML forms cannot nest, and both of these post somewhere else than Gem:
 *
 *   * **The Udsolgt switch** changes the hjemmeside immediately (§6). It is a sibling
 *     placed **above** the fields, so the single exception is not buried among fields
 *     that all follow the ordinary three-step rule. 1ah draws it lower, between the
 *     dates and the Forside toggle; putting it first is the arrangement 1aa's own note
 *     asks for in words.
 *   * **"Ryd felterne"** is 1ah's own footer control, and it writes a draft like Gem —
 *     but as its own operation with its own message, rather than as a second submit
 *     button whose position would decide what the Enter key does inside a text field.
 *
 * "VIS PÅ FORSIDEN" IS AN ORDINARY FIELD OF THIS FORM
 *
 * It is saved by Gem, becomes a Kladde, and changes nothing a guest sees until somebody
 * presses Offentliggør (§6, §7d). It is deliberately *not* on the immediate path, and
 * the helper line beneath it says what it actually governs — the burger's **own** Forside
 * section. 1ah's drawn wording ("Optager en af de tre pladser under 'Tre fra menuen'")
 * describes behaviour that was withdrawn by the approved requirement change of 29 August
 * 2026, and `MONTHLY_HOMEPAGE_HELP` is the single source of what ships instead.
 */

export type MonthlyEditorValues = {
  readonly name: string
  readonly description: string
  readonly price: string
  readonly startsOn: string
  readonly endsOn: string
  readonly showOnHomepage: boolean
}

export type MonthlyEditorFieldNames = {
  readonly version: string
  readonly name: string
  readonly description: string
  readonly price: string
  readonly startsOn: string
  readonly endsOn: string
  readonly showOnHomepage: string
}

/** "Ryd felterne" — its own form, its own action, its own single hidden field. */
export type MonthlyClearForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: { readonly version: string }
}

export function MonthlyBurgerEditor({
  anchorId,
  action,
  fieldNames,
  values,
  version,
  availability,
  availabilityForm,
  clearForm,
  errorFor,
  pending,
  imageSlot,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  fieldNames: MonthlyEditorFieldNames
  values: MonthlyEditorValues
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  availability: DishAvailability
  availabilityForm: MonthlyAvailabilityForm
  clearForm: MonthlyClearForm
  /** The message for one field, or undefined. Bound with `aria-describedby`. */
  errorFor: (field: 'navn' | 'beskrivelse' | 'pris' | 'start' | 'slut') => string | undefined
  /** The Kladde line for this card, or null when nothing is pending. */
  pending: string | null
  /**
   * 1ah's "Billede (valgfrit)" slot (phase 10C-1) — `ImagePickerField`, rendered by
   * the page. A sibling of the Gem form, not a field inside it: its removal control
   * is a form of its own, forms cannot nest, and the selection is its own draft
   * write — so a Gem here can never clear a pending photo.
   */
  imageSlot?: React.ReactNode
}) {
  const headingId = `${anchorId}-titel`
  const homepageToggleId = `${anchorId}-forside`
  const homepageHelpId = `${anchorId}-forside-hjaelp`
  const windowHelpId = `${anchorId}-periode-hjaelp`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading font-sans font-semibold" id={headingId}>
          Månedens burger
        </h2>
        {pending === null ? null : <PendingBadge>{pending}</PendingBadge>}
      </div>

      <div className="mb-4">
        <MonthlyAvailabilityBlock
          availability={availability}
          form={availabilityForm}
          version={version}
        />
      </div>

      <form action={action} aria-label="Månedens burger" className="flex flex-col gap-4">
        <input name={fieldNames.version} type="hidden" value={version} />

        <TextField
          defaultValue={values.name}
          error={errorFor('navn')}
          hint="Lad feltet stå tomt, hvis der ikke er nogen månedens burger lige nu. Så skriver menuen “ikke oplyst endnu”, og forsiden viser intet afsnit."
          id="maanedens-burger-navn"
          label="Navn"
          maxLength={200}
          name={fieldNames.name}
        />

        <TextAreaField
          defaultValue={values.description}
          error={errorFor('beskrivelse')}
          hint="Fyld som på de faste burgere — bøf, tilbehør, sauce, bolle."
          id="maanedens-burger-beskrivelse"
          label="Beskrivelse"
          maxLength={600}
          name={fieldNames.description}
          rows={3}
        />

        {/*
          1ah puts the price beside the image slot at a fixed 150 px. The slot exists
          since 10C-1 but is a sibling of this form (its removal control is a form of
          its own, and forms cannot nest), so the price keeps its width from `md` up
          and is full width on a phone — recorded as a 10C-1 layout departure.
        */}
        <div className="md:w-40">
          <TextField
            defaultValue={values.price}
            error={errorFor('pris')}
            id="maanedens-burger-pris"
            inputMode="decimal"
            label="Pris (kr.)"
            name={fieldNames.price}
          />
        </div>

        <fieldset aria-describedby={windowHelpId} className="flex flex-col gap-2 border-0 p-0">
          <legend className="text-neutral-ink text-meta mb-1 font-medium">Periode</legend>

          <div className="flex flex-col gap-4 md:flex-row">
            <div className="md:flex-1">
              <DateField
                defaultValue={values.startsOn}
                error={errorFor('start')}
                id="maanedens-burger-start"
                label="Startdato"
                name={fieldNames.startsOn}
              />
            </div>
            <div className="md:flex-1">
              <DateField
                defaultValue={values.endsOn}
                error={errorFor('slut')}
                id="maanedens-burger-slut"
                label="Slutdato"
                name={fieldNames.endsOn}
              />
            </div>
          </div>

          {/*
            1ah's own sentence, unchanged, because the behaviour it describes is
            unchanged: the window is a read-time filter, so nobody has to remember to
            take the burger down (§7d). It sits under both fields because it is about
            the pair.
          */}
          <p className="text-ink-3 text-micro" id={windowHelpId}>
            {MONTHLY_WINDOW_HELP} Lad begge felter stå tomme, hvis burgeren skal blive
            stående, indtil I selv ændrer den.
          </p>
        </fieldset>

        {/*
          "Vis på forsiden". A real checkbox drawn as 1ah's switch: the `<input>` is
          visually hidden inside its own `<label>`, and the track is drawn by
          `peer-checked`. Space and tab work, the state is announced as checked or not,
          the form submits with no JavaScript, and the focus ring lands on the track a
          person can see — the same control the Lørdagsmenu toggle uses.
        */}
        <div className="rounded-field border-field-border bg-field-bg flex items-center justify-between gap-3 border-[1.5px] p-3">
          <p className="min-w-0">
            <label className="text-neutral-ink font-semibold" htmlFor={homepageToggleId}>
              Vis på forsiden
            </label>
            <span className="text-ink-2 text-meta block" id={homepageHelpId}>
              {MONTHLY_HOMEPAGE_HELP}
            </span>
          </p>

          <label
            className="min-h-tap flex shrink-0 cursor-pointer items-center"
            htmlFor={homepageToggleId}
          >
            <input
              aria-describedby={homepageHelpId}
              className="peer sr-only"
              defaultChecked={values.showOnHomepage}
              id={homepageToggleId}
              name={fieldNames.showOnHomepage}
              type="checkbox"
              value="1"
            />
            {/*
              1ah's 52 × 30 track with a 24 px knob. The knob is a pseudo-element rather
              than a nested `<span>`: `peer-checked:` compiles to a general sibling
              combinator, which reaches this element but not a child of it.
            */}
            <span
              aria-hidden="true"
              className="rounded-badge bg-rule peer-checked:bg-success peer-focus-visible:outline-focus after:absolute after:top-[0.1875rem] after:left-[0.1875rem] after:size-6 after:rounded-full after:bg-white after:transition-[left] after:content-[''] peer-checked:after:left-[1.5625rem] relative inline-block h-[1.875rem] w-[3.25rem] shrink-0 transition-colors peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør.
        </p>
      </form>

      {imageSlot === undefined ? null : <div className="mt-4">{imageSlot}</div>}

      {/*
        1ah's footer control, as its own form — see the note at the top of this file.
        It is an ordinary draft change, so it says so: nothing a guest sees moves until
        somebody publishes, and the period and the two switches are left exactly as they
        stand, because they are settings rather than the words somebody types about the
        food. That is the same reading §0c records for the weekly rollover.
      */}
      <form
        action={clearForm.action}
        aria-label="Ryd felterne"
        className="border-border mt-4 flex flex-col gap-2 border-t pt-4 md:flex-row md:items-center md:justify-between md:gap-4"
      >
        <input name={clearForm.fieldNames.version} type="hidden" value={version} />

        <p className="text-ink-2 text-meta min-w-0" id={`${anchorId}-ryd-note`}>
          Rydder navn, beskrivelse og pris i kladden. Perioden, “Vis på forsiden” og
          Udsolgt står, som de gør, og hjemmesiden ændrer sig først, når du
          offentliggør.
        </p>

        {/*
          `shrink-0`: from `md` the control sits beside a sentence longer than itself, and
          a shrinkable flex item hands the room to the sentence — which broke "Ryd
          felterne" across two lines between 768 px and roughly 1024 px. The paragraph
          carries `min-w-0`, so the sentence is the one that wraps.
        */}
        <button
          aria-describedby={`${anchorId}-ryd-note`}
          className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section min-h-tap bg-surface inline-flex w-full shrink-0 items-center justify-center border-[1.5px] px-5 font-semibold md:w-auto"
          type="submit"
        >
          Ryd felterne
        </button>
      </form>
    </section>
  )
}

/**
 * The Kladde badge on the card — the phase-5 vocabulary and the phase-5 tokens (1aa).
 *
 * Warning tone, a shape of its own before the words, and the sentence itself carries the
 * meaning, so the state survives the colours being switched off. It is not a `role`
 * region: the pending band above the card is the screen's status announcement, and two
 * live regions saying the same thing would be one too many.
 */
function PendingBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-badge border-warning-border bg-warning-surface text-warning-ink inline-flex items-center gap-2 border px-3 py-1.5 text-meta font-semibold">
      <span aria-hidden="true" className="bg-warning size-2 shrink-0 rotate-45" />
      {children}
    </span>
  )
}
