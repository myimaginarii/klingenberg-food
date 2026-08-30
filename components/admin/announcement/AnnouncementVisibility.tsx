import { StateDot, SwitchTrack } from '@/components/admin/menu/AvailabilitySwitch'

/**
 * "Vis besked" and "Fjern beskeden nu" — design 1ad; technical plan §6.
 *
 * 1ad draws the two of them at opposite ends of the screen: a switch in a white card at
 * the very top, and a bordered button in the footer beside Forhåndsvis and Offentliggør.
 * The frame also draws the line between them and everything else, in its own words:
 *
 *     "Skrive eller ændre → tre trin. Ret → Forhåndsvis → Offentliggør."
 *     "Fjerne → ét tryk. 'Vis besked' fra eller 'Fjern beskeden nu' virker straks —
 *      ingen forhåndsvisning, ingen offentliggørelse."
 *
 * **They are two entrances to one operation, not two operations.** Both render the same
 * hidden fields, post to the same Server Action and reach the same database function, so
 * there is exactly one place in this system where an announcement is taken down. The
 * visual language is the one phases 5C, 6A and 6B established for the immediate path —
 * `SwitchTrack`, `StateDot`, the green surface, the sentence beside the state — reused
 * rather than restated, so this control reads as the same *kind* of thing as Udsolgt.
 *
 * WHY IT IS A BUTTON AND NOT `role="switch"`
 *
 * The same reason `AvailabilitySwitch` gives for a dish: this submits a form and the page
 * comes back changed, and the control's name *is* its state. `role="switch"` promises an
 * in-place flip and a fixed name plus on/off, which is the one shape this is not. So it
 * is a button whose accessible name says where the message stands and what pressing will
 * do.
 *
 * ICON, TEXT *AND* COLOUR (1aa)
 *
 * The knob's position, the words beside it and the small mark before them each carry the
 * state on their own, so it survives the colours being switched off.
 *
 * WHY IT IS ITS OWN FORM, AND WHY IT IS ABOVE THE FIELDS
 *
 * HTML forms cannot nest, and this must post somewhere else than Gem: Gem writes a draft
 * that waits for Offentliggør, and this changes the hjemmeside immediately (§6). So the
 * card is a **sibling** of the editor form, at the top of the screen — which is where 1ad
 * draws it, and which is the one arrangement that keeps the single exception visually
 * separate from the fields that all follow the ordinary three-step rule.
 *
 * WHAT THIS CONTROL DELIBERATELY CANNOT DO — the ON direction
 *
 * §6's immediate-path table names *"'Vis besked' off / 'Fjern beskeden nu'"* — the **off**
 * direction only — and 1ad's own annotation names only that direction too, twice.
 * Turning a bar *on* is Offentliggør (§0f), which is why {@link AnnouncementVisibilityCard}
 * renders 1ad's switch when the message is showing and a plain statement when it is not,
 * rather than a switch that would offer a direction this phase does not own. The one
 * write in the on direction is Fortryd, which restores the **same, unchanged, already
 * published** announcement within about ten seconds of the press that removed it — and
 * even that cannot make pending draft content public, because the operation writes one
 * column and `draft` is not it.
 */

/**
 * Where a submission goes, and under which names.
 *
 * Passed in rather than imported: a component in `components/` reaching into `app/`
 * would be the dependency the wrong way round, and the screen that owns the action owns
 * the vocabulary it reads, in one file.
 */
export type AnnouncementVisibilityForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly version: string
    readonly visible: string
  }
}

/** What this control is called wherever a sentence has to name it. */
export const ANNOUNCEMENT_VISIBILITY_LABEL = 'beskeden på hjemmesiden'

/**
 * The hidden fields every visibility submission carries.
 *
 * `visible` is the state being *asked for*. There is nothing else to send: no message,
 * no link, no expiry, no entity name and no row id.
 */
export function AnnouncementVisibilityFields({
  fieldNames,
  version,
  visible,
}: {
  fieldNames: AnnouncementVisibilityForm['fieldNames']
  version: string
  visible: boolean
}) {
  return (
    <>
      <input name={fieldNames.version} type="hidden" value={version} />
      <input name={fieldNames.visible} type="hidden" value={visible ? '1' : '0'} />
    </>
  )
}

/**
 * 1ad's card at the top of the screen.
 *
 * `visible` is read from the **live** row, never from a draft — it is a statement about
 * what a guest can see, and a draft is by definition something no guest has seen.
 *
 * The two helper sentences are the frame's own, one per width: the desktop card says
 * *"Slå fra, og bjælken forsvinder med det samme."* and the phone card says *"Slå fra, og
 * den forsvinder straks"*. Only one is in the accessibility tree at a time, because the
 * other is `display: none`.
 */
export function AnnouncementVisibilityCard({
  form,
  version,
  visible,
}: {
  form: AnnouncementVisibilityForm
  /** The `updated_at` the screen was rendered from — the concurrency token (§6). */
  version: string
  /** `announcement.is_visible`, from the published row. */
  visible: boolean
}) {
  if (!visible) return <AnnouncementHiddenCard />

  return (
    <form
      action={form.action}
      aria-label="Vis besked"
      className="rounded-card border-success-border bg-success-surface flex items-center justify-between gap-3 border-[1.5px] p-3 md:px-4"
    >
      {/* The switch is drawn in its on state, so pressing it asks for the off one. */}
      <AnnouncementVisibilityFields
        fieldNames={form.fieldNames}
        version={version}
        visible={false}
      />

      <p className="min-w-0">
        <span className="text-success-ink flex items-center gap-2 font-semibold">
          <StateDot soldOut={false} />
          Vis besked
        </span>
        <span className="text-success-ink-2 text-meta md:hidden">
          Slå fra, og den forsvinder straks
        </span>
        <span className="text-success-ink-2 text-meta hidden md:inline">
          Slå fra, og bjælken forsvinder med det samme.
        </span>
      </p>

      <button
        className="rounded-field border-field-border bg-surface min-h-tap inline-flex shrink-0 items-center border-[1.5px] px-3"
        type="submit"
      >
        <SwitchTrack soldOut={false} />
        {/*
          The visible words are in the line beside the switch, so the button's own name is
          carried for a screen reader — and it says both where the message stands and what
          pressing will do, which is what WCAG 2.5.3 asks of a control whose visible label
          is text.
        */}
        <span className="sr-only">
          Beskeden vises på hjemmesiden. Slå fra, så den fjernes straks.
        </span>
      </button>
    </form>
  )
}

/**
 * What the same place says when the message is not showing.
 *
 * A statement rather than a switch drawn in its off position, for the reason phase 7A
 * left both of 1ad's immediate controls off the screen entirely: a control that cannot do
 * its job is worse than a control that is not there. §6's immediate path owns the **off**
 * direction; putting a message back on the hjemmeside is Offentliggør (§0f, 1ad), so the
 * card says that instead of offering a press that would have to be refused.
 *
 * It is not a `role="status"`: it is a standing statement about the row, not something
 * that just happened. The screen's own status notice and the Fortryd strip are the two
 * things that announce.
 */
function AnnouncementHiddenCard() {
  return (
    <section
      aria-labelledby="besked-vises-ikke"
      className="rounded-card border-border bg-surface flex flex-col gap-1 border p-3 md:px-4"
    >
      <h2 className="text-neutral-ink flex items-center gap-2 font-semibold" id="besked-vises-ikke">
        <StateDot soldOut />
        Vis besked — slået fra
      </h2>
      <p className="text-ink-2 text-meta">
        Beskeden står ikke på hjemmesiden lige nu. Skal den frem igen, så ret den og tryk
        Offentliggør.
      </p>
    </section>
  )
}

/**
 * 1ad's footer control — the second entrance to the same operation.
 *
 * The frame draws it at the left of the desktop footer and at the foot of the phone card,
 * in both cases as a bordered button in the ink colour rather than the burgundy
 * Offentliggør: it is consequential, it is not a publish, and 1aa's "handling ≠
 * udgivelse" is the reason it must not look like one.
 *
 * The sentence beneath it is 1ad's own — *"virker straks — ingen forhåndsvisning, ingen
 * offentliggørelse"* — bound to the button with `aria-describedby`, so what the press
 * does is part of the control rather than a caption beside it. That is the same
 * arrangement "Ryd felterne" uses on the Månedens burger screen.
 *
 * It is rendered **only when there is a bar to remove**. Nothing is drawn for an
 * announcement that is already off, which is the same rule 1ac states for the bar itself.
 */
export function RemoveAnnouncementNowButton({
  form,
  version,
}: {
  form: AnnouncementVisibilityForm
  version: string
}) {
  const helpId = 'fjern-besked-nu-hjaelp'

  return (
    <form
      action={form.action}
      className="rounded-card border-border bg-surface flex flex-col gap-2 border p-3 md:flex-row md:items-center md:gap-4 md:px-4"
    >
      <AnnouncementVisibilityFields
        fieldNames={form.fieldNames}
        version={version}
        visible={false}
      />

      <button
        aria-describedby={helpId}
        className="rounded-field border-neutral-ink text-neutral-ink hover:bg-surface-muted min-h-tap bg-surface inline-flex w-full shrink-0 items-center justify-center border-[1.5px] px-5 font-semibold md:w-auto"
        type="submit"
      >
        Fjern beskeden nu
      </button>

      <p className="text-ink-2 text-meta min-w-0" id={helpId}>
        Virker straks — ingen forhåndsvisning, ingen offentliggørelse. Du kan fortryde i
        ca. 10 sekunder.
      </p>
    </form>
  )
}
