import Link from 'next/link'

import { SelectField, TextAreaField, TextField } from '@/components/admin/Field'
import { SubmitButton } from '@/components/admin/SubmitButton'
import type { AdminCategory } from '@/lib/menu/admin'

import { LabelFields } from './LabelFields'

/**
 * The dish editor — design 1r (side panel) and 1y (the editor a phone opens).
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration. Which dish is open is in the URL (`?ret=…`), so the panel is a
 * Server Component with nothing to remember, the browser's back button closes it, and
 * the whole screen works with no JavaScript.
 *
 * FOCUS, WITHOUT MANAGING FOCUS
 *
 * Opening the panel is a navigation to `#ret-editor`, so the browser scrolls to the
 * panel and continues the tab order from it — the behaviour a side panel needs, with
 * nothing to restore on close because closing is a navigation too. The panel is a
 * `<section>` labelled by its own heading rather than a dialog, because it does not
 * trap: on desktop the list stays beside it, and on a phone the panel *is* the screen
 * (the list is hidden at that width by the page), which is 1y's treatment rather than a
 * narrowed version of 1r's.
 *
 * THE VERSION TOKEN
 *
 * `version` carries the `updated_at` this form was rendered from. It is the whole of
 * optimistic concurrency (§6): the version a person started from travels with their
 * edit, and the save refuses if the row moved on rather than overwriting a colleague.
 * A new dish has no version, so the field is absent and the form posts to the create
 * action instead.
 */

export type DishEditorValues = {
  readonly name: string
  readonly price: string
  readonly categoryId: string
  readonly description: string
  readonly secondaryNote: string
  readonly standardLabels: readonly string[]
  readonly customLabels: readonly string[]
}

export function DishEditorPanel({
  anchorId,
  heading,
  action,
  categories,
  values,
  dishId,
  version,
  closeHref,
  fieldNames,
  errorFor,
  soldOut,
  isNewDraft,
}: {
  anchorId: string
  heading: string
  action: (formData: FormData) => Promise<void>
  categories: readonly AdminCategory[]
  values: DishEditorValues
  /** Absent when the dish does not exist yet. */
  dishId?: string
  version?: string
  closeHref: string
  fieldNames: {
    dishId: string
    version: string
    name: string
    price: string
    category: string
    description: string
    secondaryNote: string
    standardLabel: string
    customLabel: string
  }
  /** The message for one field, or undefined. Bound with `aria-describedby`. */
  errorFor: (field: 'navn' | 'pris' | 'sektion' | 'maerkater') => string | undefined
  /** Display only in phase 5B — the Udsolgt action is the next increment (§6). */
  soldOut?: boolean
  isNewDraft?: boolean
}) {
  return (
    <section
      aria-labelledby={`${anchorId}-titel`}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-heading font-sans font-semibold" id={`${anchorId}-titel`}>
          {heading}
        </h2>
        <Link
          className="text-ink-2 hover:text-ink min-h-tap -mr-2 inline-flex items-center px-2 text-meta font-medium"
          href={closeHref}
        >
          Luk
        </Link>
      </div>

      <form action={action} aria-label={heading} className="flex flex-col gap-4">
        {dishId === undefined ? null : (
          <input name={fieldNames.dishId} type="hidden" value={dishId} />
        )}
        {version === undefined ? null : (
          <input name={fieldNames.version} type="hidden" value={version} />
        )}

        <TextField
          defaultValue={values.name}
          error={errorFor('navn')}
          id="ret-navn"
          label="Navn"
          maxLength={200}
          name={fieldNames.name}
          required
        />

        <div className="flex flex-col gap-4 md:flex-row">
          <div className="md:flex-1">
            <TextField
              defaultValue={values.price}
              error={errorFor('pris')}
              hint="Skriv prisen i kroner, fx 89 eller 89,50. Lad feltet stå tomt, hvis retten ikke har en fast pris."
              id="ret-pris"
              inputMode="decimal"
              label="Pris (kr.)"
              name={fieldNames.price}
            />
          </div>
          <div className="md:flex-1">
            <SelectField
              defaultValue={values.categoryId}
              error={errorFor('sektion')}
              hint="Skift sektion — retten flytter først på hjemmesiden, når ændringen offentliggøres."
              id="ret-sektion"
              label="Kategori"
              name={fieldNames.category}
              options={categories.map((category) => ({
                value: category.id,
                label: category.name,
              }))}
            />
          </div>
        </div>

        <TextAreaField
          defaultValue={values.description}
          hint="Skriv det, som du ville sige det til en gæst."
          id="ret-beskrivelse"
          label="Beskrivelse"
          maxLength={600}
          name={fieldNames.description}
        />

        {/*
          The confirmed secondary-note decision. `dishes.secondary_note` already exists
          and is already rendered publicly — 1h prints "Som menu med pommes frites og
          sodavand 124 kr." beneath a burger and "1 kg · frost" under a Varm selv item —
          so this field gives staff the column the site has been showing all along. It
          is deliberately its own field rather than a paragraph inside Beskrivelse: the
          public menu styles the two differently, and merging them would put a price
          note in the middle of a sentence about the food.
        */}
        <TextField
          defaultValue={values.secondaryNote}
          hint="Den lille grå linje under retten. Fx “Som menu med pommes frites og sodavand 124 kr.” eller “1 kg · frost”."
          id="ret-ekstra-linje"
          label="Ekstra linje (valgfrit)"
          maxLength={200}
          name={fieldNames.secondaryNote}
        />

        <LabelFields
          custom={values.customLabels}
          error={errorFor('maerkater')}
          fieldNames={{ standard: fieldNames.standardLabel, custom: fieldNames.customLabel }}
          standard={values.standardLabels}
        />

        {dishId === undefined ? null : (
          <AvailabilityNotice isNewDraft={isNewDraft === true} soldOut={soldOut === true} />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            className="rounded-field border-field-border text-neutral-ink hover:border-rule min-h-tap inline-flex items-center border-[1.5px] px-4 font-semibold"
            href={closeHref}
          >
            Fortryd
          </Link>
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør
          ændringer.
        </p>
      </form>
    </section>
  )
}

/**
 * Tilgængelig / Udsolgt, shown as the state it currently is.
 *
 * 1r draws a switch here, and the switch is the immediate path with a 10-second Fortryd
 * (§6). That interaction is the next increment; until it exists the slot reports the
 * state the dish actually has rather than offering a control that would do nothing.
 * Saying so is better than an inert toggle a person will press twice.
 */
function AvailabilityNotice({ soldOut, isNewDraft }: { soldOut: boolean; isNewDraft: boolean }) {
  if (isNewDraft) {
    return (
      <p className="rounded-field border-warning-border bg-warning-surface text-warning-ink border px-3 py-2 text-meta font-medium">
        <span aria-hidden="true" className="bg-warning mr-2 inline-block size-2 rotate-45" />
        Ny ret — den vises først på hjemmesiden, når du offentliggør den.
      </p>
    )
  }

  return (
    <p
      className={`rounded-field border px-3 py-2 text-meta font-medium ${
        soldOut
          ? 'border-error-border bg-error-surface text-error-ink'
          : 'border-success-border bg-success-surface text-success-ink'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mr-2 inline-block size-2 rounded-full ${
          soldOut ? 'border-error border-2' : 'bg-success'
        }`}
      />
      {soldOut
        ? 'Retten står som udsolgt på hjemmesiden.'
        : 'Retten er tilgængelig på hjemmesiden.'}
    </p>
  )
}
