import {
  AvailabilityResetNote,
  StateDot,
  SwitchTrack,
} from '@/components/admin/menu/AvailabilitySwitch'
import type { DishAvailability } from '@/lib/menu/admin'
import type { WeeklySoldOutTarget } from '@/lib/menu/weekly'

/**
 * Tilgængelig / Udsolgt on Ugens ret and on Lørdagsmenuen — design 1ag.
 *
 * The frame draws the same green block on both cards, with the same switch the dish
 * rows use in 1r and a different helper line under each: *"Ændres straks på
 * hjemmesiden"* on Ugens ret, *"Udsolgt slår igennem med det samme"* on Lørdagsmenuen.
 * Both are 1ag's own words, so both are here rather than one of them being reworded to
 * match the other.
 *
 * WHY IT IS A BUTTON AND NOT `role="switch"`
 *
 * The same reason `AvailabilitySwitch` gives for a dish: this submits a form and the
 * page comes back changed, and the control's name *is* its state. A `role="switch"`
 * promises an in-place flip and a fixed name plus on/off, which is the one shape this
 * is not. So it is a button whose accessible name says where the card stands and what
 * pressing will do — *"Tilgængelig — Ugens ret. Skift til udsolgt."*
 *
 * ICON, TEXT *AND* COLOUR (1aa)
 *
 * The knob's position, the words beside it and the small mark before them each carry
 * the state on their own, so it survives the colours being switched off. A filled dot
 * is available, a ring is sold out — the same two shapes the public menu's badge uses.
 *
 * WHY IT IS ITS OWN FORM
 *
 * HTML forms cannot nest, and this must post somewhere else than Gem: Gem writes a
 * draft that waits for Offentliggør, and this changes the hjemmeside immediately (§6).
 * So the block is a **sibling** of the card's editor form, placed above the fields, so
 * the single exception is never buried among the fields that all follow the ordinary
 * three-step rule.
 *
 * NOTHING IS DECIDED HERE. `availability` is computed by `describeAvailability` from the
 * same `resolveSoldOut` the public menu uses, so the administration and the hjemmeside
 * cannot disagree about whether Ugens ret is sold out or about when the marking lifts.
 */

/**
 * Where a submission goes, and under which names.
 *
 * Passed in rather than imported: a component in `components/` reaching into `app/`
 * would be the dependency the wrong way round, and the screen that owns the action owns
 * the vocabulary it reads, in one file.
 */
export type WeeklyAvailabilityForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly target: string
    readonly version: string
    readonly soldOut: string
  }
}

/**
 * The hidden fields every weekly availability submission carries.
 *
 * `soldOut` is the state being *asked for* — the opposite of the current one. The
 * browser never sends a date: §7b's "today, in Copenhagen" is the server's to decide.
 */
export function WeeklyAvailabilityFields({
  fieldNames,
  target,
  version,
  soldOut,
}: {
  fieldNames: WeeklyAvailabilityForm['fieldNames']
  target: WeeklySoldOutTarget
  version: string
  soldOut: boolean
}) {
  return (
    <>
      <input name={fieldNames.target} type="hidden" value={target} />
      <input name={fieldNames.version} type="hidden" value={version} />
      <input name={fieldNames.soldOut} type="hidden" value={soldOut ? '1' : '0'} />
    </>
  )
}

export function WeeklyAvailabilityBlock({
  form,
  target,
  /** What this card is called, for the control's accessible name. */
  label,
  /** 1ag's own helper line for this card. */
  immediateNote,
  version,
  availability,
}: {
  form: WeeklyAvailabilityForm
  target: WeeklySoldOutTarget
  label: string
  immediateNote: string
  /** The `updated_at` the screen was rendered from — the concurrency token (§6). */
  version: string
  availability: DishAvailability
}) {
  const { soldOut, resetText } = availability

  return (
    <form
      action={form.action}
      aria-label={`Tilgængelighed — ${label}`}
      className={`rounded-field flex flex-col gap-3 border-[1.5px] p-3 ${
        soldOut ? 'border-field-border bg-surface-muted' : 'border-success-border bg-success-surface'
      }`}
    >
      <WeeklyAvailabilityFields
        fieldNames={form.fieldNames}
        soldOut={!soldOut}
        target={target}
        version={version}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0">
          <span
            className={`flex items-center gap-2 font-semibold ${
              soldOut ? 'text-ink-2' : 'text-success-ink'
            }`}
          >
            <StateDot soldOut={soldOut} />
            {soldOut ? 'Udsolgt i dag' : 'Tilgængelig'}
          </span>
          <span className={`text-meta ${soldOut ? 'text-ink-2' : 'text-success-ink-2'}`}>
            {immediateNote}
          </span>
        </p>

        <button
          className="rounded-field border-field-border bg-surface min-h-tap inline-flex shrink-0 items-center border-[1.5px] px-3"
          type="submit"
        >
          <SwitchTrack soldOut={soldOut} />
          {/* The visible words are in the line beside the switch, so the button's own
              name is carried for a screen reader — and it names the card, because two
              identical "Tilgængelig" controls sit on this one screen. */}
          <span className="sr-only">
            {soldOut ? 'Udsolgt' : 'Tilgængelig'} — {label}.{' '}
            {soldOut ? 'Skift til tilgængelig.' : 'Skift til udsolgt.'}
          </span>
        </button>
      </div>

      {resetText === null ? null : <AvailabilityResetNote>{resetText}</AvailabilityResetNote>}
    </form>
  )
}
