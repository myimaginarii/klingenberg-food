import { ReorderHandle } from './ReorderHandle'

/**
 * The reorder controls on one dish row — design 1r (handle, left) and 1y (hold a row).
 *
 * One `<form>`, three controls, and the important thing about it is that **the two
 * visible buttons are the feature**. Flyt op and Flyt ned are ordinary submit buttons in
 * an ordinary form: they work with a mouse, with a finger, with the keyboard, with a
 * screen reader, and with JavaScript switched off. The drag handle beside them is an
 * enhancement that submits the same form with a different destination.
 *
 * That order — buttons first, gesture second — is what the phase brief asks for in
 * words ("Do not require drag to perform the task") and what 1y asks for in practice: on
 * a phone, holding a row is a pleasant way to move something and a miserable way to move
 * something precisely.
 *
 * ONE FORM PER ROW, AND WHY
 *
 * Every submission has to say which dish it is about, and a button can carry exactly one
 * name and value — which is spent on the destination. So the dish, the section and the
 * order fingerprint are hidden fields, and a row is the natural thing to hang them on.
 * The form is a sibling of the row's availability form, never a parent of it: HTML forms
 * do not nest, and the two post to different Server Actions on purpose (§6).
 *
 * TWO ARRANGEMENTS, ONE SET OF CONTROLS
 *
 * On a phone the cluster is a full-width strip at the foot of the card, with the words
 * showing, because that is where a thumb is and 1y has no room for a handle beside the
 * photo. From `md` it moves to the left of the row where 1r draws it, the words become
 * the buttons' accessible names, and the arrows carry the meaning visually. Same markup,
 * same tab order, same names — the arrangement is CSS, exactly as `DishRow` already does
 * for the rest of the row.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No `sort_order`, no list of ids, no version token, and no category. A submission says
 * which dish and which position; everything else is the server's own read (see
 * `reorder-form.ts`). And there is no Fortryd: a reorder is an ordinary draft change,
 * so there is nothing live to undo.
 */

/**
 * Where a reorder submission goes, and under which names.
 *
 * Passed in rather than imported, like `AvailabilityForm` and for the same reason: a
 * component in `components/` reaching into `app/` would be the dependency the wrong way
 * round.
 */
export type ReorderForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly dishId: string
    readonly toIndex: string
    readonly baseline: string
    readonly section: string
  }
}

/** One of the two move buttons. The arrow is decoration; the words are the name. */
function MoveButton({
  children,
  disabled,
  dishName,
  fieldName,
  glyph,
  toIndex,
}: {
  children: string
  disabled: boolean
  dishName: string
  fieldName: string
  glyph: string
  toIndex: number
}) {
  return (
    <button
      className="rounded-field border-field-border bg-surface text-ink hover:bg-surface-muted min-h-tap disabled:text-ink-3 flex min-w-tap flex-1 items-center justify-center gap-1.5 border px-3 font-semibold scroll-mb-36 disabled:cursor-not-allowed disabled:opacity-50 md:flex-none md:scroll-mb-0"
      disabled={disabled}
      name={fieldName}
      type="submit"
      value={toIndex}
    >
      <span aria-hidden="true">{glyph}</span>
      {/* Visible on the phone card, carried for a screen reader on the desktop row —
          and the dish is always in the name, because six identical "Flyt op" buttons in
          a list are six buttons nobody can tell apart. The leading space is deliberate:
          JSX drops the whitespace between elements, and without it the accessible name
          would run the two together as "Flyt opOdin". */}
      <span className="md:sr-only">{children}</span>
      <span className="sr-only"> {dishName}</span>
    </button>
  )
}

export function ReorderControls({
  form,
  dishId,
  dishName,
  index,
  total,
  baseline,
  section,
  justMoved,
}: {
  form: ReorderForm
  dishId: string
  /** Named in every control here, so a list of rows is unambiguous. */
  dishName: string
  /** This row's zero-based position in the section's list. */
  index: number
  total: number
  /** The fingerprint of the order this screen was rendered from (§7e item 2). */
  baseline: string
  /** The section chip to reopen afterwards. Navigation only. */
  section: string | null
  /** True when this is the dish the last reorder moved. Focus recovery only. */
  justMoved: boolean
}) {
  return (
    <form
      action={form.action}
      aria-label={`Flyt ${dishName}`}
      className="order-last flex shrink-0 items-center gap-2 md:order-first"
    >
      <input name={form.fieldNames.dishId} type="hidden" value={dishId} />
      <input name={form.fieldNames.baseline} type="hidden" value={baseline} />
      {section === null ? null : (
        <input name={form.fieldNames.section} type="hidden" value={section} />
      )}

      <ReorderHandle
        dishName={dishName}
        fieldName={form.fieldNames.toIndex}
        index={index}
        justMoved={justMoved}
        total={total}
      />

      <MoveButton
        disabled={index === 0}
        dishName={dishName}
        fieldName={form.fieldNames.toIndex}
        glyph="↑"
        toIndex={index - 1}
      >
        Flyt op
      </MoveButton>

      <MoveButton
        disabled={index === total - 1}
        dishName={dishName}
        fieldName={form.fieldNames.toIndex}
        glyph="↓"
        toIndex={index + 1}
      >
        Flyt ned
      </MoveButton>
    </form>
  )
}
