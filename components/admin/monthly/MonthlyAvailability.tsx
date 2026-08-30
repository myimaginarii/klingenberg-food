import {
  AvailabilityResetNote,
  StateDot,
  SwitchTrack,
} from '@/components/admin/menu/AvailabilitySwitch'
import type { DishAvailability } from '@/lib/menu/admin'

/**
 * Tilgængelig / Udsolgt on Månedens burger — design 1ah.
 *
 * The frame draws the green block with the same switch the dish rows use in 1r, and its
 * own helper line beneath the state: *"Udsolgt slår igennem straks"*. Those are 1ah's
 * own words and they are here rather than reworded to match another screen's.
 *
 * WHY IT IS A BUTTON AND NOT `role="switch"`
 *
 * The same reason `AvailabilitySwitch` gives for a dish: this submits a form and the
 * page comes back changed, and the control's name *is* its state. A `role="switch"`
 * promises an in-place flip and a fixed name plus on/off, which is the one shape this is
 * not. So it is a button whose accessible name says where the burger stands and what
 * pressing will do — *"Tilgængelig — Månedens burger. Skift til udsolgt."*
 *
 * ICON, TEXT *AND* COLOUR (1aa)
 *
 * The knob's position, the words beside it and the small mark before them each carry the
 * state on their own, so it survives the colours being switched off. A filled dot is
 * available, a ring is sold out — the same two shapes the public menu's badge uses.
 *
 * WHY IT IS ITS OWN FORM, AND WHY IT IS ABOVE THE FIELDS
 *
 * HTML forms cannot nest, and this must post somewhere else than Gem: Gem writes a draft
 * that waits for Offentliggør, and this changes the hjemmeside immediately (§6). So the
 * block is a **sibling** of the card's editor form, placed above the fields — 1ah draws
 * it between the dates and "Vis på forsiden", and putting it first is the one
 * arrangement that keeps the single exception visually separate from the fields that all
 * follow the ordinary three-step rule, which is what 1aa's own note asks for in words.
 *
 * NOTHING IS DECIDED HERE. `availability` is computed by `describeAvailability` from the
 * same `resolveSoldOut` the public menu uses, so the administration and the hjemmeside
 * cannot disagree about whether the burger is sold out or about when the marking lifts.
 */

/**
 * Where a submission goes, and under which names.
 *
 * Passed in rather than imported: a component in `components/` reaching into `app/`
 * would be the dependency the wrong way round, and the screen that owns the action owns
 * the vocabulary it reads, in one file.
 */
export type MonthlyAvailabilityForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly version: string
    readonly soldOut: string
  }
}

/** What this control is called wherever a sentence has to name it. */
export const MONTHLY_AVAILABILITY_LABEL = 'Månedens burger'

/**
 * The hidden fields every monthly availability submission carries.
 *
 * `soldOut` is the state being *asked for* — the opposite of the current one. The
 * browser never sends a date: §7b's "today, in Copenhagen" is the server's to decide.
 */
export function MonthlyAvailabilityFields({
  fieldNames,
  version,
  soldOut,
}: {
  fieldNames: MonthlyAvailabilityForm['fieldNames']
  version: string
  soldOut: boolean
}) {
  return (
    <>
      <input name={fieldNames.version} type="hidden" value={version} />
      <input name={fieldNames.soldOut} type="hidden" value={soldOut ? '1' : '0'} />
    </>
  )
}

export function MonthlyAvailabilityBlock({
  form,
  version,
  availability,
}: {
  form: MonthlyAvailabilityForm
  /** The `updated_at` the screen was rendered from — the concurrency token (§6). */
  version: string
  availability: DishAvailability
}) {
  const { soldOut, resetText } = availability

  return (
    <form
      action={form.action}
      aria-label={`Tilgængelighed — ${MONTHLY_AVAILABILITY_LABEL}`}
      className={`rounded-field flex flex-col gap-3 border-[1.5px] p-3 ${
        soldOut ? 'border-field-border bg-surface-muted' : 'border-success-border bg-success-surface'
      }`}
    >
      <MonthlyAvailabilityFields
        fieldNames={form.fieldNames}
        soldOut={!soldOut}
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
            Udsolgt slår igennem straks
          </span>
        </p>

        <button
          className="rounded-field border-field-border bg-surface min-h-tap inline-flex shrink-0 items-center border-[1.5px] px-3"
          type="submit"
        >
          <SwitchTrack soldOut={soldOut} />
          {/* The visible words are in the line beside the switch, so the button's own
              name is carried for a screen reader — and it names the burger, because the
              same words appear on three screens of this administration. */}
          <span className="sr-only">
            {soldOut ? 'Udsolgt' : 'Tilgængelig'} — {MONTHLY_AVAILABILITY_LABEL}.{' '}
            {soldOut ? 'Skift til tilgængelig.' : 'Skift til udsolgt.'}
          </span>
        </button>
      </div>

      {resetText === null ? null : <AvailabilityResetNote>{resetText}</AvailabilityResetNote>}

      {/*
        The one thing the switch does *not* do, said where somebody might assume it does.
        A sold-out burger stays on the menu and on the forside carrying "Udsolgt i dag";
        it is not a way to take the burger down (§7b, §7d). The way to do that is the
        period above.
      */}
      <p className={`text-micro ${soldOut ? 'text-ink-3' : 'text-success-ink-2'}`}>
        Burgeren bliver stående på menuen og forsiden med “Udsolgt i dag”. Bestil-knappen
        forsvinder, indtil I åbner igen.
      </p>
    </form>
  )
}
