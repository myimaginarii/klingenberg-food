import { TextAreaField, TextField } from '@/components/admin/Field'
import { SubmitButton } from '@/components/admin/SubmitButton'
import type { DishAvailability } from '@/lib/menu/admin'
import type { IsoWeek } from '@/lib/time/iso-week'

import { ServingDaysField, WeekNumberField, WeekNumberHint } from './WeekFields'
import { WeeklyAvailabilityBlock, type WeeklyAvailabilityForm } from './WeeklyAvailability'

/**
 * Ugens ret — design 1ag's first card.
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration: no client component, no controlled inputs, no state library, and
 * nothing in the browser that has to be kept in step with the server. The card is a
 * `<section>` labelled by its own heading, so the screen has one `<h1>` in the bar and
 * two named regions beneath it.
 *
 * THE FIELDS ARE THE FRAME'S, AND ONLY THE FRAME'S
 *
 * Ugenummer, the seven serving days, Retnavn, Beskrivelse, Lille portion and Stor
 * portion. Nothing is added: no dish name, no price, no date, no ingredient and no
 * dietary claim is invented anywhere in this phase, and no field exists that the
 * `weekly_special` columns do not already have.
 *
 * **The image slot arrived in phase 10C-1**, as `imageSlot` below — the shared
 * `ImagePickerField` over 1ag's "Billede (valgfrit)". It is deliberately not a field
 * of this form: the selection is its own draft write with its own action, so
 * `image_id` remains outside {@link WEEK_EDITOR_FIELDS} and a Gem here still cannot
 * wipe a pending photo, exactly as before the slot existed.
 *
 * THE GLUTEN AND LACTOSE NOTE IS INFORMATION, NOT A FIELD
 *
 * 1ag states it as a standing note: *"Teksten … står altid i denne sektion. Den skrives
 * ikke pr. ret og gælder ikke resten af menuen."* It is the menu section's own `note`
 * column, seeded once (`supabase/seed.sql`) and printed by the public menu under Ugens
 * ret. So this card shows it as the frame does — as a reminder of a rule — and offers no
 * control for it, which is what stops it being written per dish or widened to the rest
 * of the menu.
 *
 * THE AVAILABILITY BLOCK IS A SIBLING, NOT A FIELD
 *
 * Forms cannot nest, and it posts somewhere else than Gem: Gem writes a draft that waits
 * for Offentliggør, and Udsolgt changes the hjemmeside immediately (§6). It is placed
 * above the fields so the single exception is not buried among the fields that all
 * follow the ordinary three-step rule.
 */

/** The id the week field points at with `aria-describedby`. */
const WEEK_HINT_ID = 'ugens-ret-uge-hjaelp'

export type WeekEditorValues = {
  readonly week: string
  readonly days: readonly string[]
  readonly name: string
  readonly description: string
  readonly priceSmall: string
  readonly priceLarge: string
}

export type WeekEditorFieldNames = {
  readonly version: string
  readonly week: string
  readonly day: string
  readonly name: string
  readonly description: string
  readonly priceSmall: string
  readonly priceLarge: string
}

export function WeeklyDishEditor({
  anchorId,
  action,
  fieldNames,
  values,
  version,
  weekOptions,
  selectedWeek,
  thisWeek,
  liveWeek,
  availability,
  availabilityForm,
  errorFor,
  pending,
  imageSlot,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  fieldNames: WeekEditorFieldNames
  values: WeekEditorValues
  /** The `updated_at` this form was rendered from — the concurrency token (§6). */
  version: string
  weekOptions: readonly IsoWeek[]
  selectedWeek: IsoWeek | null
  thisWeek: IsoWeek
  liveWeek: IsoWeek | null
  availability: DishAvailability
  availabilityForm: WeeklyAvailabilityForm
  /** The message for one field, or undefined. Bound with `aria-describedby`. */
  errorFor: (field: 'uge' | 'navn' | 'beskrivelse' | 'pris_lille' | 'pris_stor') => string | undefined
  /** The Kladde line for this card, or null when nothing is pending. */
  pending: string | null
  /**
   * 1ag's "Billede (valgfrit)" slot (phase 10C-1) — `ImagePickerField`, rendered by
   * the page. A sibling of the Gem form, not a field inside it: its removal control
   * is a form of its own, forms cannot nest, and the selection is its own draft
   * write exactly as reordering is — so a Gem here can never clear a pending photo,
   * and choosing a photo can never overwrite a half-typed description.
   */
  imageSlot?: React.ReactNode
}) {
  const headingId = `${anchorId}-titel`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading font-sans font-semibold" id={headingId}>
          Ugens ret
        </h2>
        {pending === null ? null : <PendingBadge>{pending}</PendingBadge>}
      </div>

      <div className="mb-4">
        <WeeklyAvailabilityBlock
          availability={availability}
          form={availabilityForm}
          immediateNote="Ændres straks på hjemmesiden"
          label="Ugens ret"
          target="week"
          version={version}
        />
      </div>

      <form action={action} aria-label="Ugens ret" className="flex flex-col gap-4">
        <input name={fieldNames.version} type="hidden" value={version} />

        {/*
          1ag puts the week number and the day row side by side, with the dropdown at a
          fixed width. On a phone they stack, because seven day boxes and a dropdown do
          not share 375 px without one of them being crushed — and the day row is the one
          that must stay 44 px tall and tappable.
        */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-4 md:flex-row md:gap-3.5">
            <div className="md:w-36 md:shrink-0">
              <WeekNumberField
                error={errorFor('uge')}
                hintId={WEEK_HINT_ID}
                id="ugens-ret-uge"
                name={fieldNames.week}
                options={weekOptions}
                selected={selectedWeek}
                thisWeek={thisWeek}
              />
            </div>
            <div className="min-w-0 md:flex-1">
              <ServingDaysField name={fieldNames.day} selected={values.days} />
            </div>
          </div>

          <WeekNumberHint id={WEEK_HINT_ID} liveWeek={liveWeek} thisWeek={thisWeek} />
        </div>

        <TextField
          defaultValue={values.name}
          error={errorFor('navn')}
          hint="Lad feltet stå tomt, hvis ugens ret ikke er skrevet endnu. Så vises kortet ikke på hjemmesiden."
          id="ugens-ret-navn"
          label="Retnavn"
          maxLength={200}
          name={fieldNames.name}
        />

        <TextAreaField
          defaultValue={values.description}
          error={errorFor('beskrivelse')}
          hint="Kort beskrivelse — 1–2 linjer, skrevet som du ville sige det til en gæst."
          id="ugens-ret-beskrivelse"
          label="Beskrivelse"
          maxLength={600}
          name={fieldNames.description}
          rows={3}
        />

        <div className="flex flex-col gap-4 md:flex-row">
          <div className="md:flex-1">
            <TextField
              defaultValue={values.priceSmall}
              error={errorFor('pris_lille')}
              id="ugens-ret-pris-lille"
              inputMode="decimal"
              label="Lille portion (kr.)"
              name={fieldNames.priceSmall}
            />
          </div>
          <div className="md:flex-1">
            <TextField
              defaultValue={values.priceLarge}
              error={errorFor('pris_stor')}
              id="ugens-ret-pris-stor"
              inputMode="decimal"
              label="Stor portion (kr.)"
              name={fieldNames.priceLarge}
            />
          </div>
        </div>

        <GlutenAndLactoseNote />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Gem</SubmitButton>
        </div>

        <p className="text-ink-3 text-micro">
          Gem laver en kladde. Hjemmesiden ændrer sig først, når du trykker Offentliggør.
        </p>
      </form>

      {imageSlot === undefined ? null : <div className="mt-4">{imageSlot}</div>}
    </section>
  )
}

/**
 * 1ag's standing note about gluten and lactose.
 *
 * The frame's own words, and the frame's own point: the sentence belongs to **this
 * section** and is not written per dish, so there is no field for it here and no way for
 * it to end up on the rest of the menu. It is drawn as the frame draws it — an
 * information block with a mark of its own, so it is never carried by colour alone
 * (1aa) — and it is `<aside>` rather than a paragraph inside the fields, because it is
 * about the section rather than about the value beside it.
 */
function GlutenAndLactoseNote() {
  return (
    <aside className="rounded-field border-announce-border bg-announce-surface text-brand-700 flex items-start gap-2.5 border px-3 py-2.5">
      <span
        aria-hidden="true"
        className="bg-brand-700 mt-0.5 flex size-[1.125rem] shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold text-white"
      >
        i
      </span>
      <span className="text-meta font-medium">
        Teksten “Alle ugens retter kan også laves glutenfrie og laktosefrie” står altid i
        denne sektion. Den skrives ikke pr. ret og gælder ikke resten af menuen.
      </span>
    </aside>
  )
}

/**
 * The Kladde badge on a card — the phase-5 vocabulary and the phase-5 tokens (1aa).
 *
 * Warning tone, a shape of its own before the words, and the sentence itself carries the
 * meaning, so the state survives the colours being switched off. It is not a `role`
 * region: the pending band above the cards is the screen's status announcement, and two
 * live regions saying the same thing would be one too many.
 */
export function PendingBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-badge border-warning-border bg-warning-surface text-warning-ink inline-flex items-center gap-2 border px-3 py-1.5 text-meta font-semibold">
      <span aria-hidden="true" className="bg-warning size-2 shrink-0 rotate-45" />
      {children}
    </span>
  )
}
