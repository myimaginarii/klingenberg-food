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
 *   * focus is trapped inside it while it is open — everything behind becomes inert;
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
 * GIVING FOCUS BACK IS THE PLATFORM'S JOB, NOT THIS COMPONENT'S
 *
 * A dialog that takes focus owes it back, and this one pays that debt through the
 * address rather than through a script: closing it is a full navigation to
 * `…#slet-ret`, the fragment of the control it was opened from, and a browser focuses a
 * focusable fragment target when it lands on one. So the keyboard ends up exactly where
 * it started — including with JavaScript switched off, where nothing here runs at all.
 *
 * A client-side route change would *not* do that; it moves the URL without moving
 * focus. That is why the cancel control is a plain `<a>` and why `Esc` below performs a
 * real navigation instead of a router push.
 *
 * ESCAPE IS CANCEL
 *
 * Which state this screen is in lives in the URL (`./routes.ts`), so closing the dialog
 * without leaving that state would produce a page whose address says "confirming" and
 * whose screen says nothing. `Esc` is therefore turned into the same navigation the
 * Behold-knap performs. Suppressing `Esc` altogether would be the other reading of
 * 1ae's rule, and the wrong one: a destructive confirmation must always have an obvious
 * way out.
 *
 * It performs no request of any kind, holds no state and knows nothing about dishes.
 */
export function ModalDialog({
  id,
  /** The id of the heading that names the dialog. Its accessible name (1aa). */
  labelledBy,
  /** Where `Esc` goes. The same address the dialog's own cancel control links to. */
  cancelHref,
  children,
}: {
  id: string
  labelledBy: string
  cancelHref: string
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
    }
  }, [])

  return (
    <dialog
      aria-labelledby={labelledBy}
      className="bg-surface border-border rounded-card-lg shadow-panel m-auto w-[min(30rem,calc(100vw-2rem))] border p-0 backdrop:bg-[rgb(36_30_27/0.45)]"
      id={id}
      onCancel={(event) => {
        // A real navigation rather than a router push, so the fragment focuses the
        // control this dialog was opened from — the same thing the cancel link does.
        event.preventDefault()
        window.location.assign(cancelHref)
      }}
      open
      ref={dialog}
    >
      {children}
    </dialog>
  )
}
