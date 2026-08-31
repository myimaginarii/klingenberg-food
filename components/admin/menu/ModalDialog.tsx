'use client'

import { useEffect, useRef } from 'react'

/**
 * A server-rendered confirmation, promoted to a real modal dialog — design 1ae, 1aa.
 *
 * The administration's one dialog rule comes from the conflict sheet, and it is
 * explicit: *"Arket kan ikke lukkes ved at trykke udenfor — der skal træffes et valg."*
 * A native `<dialog>` opened with `showModal()` gives exactly that, from the platform
 * rather than from a script:
 *
 *   * clicking the backdrop does **not** close it;
 *   * focus moves into it when it opens;
 *   * focus is trapped inside it while it is open — everything behind becomes **inert**,
 *     which is the precise promise and is worth stating precisely: a `showModal()` dialog
 *     does **not** cycle focus within itself. Tab past its last control goes to the
 *     browser's own UI, not round to the first. What cannot happen is focus reaching the
 *     page behind — even a direct `focus()` call on an element back there does nothing.
 *     A test that asserted wrapping would be asserting a behaviour nobody promised;
 *     `tests/e2e/opening-hours-announcement.spec.ts` asserts the inertness instead;
 *   * the backdrop is a real `::backdrop`, not an overlaid `<div>` that the tab order
 *     would walk straight past.
 *
 * None of that is implemented here. It is the reason a `<dialog>` is used at all.
 *
 * PROGRESSIVE ENHANCEMENT, NOT A REQUIREMENT
 *
 * The element is rendered by the server with the `open` attribute, so **without
 * JavaScript it is already on the page** as an ordinary block: the question, the
 * warning, Behold and Slet ret, all readable and all operable, because both choices are
 * a link and a form. What this component adds is the modality — it closes the inline
 * copy and re-opens it modally, which is the only way to reach `showModal()` at all.
 * Nothing about the deletion depends on that having happened; §7e (item 11) allows the
 * administration to require JavaScript, and this part of it does not.
 *
 * GIVING FOCUS BACK — TWO MECHANISMS, FOR TWO KINDS OF EXIT
 *
 * A dialog that takes focus owes it back (1aa, §11).
 *
 * **A confirmation pays that debt through the address.** Closing it is a full navigation
 * to `…#slet-ret`, the fragment of the control it was opened from, and a browser focuses
 * a focusable fragment target when it lands on one. So the keyboard ends up exactly where
 * it started — including with JavaScript switched off, where nothing here runs at all.
 * A client-side route change would *not* do that; it moves the URL without moving focus.
 * That is why the cancel control is a plain `<a>` and why `Esc` below performs a real
 * navigation instead of a router push.
 *
 * **A dialog resolved by a Server Action cannot.** 1ae's "Erstat med den nye besked" is a
 * `<form>` dispatching to a Server Action, and a Server Action's `redirect()` is a *soft*
 * navigation: the URL moves, this dialog unmounts, and focus falls to `<body>` — with or
 * without a fragment. `returnFocusTo` is for that case. It names the control the sheet was
 * opened from, and the cleanup focuses it as the dialog goes, whichever of the two ways
 * out was taken.
 *
 * It is deliberately an **id rather than a ref**: the element the sheet returns to is
 * rendered by a different component on the other side of a Server Component boundary, and
 * a page that no longer draws that control simply gets no focus move rather than an error.
 *
 * ESCAPE IS CANCEL — EXCEPT WHERE THERE IS NOTHING TO CANCEL TO
 *
 * Which state this screen is in lives in the URL, so closing the dialog without leaving
 * that state would produce a page whose address says "confirming" and whose screen says
 * nothing. For a **confirmation** — Slet ret, Fjern ændringen — `Esc` is therefore turned
 * into the same navigation the Behold-knap performs: a destructive confirmation must
 * always have an obvious way out, and the way out is "do nothing".
 *
 * 1ae is not a confirmation, and `locked` is for it. The conflict sheet asks *which of two
 * messages guests should see* once the opening hours are already public, and neither
 * answer is "do nothing": "Behold eksisterende besked" drops the new message and "Erstat
 * med den nye besked" publishes it, and both are decisions somebody has to make. Mapping
 * `Esc` to either one would put a choice in somebody's mouth, and mapping it to a third
 * "close" would leave the screen in a state whose address describes a question that is no
 * longer on screen. So `locked` suppresses `Esc` entirely, and the sheet answers §11's
 * other half — *"there must always be a clearly labelled button path out"* — with two
 * labelled buttons and no other exit. Backdrop clicks are already inert for both modes,
 * because that is what `showModal()` does.
 *
 * It performs no request of any kind, holds no state and knows nothing about dishes.
 */
export function ModalDialog({
  id,
  /** The id of the heading that names the dialog. Its accessible name (1aa). */
  labelledBy,
  /**
   * Where `Esc` goes. The same address the dialog's own cancel control links to.
   *
   * `null` only alongside `locked`, where nothing anywhere in the dialog cancels.
   */
  cancelHref,
  /** 1ae: a decision rather than a confirmation, so `Esc` resolves nothing. */
  locked = false,
  /** The id of the control this dialog was opened from, for a soft-navigated exit. */
  returnFocusTo,
  children,
}: {
  id: string
  labelledBy: string
  cancelHref: string | null
  locked?: boolean
  returnFocusTo?: string
  children: React.ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = dialog.current
    if (node === null) return

    // Re-open modally: `open` renders it inline, `showModal()` puts it in the top layer
    // with a backdrop, moves focus into it and makes the rest of the page inert.
    //
    // The state is *established* rather than toggled, because this effect can run more
    // than once on the same element — React's development-mode double invocation closes
    // it in between, and a version that only handled "currently open" would leave the
    // dialog shut on the second pass.
    if (node.open) node.close()
    node.showModal()

    // Where focus lands is stated by the dialog's content rather than left to which
    // element happens to come first: browsers disagree about whether `showModal()`
    // focuses the dialog or its first focusable child, and for a destructive
    // confirmation the answer must be the *safe* control every time.
    node.querySelector<HTMLElement>('[data-autofocus]')?.focus()

    return () => {
      if (node.open) node.close()

      /*
       * Hand the keyboard back on the way out.
       *
       * `close()` restores focus to whatever had it when `showModal()` ran, which after a
       * soft navigation is `<body>` — so for a sheet reached that way the platform's own
       * restoration has nothing useful to give back. Naming the control makes the promise
       * hold either way, and `preventScroll` keeps it from yanking the page around
       * underneath somebody who had scrolled.
       */
      if (returnFocusTo !== undefined) {
        document.getElementById(returnFocusTo)?.focus({ preventScroll: true })
      }
    }
  }, [returnFocusTo])

  return (
    <dialog
      aria-labelledby={labelledBy}
      className="bg-surface border-border rounded-card-lg shadow-panel m-auto w-[min(30rem,calc(100vw-2rem))] border p-0 backdrop:bg-[rgb(36_30_27/0.45)]"
      id={id}
      onCancel={(event) => {
        // `preventDefault` in both modes: without it the platform closes the dialog and
        // leaves the page behind it showing an address that still describes the question.
        event.preventDefault()

        // A real navigation rather than a router push, so the fragment focuses the control
        // this dialog was opened from — the same thing the cancel link does. A locked
        // dialog has no such control, and stays exactly where it is.
        if (!locked && cancelHref !== null) window.location.assign(cancelHref)
      }}
      open
      ref={dialog}
    >
      {children}
    </dialog>
  )
}
