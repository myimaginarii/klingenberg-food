import type { DishAvailability } from '@/lib/menu/admin'

/**
 * Tilgængelig / Udsolgt — design 1r (row and side panel), 1y (card and editor).
 *
 * The approved frames draw a switch, and this is drawn as one: the track, the knob and
 * the two colours are 1r's. Underneath it is a plain submit `<button>` inside its own
 * `<form>`, which is what makes it work with the keyboard, with a screen reader and
 * with JavaScript switched off — a form submission is all it does.
 *
 * WHY IT IS A BUTTON AND NOT `role="switch"`
 *
 * `role="switch"` promises a state that flips in place, and announces itself with a
 * fixed name plus on/off. This control submits a form and the page comes back changed,
 * and the two frames give it a name that *is* the state ("Tilgængelig", "Udsolgt") —
 * a switch whose own label changes with its value is the one shape the role does not
 * describe. So it is a button, and its accessible name says both where the dish stands
 * and what pressing will do: *"Tilgængelig — Thor. Skift til udsolgt."* The visible
 * word is the first thing in that name, which is what WCAG 2.5.3 asks of a control
 * whose visible label is text.
 *
 * ICON, TEXT *AND* COLOUR (1aa)
 *
 * The knob's position, the word beside it and the small mark before that word each
 * carry the state on their own, so it survives the colours being switched off or being
 * unable to tell green from grey. A filled dot is available, a ring is sold out — the
 * same two shapes the public menu's badge uses.
 *
 * WHY IT IS ITS OWN FORM, AND WHERE THE BLOCK SITS IN THE PANEL
 *
 * HTML forms cannot nest, and this must post somewhere else than Gem: Gem writes a
 * draft that waits for Offentliggør, and this changes the hjemmeside immediately (§6).
 * So in the editor panel the block is a sibling of the dish form rather than a row
 * inside it, and it is placed **above** the fields, directly under the heading. 1r
 * draws it lower, just above the buttons; putting it first is the one arrangement that
 * keeps the single exception visually separate from the fields that all follow the
 * ordinary three-step rule, which is what 1aa's own note asks for in words.
 *
 * NOTHING IS DECIDED HERE. `availability` is computed by `describeAvailability` from
 * the same `resolveSoldOut` the public menu uses; this component receives an answer.
 */

/**
 * The mark before the word. Shape, so the state is never colour alone (1aa).
 *
 * Exported since phase 6A: 1ag draws the same switch on Ugens ret and on Lørdagsmenuen,
 * and those act on `weekly_special` rather than on a dish (`components/admin/weekly/`).
 * The *presentation* is genuinely one control and is therefore shared; the operations
 * stay two, each with its own action, its own field names and its own database function
 * — the same line `UndoStrip` draws between a green bar and what put it there.
 */
export function StateDot({ soldOut }: { soldOut: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 rounded-full ${soldOut ? 'border-error border-2' : 'bg-success'}`}
    />
  )
}

/**
 * 1r's switch: a 52 × 28 track with the knob at the end the state puts it.
 *
 * Exported since phase 6A, for the reason {@link StateDot} is.
 */
export function SwitchTrack({ soldOut }: { soldOut: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`rounded-badge relative inline-block h-7 w-[3.25rem] shrink-0 transition-colors ${
        soldOut ? 'bg-rule' : 'bg-success'
      }`}
    >
      <span
        className={`absolute top-[0.1875rem] size-[1.375rem] rounded-full bg-white transition-[left] ${
          soldOut ? 'left-[0.1875rem]' : 'left-[1.6875rem]'
        }`}
      />
    </span>
  )
}

/** What pressing the control will do, in Danish, for the accessible name. */
function actionSentence(soldOut: boolean, dishName: string): string {
  return soldOut ? `— ${dishName}. Skift til tilgængelig.` : `— ${dishName}. Skift til udsolgt.`
}

/**
 * Where a submission goes, and under which names.
 *
 * Both halves are passed in rather than imported. A component in `components/` reaching
 * into `app/` would be the dependency the wrong way round — the same reason
 * `DishEditorPanel` takes `fieldNames` instead of importing `DISH_FORM` — and it also
 * means the screen that owns the action owns the vocabulary it reads, in one file.
 */
export type AvailabilityForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly dishId: string
    readonly version: string
    readonly soldOut: string
    readonly section: string
    readonly editorOpen: string
  }
}

export type AvailabilitySwitchProps = {
  form: AvailabilityForm
  dishId: string
  /** Named in the control's accessible name, so a list of rows is unambiguous. */
  dishName: string
  /** The `updated_at` this screen was rendered from — the concurrency token (§6). */
  version: string
  availability: DishAvailability
  /** The section chip to reopen afterwards. Navigation only. */
  section?: string | null
  /** True when the control is inside the open editor panel. */
  editorOpen?: boolean
}

/**
 * The hidden fields every availability submission carries.
 *
 * `soldOut` here is the state being *asked for* — the opposite of the current one. The
 * browser never sends a date: §7b's "today, in Copenhagen" is the server's to decide.
 */
export function AvailabilityFields({
  fieldNames,
  dishId,
  version,
  soldOut,
  section,
  editorOpen,
}: {
  fieldNames: AvailabilityForm['fieldNames']
  dishId: string
  version: string
  soldOut: boolean
  section?: string | null
  editorOpen?: boolean
}) {
  return (
    <>
      <input name={fieldNames.dishId} type="hidden" value={dishId} />
      <input name={fieldNames.version} type="hidden" value={version} />
      <input name={fieldNames.soldOut} type="hidden" value={soldOut ? '1' : '0'} />
      {section ? <input name={fieldNames.section} type="hidden" value={section} /> : null}
      {editorOpen === true ? <input name={fieldNames.editorOpen} type="hidden" value="1" /> : null}
    </>
  )
}

/**
 * The compact control in a dish row (1r) and a dish card (1y).
 *
 * 44 px on the phone and 48 px from `md`, which is the height the row's price field is
 * already drawn at, so the two sit level.
 */
export function AvailabilitySwitch({
  form,
  dishId,
  dishName,
  version,
  availability,
  section,
  editorOpen,
}: AvailabilitySwitchProps) {
  const { soldOut } = availability

  return (
    <form action={form.action} className="shrink-0">
      <AvailabilityFields
        dishId={dishId}
        editorOpen={editorOpen}
        fieldNames={form.fieldNames}
        section={section}
        soldOut={!soldOut}
        version={version}
      />
      <button
        className={`rounded-field min-h-tap text-meta flex items-center gap-2 border-[1.5px] px-3 font-semibold md:min-h-12 ${
          soldOut
            ? 'border-field-border bg-surface-muted text-ink-2'
            : 'border-success-border bg-success-surface text-success-ink'
        }`}
        type="submit"
      >
        <SwitchTrack soldOut={soldOut} />
        <StateDot soldOut={soldOut} />
        <span>{soldOut ? 'Udsolgt' : 'Tilgængelig'}</span>
        {/* One word is ambiguous in a list of six rows; the dish and the outcome are not. */}
        <span className="sr-only">{actionSentence(soldOut, dishName)}</span>
      </button>
    </form>
  )
}

/**
 * The block in the editor panel — 1r's side panel and 1y's editor.
 *
 * Same control, more room: the state as a line of its own, the design's "Ændres straks
 * på hjemmesiden" beneath it, and — when the dish is sold out — the §7b reset sentence,
 * which is the reason this block is worth the space. The frame draws no word on the
 * switch here because the line beside it already carries one, so the button's name is
 * carried for a screen reader alone.
 */
export function AvailabilityBlock({
  form,
  dishId,
  dishName,
  version,
  availability,
  section,
}: AvailabilitySwitchProps) {
  const { soldOut, resetText } = availability

  return (
    <form
      action={form.action}
      aria-label="Tilgængelighed"
      className={`rounded-field flex flex-col gap-3 border-[1.5px] p-3 ${
        soldOut ? 'border-field-border bg-surface-muted' : 'border-success-border bg-success-surface'
      }`}
    >
      <AvailabilityFields
        dishId={dishId}
        editorOpen
        fieldNames={form.fieldNames}
        section={section}
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
            Ændres straks på hjemmesiden
          </span>
        </p>

        <button
          className="rounded-field border-field-border bg-surface min-h-tap inline-flex shrink-0 items-center border-[1.5px] px-3"
          type="submit"
        >
          <SwitchTrack soldOut={soldOut} />
          <span className="sr-only">
            {soldOut ? 'Udsolgt ' : 'Tilgængelig '}
            {actionSentence(soldOut, dishName)}
          </span>
        </button>
      </div>

      {resetText === null ? null : <AvailabilityResetNote>{resetText}</AvailabilityResetNote>}
    </form>
  )
}

/**
 * The §7b helper line, wherever it appears.
 *
 * One component, so the sentence is styled once and cannot drift between the row and
 * the panel — and so the wording itself keeps exactly one source, `describeAvailability`.
 */
export function AvailabilityResetNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-ink-2 text-meta flex items-start gap-1.5">
      <span aria-hidden="true">↻</span>
      <span>{children}</span>
    </p>
  )
}
