import { AvailabilityFields, type AvailabilityForm } from './AvailabilitySwitch'
import { UndoStrip, UndoSubmit } from './UndoStrip'

/**
 * The ~10-second Fortryd after an immediate availability change — design 1r, 1y, 1aa;
 * technical plan §6.
 *
 * 1r draws it as a green strip in the list: *"«Thor» er nu markeret som udsolgt på
 * hjemmesiden."* with a Fortryd button beside it. 1y puts the same strip at the foot of
 * the phone screen. It is rendered once, at the top of the screen's main column, so it
 * is on screen at both widths without scrolling — a message that lasts ten seconds
 * should not need to be looked for.
 *
 * The bar, its timer and its button are `UndoStrip`; what is here is the half that is
 * about *availability* — which sentence to say, and which fields the Fortryd submits.
 * The deletion strip beside it (`DeleteUndo`) is a separate file for the same reason:
 * the presentation is shared, the operation is not.
 *
 * **THE CHANGE IS ALREADY LIVE.** This is not a confirmation and not a pending state.
 * The dish changed, the public cache tag was expired, and an audit row was written
 * before this strip was rendered at all. Fortryd is a *second* write down the same
 * path, with the same guard, the same validation, the same concurrency check and its
 * own audit row — see `availability-actions.ts`.
 *
 * NOTHING AUTHORITATIVE LIVES IN THE BROWSER
 *
 * The form below carries three values, and all three come back from the server that
 * performed the write: the dish, the version token that write produced, and the state
 * to restore. None of them is trusted on the way back in — the action re-authorizes,
 * re-parses and hands the version to the database, which refuses a stale one. A person
 * who edits these values in the address bar can construct a strip and press it; what
 * they get is the same refusal any other forged request gets.
 *
 * If the page is reloaded away, the offer is gone and the change stands. §6 says
 * exactly that, and `audit_log` is the recovery path.
 */
export function AvailabilityUndo({
  form,
  dishId,
  dishName,
  version,
  /** The state Fortryd would put the dish back into — the opposite of what it is now. */
  restoreSoldOut,
  section,
  editorOpen,
}: {
  form: AvailabilityForm
  dishId: string
  dishName: string
  version: string
  restoreSoldOut: boolean
  section?: string | null
  editorOpen?: boolean
}) {
  // What just happened is the opposite of what Fortryd would restore.
  const message = restoreSoldOut
    ? `«${dishName}» er nu tilgængelig på hjemmesiden.`
    : `«${dishName}» er nu markeret som udsolgt på hjemmesiden.`

  return (
    // `key` on the version token: a second availability change is a new message with a
    // fresh ten seconds, rather than the previous one's timer running out under it.
    <UndoStrip key={version} message={message}>
      {/*
        The same fields the switch itself submits — one component, so a Fortryd and a
        press of the control cannot come to disagree about what an availability
        submission looks like.
      */}
      <form action={form.action}>
        <AvailabilityFields
          dishId={dishId}
          editorOpen={editorOpen}
          fieldNames={form.fieldNames}
          section={section}
          soldOut={restoreSoldOut}
          version={version}
        />

        <UndoSubmit>sæt «{dishName}» tilbage</UndoSubmit>
      </form>
    </UndoStrip>
  )
}
