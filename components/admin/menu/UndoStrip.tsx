import { AutoDismiss } from './AutoDismiss'

/**
 * The green "it is live, and here is Fortryd" strip — design 1r, 1y, 1aa.
 *
 * 1r draws it inside the list: a green bar carrying one sentence about what just
 * happened and a Fortryd button beside it. 1y puts the same strip at the foot of the
 * phone screen. 1aa fixes how long it stays: *"Beskeder forsvinder efter 5 sek. — dog
 * 10 sek., når de indeholder Fortryd. De stjæler aldrig tastaturfokus."*
 *
 * **This is presentation and nothing else.** It knows a sentence and it renders a
 * slot; it knows nothing about dishes, availability, deletion, forms or Server Actions.
 * That is deliberate, and it is the line this file will not cross: the two immediate
 * operations in this administration — Udsolgt (§7b) and Slet ret (§7e item 4) — are
 * kept as two explicit implementations, each with its own Server Action, its own
 * strictly-parsed fields and its own database function. What they genuinely share is a
 * *green bar with a Fortryd in it*, so that is what is shared. Making them share a
 * business-action abstraction in order to share a bar would trade a duplicated
 * `<div>` for a layer that nobody could audit by reading one file.
 *
 * THE CHANGE IS ALREADY LIVE
 *
 * Whatever renders inside this strip, it is not a confirmation and not a pending state.
 * The write has committed, the public cache tag has been expired and an audit row has
 * been written before this is rendered at all. Fortryd is a *second* write down the
 * same guarded path.
 *
 * ACCESSIBILITY
 *
 *   * `role="status"` — polite, so it is announced without interrupting and without
 *     taking focus (1aa).
 *   * The ✓ is `aria-hidden`; the sentence carries the meaning, so the message survives
 *     the colours being switched off.
 *   * `AutoDismiss` will not remove the strip while focus is inside it, so a person
 *     reading the Fortryd button is never left standing on nothing.
 */
export function UndoStrip({
  /** What just happened, in one sentence. Server-rendered. */
  message,
  /** The Fortryd control — a `<form>` posting to the action that can reverse it. */
  children,
}: {
  message: string
  children: React.ReactNode
}) {
  return (
    // The caller keys this element on the version token the write returned, so a second
    // change is a new message with a fresh ten seconds rather than the previous one's
    // timer running out under it. Keying the strip remounts the timer with it.
    <AutoDismiss>
    <div
      className="rounded-field border-success-border bg-success-surface flex flex-wrap items-center gap-3 border-l-4 border-[1.5px] border-l-success px-3 py-2"
      role="status"
    >
      <span
        aria-hidden="true"
        className="bg-success flex size-[1.125rem] shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold text-white"
      >
        ✓
      </span>
      <b className="text-success-ink text-meta min-w-0 flex-1 font-semibold">{message}</b>
      {children}
    </div>
    </AutoDismiss>
  )
}

/**
 * The Fortryd button itself, so the two strips cannot drift apart in size or tone.
 *
 * 1aa's 44 px minimum target is `min-h-tap`; the sr-only tail is what makes the name
 * unambiguous when a screen reader meets a lone "Fortryd" — which of the two things on
 * this screen would it undo?
 */
export function UndoSubmit({ children }: { children: React.ReactNode }) {
  return (
    <button
      className="rounded-field border-success-border text-success-ink hover:bg-success-surface min-h-tap bg-surface inline-flex items-center border-[1.5px] px-4 font-semibold"
      type="submit"
    >
      Fortryd
      <span className="sr-only"> — {children}</span>
    </button>
  )
}
