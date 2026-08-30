import { TextAreaField, TextField } from '@/components/admin/Field'
import { SubmitButton } from '@/components/admin/SubmitButton'
import type { DishAvailability } from '@/lib/menu/admin'
import { describeSaturdayState } from '@/lib/menu/weekly'

import { PendingBadge } from './WeeklyDishEditor'
import { WeeklyAvailabilityBlock, type WeeklyAvailabilityForm } from './WeeklyAvailability'

/**
 * "Lørdagsmenu denne uge" — design 1ag's second card.
 *
 * Its own `<form>` posting to its own Server Action, so editing it cannot touch a
 * pending change on Ugens ret and Ugens ret cannot touch a pending change here. The two
 * cards share one database row and one `draft` column, so that separation is a rule
 * about the data rather than a layout choice — see `lib/menu/weekly.ts`.
 *
 * TWO STATES, AND THE SECOND ONE IS REAL
 *
 * 1af draws the "no Saturday menu" state as a calm dashed card reading
 * **"Ingen lørdagsmenu denne uge"**, and 1ag's toggle promises exactly that: *"Slå fra,
 * og der står 'Ingen lørdagsmenu denne uge'. Teksten bevares til næste gang."*
 *
 * That state is `sat_enabled = false` — a column the schema already provides (§4) — and
 * not an empty name or a placeholder typed into a food field. Turning the menu off
 * therefore keeps every word the kitchen wrote, which is what makes turning it back on
 * next week a single press. The frame's own note says so from the guest's side too:
 * *"Personalet sletter ingenting."*
 *
 * THE TOGGLE IS AN ORDINARY DRAFT CHANGE
 *
 * §6 defines two immediate exceptions and only two, and this is neither of them. So the
 * switch is a **checkbox inside this form**, saved with Gem, and the public card keeps
 * showing what it shows until somebody presses Offentliggør — the same rule as the dish
 * name beside it. Making it immediate would mean the hjemmeside could lose its Saturday
 * menu from a control that looks exactly like the four fields under it.
 *
 * The Udsolgt switch above the fields is the immediate one, and it is a separate form
 * for that reason.
 */

export type SaturdayEditorValues = {
  readonly enabled: boolean
  readonly name: string
  readonly description: string
  readonly price: string
  readonly deadline: string
}

export type SaturdayEditorFieldNames = {
  readonly version: string
  readonly enabled: string
  readonly name: string
  readonly description: string
  readonly price: string
  readonly deadline: string
}

export function SaturdayMenuEditor({
  anchorId,
  action,
  fieldNames,
  values,
  version,
  availability,
  availabilityForm,
  errorFor,
  pending,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  fieldNames: SaturdayEditorFieldNames
  values: SaturdayEditorValues
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  availability: DishAvailability
  availabilityForm: WeeklyAvailabilityForm
  errorFor: (
    field: 'loerdag_navn' | 'loerdag_beskrivelse' | 'loerdag_pris' | 'loerdag_frist',
  ) => string | undefined
  pending: string | null
}) {
  const headingId = `${anchorId}-titel`
  const toggleId = `${anchorId}-til`
  const stateId = `${anchorId}-tilstand`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading font-sans font-semibold" id={headingId}>
          Lørdagsmenu denne uge
        </h2>
        {pending === null ? null : <PendingBadge>{pending}</PendingBadge>}
      </div>

      <div className="mb-4">
        <WeeklyAvailabilityBlock
          availability={availability}
          form={availabilityForm}
          immediateNote="Udsolgt slår igennem med det samme"
          label="Lørdagsmenuen"
          target="saturday"
          version={version}
        />
      </div>

      <form action={action} aria-label="Lørdagsmenu denne uge" className="flex flex-col gap-4">
        <input name={fieldNames.version} type="hidden" value={version} />

        {/*
          The on/off control. A real checkbox drawn as 1ag's switch: the `<input>` is
          visually hidden inside its own `<label>`, and the track is drawn by
          `peer-checked`. Space and tab work, the state is announced as checked or not,
          the form submits with no JavaScript, and the focus ring lands on the track a
          person can see.

          The sentence beneath it is `describeSaturdayState`, which quotes the public
          card word for word — so the promise the administration makes and the text a
          guest reads are the same string.
        */}
        <div className="rounded-field border-field-border bg-field-bg flex items-center justify-between gap-3 border-[1.5px] p-3">
          <p className="min-w-0">
            <label className="text-neutral-ink font-semibold" htmlFor={toggleId}>
              Der er lørdagsmenu denne uge
            </label>
            <span className="text-ink-2 text-meta block" id={stateId}>
              {describeSaturdayState(values.enabled)}
            </span>
          </p>

          <label className="min-h-tap flex shrink-0 cursor-pointer items-center" htmlFor={toggleId}>
            <input
              aria-describedby={stateId}
              className="peer sr-only"
              defaultChecked={values.enabled}
              id={toggleId}
              name={fieldNames.enabled}
              type="checkbox"
              value="1"
            />
            {/*
              1ag's 56 × 32 track with a 26 px knob. The knob is a pseudo-element rather
              than a nested `<span>`: `peer-checked:` compiles to a general sibling
              combinator, which reaches this element but not a child of it — the same
              reason `LabelFields` draws its tick with `peer-checked:before`.
            */}
            <span
              aria-hidden="true"
              className="rounded-badge bg-rule peer-checked:bg-success peer-focus-visible:outline-focus after:absolute after:top-[0.1875rem] after:left-[0.1875rem] after:size-[1.625rem] after:rounded-full after:bg-white after:transition-[left] after:content-[''] peer-checked:after:left-[1.6875rem] relative inline-block h-8 w-14 shrink-0 transition-colors peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2"
            />
          </label>
        </div>

        <TextField
          defaultValue={values.name}
          error={errorFor('loerdag_navn')}
          id="loerdag-navn"
          label="Retnavn"
          maxLength={200}
          name={fieldNames.name}
        />

        <TextAreaField
          defaultValue={values.description}
          error={errorFor('loerdag_beskrivelse')}
          hint="Kort beskrivelse."
          id="loerdag-beskrivelse"
          label="Beskrivelse"
          maxLength={600}
          name={fieldNames.description}
          rows={3}
        />

        <div className="flex flex-col gap-4 md:flex-row">
          <div className="md:flex-1">
            <TextField
              defaultValue={values.price}
              error={errorFor('loerdag_pris')}
              id="loerdag-pris"
              inputMode="decimal"
              label="Pris (kr.)"
              name={fieldNames.price}
            />
          </div>
          {/*
            1ag draws the deadline as a dropdown showing "Fredag kl. 00:00". The column is
            `sat_deadline text` — free text, with no weekday or time part the schema can
            offer a list of — so it is a field rather than a select of values nobody has
            approved. The hint carries the frame's own example so the wording stays
            consistent without being fixed.
          */}
          <div className="md:flex-[1.4]">
            <TextField
              defaultValue={values.deadline}
              error={errorFor('loerdag_frist')}
              hint="Fx “Bestilling senest fredag kl. 12:00”. Lad feltet stå tomt, hvis der ingen frist er."
              id="loerdag-frist"
              label="Bestillingsfrist (valgfrit)"
              maxLength={120}
              name={fieldNames.deadline}
            />
          </div>
        </div>

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
