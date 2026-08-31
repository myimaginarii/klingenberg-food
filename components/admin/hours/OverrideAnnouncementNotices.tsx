import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { UndoStrip, UndoSubmit } from '@/components/admin/menu/UndoStrip'

/**
 * What happened to the optional generated announcement — design 1ae, 1aa; technical plan
 * §6, §7e item 8. **Phase 8C-3B.**
 *
 * Separate from `./OverrideNotices.tsx`, and the separation is the ordering rule made
 * visible: that file reports what happened to the **opening hours**, this one reports what
 * happened to the **message**, and the screen can show one, the other, or both at once.
 * *"Åbningstiderne er gemt. Beskeden blev ikke oprettet."* is a real outcome and needs two
 * sentences from two places, not one sentence that tries to be both.
 *
 * **It words nothing.** The sentence and the tone are computed by
 * `describeAnnouncementOutcome()` in `app/(admin)/admin/aabningstider/announcement-routes.ts`,
 * which builds them out of the domain's own `describeGeneratedAnnouncementObstacle()` and
 * `describeRestoreObstacle()`. This file chooses between two containers.
 */

export type AnnouncementOutcomeNotice = {
  readonly tone: NoticeTone
  readonly text: string
}

/**
 * The message, in the green Fortryd strip when there is something to undo and in an
 * ordinary notice otherwise.
 *
 * 1aa fixes the difference: *"Beskeder forsvinder efter 5 sek. — dog 10 sek., når de
 * indeholder Fortryd. De stjæler aldrig tastaturfokus."* Both of those are `UndoStrip`'s
 * and `AutoDismiss`'s already, and neither is re-implemented here — §14 of the brief asks
 * for the existing strip rather than a second toast system, and this is that strip with a
 * different sentence in it.
 *
 * `undo` is offered for **every** write that displaced something, not only for 1ae's
 * replacement. 8C-3A stashes the previous state whatever it was — active, hidden, expired
 * or empty — so a Fortryd after a message that displaced *nothing visible* still puts the
 * row back exactly as it stood, which is the promise the snapshot exists to keep.
 */
export function OverrideAnnouncementNotice({
  outcome,
  undo,
}: {
  readonly outcome: AnnouncementOutcomeNotice | null
  /** The version token the write returned, and the action that can reverse it. */
  readonly undo: {
    readonly version: string
    readonly fieldName: string
    readonly action: (formData: FormData) => Promise<void>
  } | null
}) {
  if (outcome === null) return null

  if (undo === null || outcome.tone !== 'success') {
    return <Notice tone={outcome.tone}>{outcome.text}</Notice>
  }

  return (
    <UndoStrip message={outcome.text}>
      <form action={undo.action}>
        {/*
          One field: the version token the announcement write returned. What comes back is
          read from `previous` inside the database, so the browser never sends a message,
          an expiry, a source or an owner — there is no input here through which it could.
        */}
        <input name={undo.fieldName} type="hidden" value={undo.version} />
        <UndoSubmit>sæt den forrige besked tilbage</UndoSubmit>
      </form>
    </UndoStrip>
  )
}
