import type { DishDeletionPrompt } from '@/lib/menu/delete'

import { DeleteFields, type DeleteForm } from './DeleteDishControls'
import { ModalDialog } from './ModalDialog'

/**
 * "Slet Odin? Den forsvinder fra hjemmesiden." — design 1r's own wording, technical
 * plan §6, §7e item 4.
 *
 * The frame's note fixes the rule and this is it, literally: *"Slet spørger altid"*.
 * There is no path from the editor to a deleted dish that does not pass through this
 * screen, and the only thing on it that deletes anything is a submit button a person
 * has to aim at.
 *
 * NOTHING IS DECIDED HERE
 *
 * Every sentence comes from `describeDishDeletion()` in `lib/menu/delete.ts` — which
 * question to ask, whether the Forside warning applies, and what it says. This file
 * arranges them. That keeps the wording assertable in the unit suite and keeps the one
 * decision in it — *is this dish currently featured on the published Forside* — on the
 * server, where the answer is read from the Forside document rather than believed from
 * a form field.
 *
 * THE WARNING IS INFORMATION, NOT A GATE
 *
 * A dish that Forsiden features can be deleted, by Staff, exactly like any other. What
 * the warning does is tell the truth about the consequence before the fact: the dish
 * stops appearing on Forsiden, and **Forsiden itself is not changed**. Forsiden is
 * Owner-only (§5), so a Staff deletion does not — and must not — edit it; the stale slot
 * simply stops resolving, the page renders the dishes that remain, and an Owner can
 * tidy it in the Forsiden editor whenever they like. No id and no page name appears on
 * screen: somebody deleting a burger mid-shift is told what a guest will see, not how
 * the database is arranged.
 *
 * ACCESSIBILITY
 *
 *   * The dialog is named by its own heading (`aria-labelledby`), so it is announced as
 *     the question rather than as "dialog".
 *   * The warning is a bordered block with its own icon shape and the word "Forsiden"
 *     in its text, so it is never carried by colour alone (1aa).
 *   * Behold comes first and is marked `data-autofocus`, so opening the dialog puts
 *     the keyboard on the **safe** choice rather than on whichever control a given
 *     browser would have picked. The destructive control is second, named "Slet ret",
 *     in the error tone, at 44 px.
 *   * Cancelling is a navigation back to the Slet ret control's own anchor, so focus
 *     returns to where it started.
 *   * On a phone the two choices **stack**, the safe one first and both full width
 *     (phase 12A) — the arrangement 1ae's sheet and the users-admin confirmations
 *     already use below `md`. Side by side at 375 px they were 8 px apart, which is
 *     too close for a thumb aiming at "Behold ret" next to the one control on this
 *     screen that removes a dish from the hjemmeside.
 */
export function DeleteDishDialog({
  anchorId,
  form,
  dishId,
  dishName,
  version,
  prompt,
  cancelHref,
  section,
}: {
  anchorId: string
  form: DeleteForm
  dishId: string
  dishName: string
  /** The version the confirmation was rendered from — the concurrency token (§6). */
  version: string
  prompt: DishDeletionPrompt
  /** Back to the dish, landing on the control this was opened from. */
  cancelHref: string
  section?: string | null
}) {
  const headingId = `${anchorId}-titel`

  return (
    <ModalDialog cancelHref={cancelHref} id={anchorId} labelledBy={headingId}>
      <div className="flex flex-col gap-4 p-4 md:p-5">
        <div>
          <h2 className="text-heading font-sans font-semibold wrap-anywhere" id={headingId}>
            {prompt.question}
          </h2>
          <p className="text-ink-2 text-meta mt-1">{prompt.consequence}</p>
        </div>

        {prompt.homepageWarning === null ? null : (
          <p className="rounded-field border-warning-border bg-warning-surface text-warning-ink flex items-start gap-2 border px-3 py-2 text-meta font-medium">
            {/* Shape as well as colour, the way every other status in this
                administration is drawn (1aa). */}
            <span aria-hidden="true" className="bg-warning mt-1 size-2 shrink-0 rotate-45" />
            <span>{prompt.homepageWarning}</span>
          </p>
        )}

        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-end md:gap-2">
          {/*
            The safe choice first, and focused. A confirmation that opens with the
            keyboard on the destructive button is a confirmation that can be dismissed
            by a reflex press of Enter.
          */}
          {/*
            A plain `<a>`, deliberately, and the one place in this administration that
            is not a `<Link>`: `cancelHref` ends in the Slet ret control's own fragment,
            and only a real navigation makes the browser put focus there. A client-side
            route change would leave the keyboard at the top of the document.
          */}
          <a
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex items-center justify-center px-5 font-semibold text-white"
            data-autofocus
            href={cancelHref}
          >
            Behold ret
          </a>

          {/*
            The destructive control keeps the tone the approved design already gives it
            — 1r's own "Slet ret" and 1w's "Slet" are both an outlined error control, so
            nothing new is invented for the one dialog that performs one. Outlined
            beside a filled safe action is also the arrangement 1ae uses for a choice
            that has a right answer and a deliberate one.
          */}
          <form action={form.action}>
            <DeleteFields
              deleted
              dishId={dishId}
              fieldNames={form.fieldNames}
              section={section}
              version={version}
            />
            <button
              className="rounded-field border-error text-error-ink hover:bg-error-surface min-h-tap bg-surface inline-flex w-full items-center justify-center border-[1.5px] px-4 font-semibold md:w-auto"
              type="submit"
            >
              {prompt.confirmLabel}
              <span className="sr-only"> — {dishName}</span>
            </button>
          </form>
        </div>
      </div>
    </ModalDialog>
  )
}
