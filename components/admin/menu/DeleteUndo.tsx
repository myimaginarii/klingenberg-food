import { DeleteFields, type DeleteForm } from './DeleteDishControls'
import { UndoStrip, UndoSubmit } from './UndoStrip'

/**
 * The ~10-second Fortryd after a dish was deleted — design 1r, 1aa; technical plan §6.
 *
 * §6's table says it in one line: *"Delete a dish | soft delete (`deleted_at`) | 10 s
 * Fortryd clears `deleted_at`"*. The strip is the same green bar the availability path
 * uses — `UndoStrip` — carrying this operation's own sentence and this operation's own
 * form.
 *
 * **THE DISH IS ALREADY GONE FROM THE HJEMMESIDE.** It is not gone from the database:
 * `deleted_at` is set and the row, its draft, its labels, its price and its sold-out
 * state are all exactly where they were. Fortryd clears one column and the dish is
 * back, whole. Nothing is reconstructed and nothing is re-created — which is why the
 * offer can be refused without anything being lost: refusing it leaves a deleted row,
 * and a deleted row is a restorable row.
 *
 * WHY THE VERSION TOKEN IS THE POINT
 *
 * The token below is the one the *deletion* produced. If a colleague has touched the
 * dish since — restored it themselves, published a draft on it — the row has moved on
 * and the database refuses this Fortryd as a conflict rather than quietly winning over
 * them (§6, §7e item 2). That is what makes a strip left open in a tab harmless, and it
 * is a stronger guarantee than the ten seconds: the timeout takes the *message* away,
 * and the token is what takes the *authority* away.
 */
export function DeleteUndo({
  form,
  dishId,
  /** The sentence for what just happened. Composed in `lib/menu/delete.ts`. */
  message,
  dishName,
  version,
  section,
}: {
  form: DeleteForm
  dishId: string
  message: string
  dishName: string
  version: string
  section?: string | null
}) {
  return (
    // `key` on the version token, so a second deletion is a new message with a fresh ten
    // seconds rather than the previous one's timer running out under it.
    <UndoStrip key={version} message={message}>
      <form action={form.action}>
        <DeleteFields
          deleted={false}
          dishId={dishId}
          fieldNames={form.fieldNames}
          section={section}
          version={version}
        />

        <UndoSubmit>hent «{dishName}» tilbage</UndoSubmit>
      </form>
    </UndoStrip>
  )
}
