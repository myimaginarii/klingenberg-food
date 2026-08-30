import { ModalDialog } from '@/components/admin/menu/ModalDialog'
import type { IsoWeek } from '@/lib/time/iso-week'

/**
 * "Kopiér sidste uge" — decision 4, closed against 1ag's own open question:
 * *"skal forrige uge kunne kopieres frem som udgangspunkt?"*
 *
 * The frame does not draw the control, because at the time it was drawn the question was
 * still open. So it is built in the approved visual language rather than a new one: the
 * outlined secondary button 1ag already uses for "Vælg billede", sitting above the two
 * cards where a person decides how to start the week — and never inside either card's
 * form, because it posts somewhere else than Gem.
 *
 * WHAT IT DOES, IN THE SENTENCE BESIDE IT
 *
 * It seeds a **draft**. §6 is explicit that it never publishes, and the helper line says
 * so in the administration's own words before anybody presses it. The public site is
 * unchanged by a copy, and the button's own label does not promise otherwise.
 *
 * WHEN IT IS UNAVAILABLE
 *
 * §6: *"If the live row is empty the button is disabled with an explanation rather than
 * producing a blank draft."* Disabled **with the explanation beside it**, not hidden:
 * somebody looking for the control needs to learn why it is not there, and a control
 * that vanishes teaches nothing. The server refuses the same case independently
 * (`nothing_to_copy`), so the disabled attribute is a courtesy rather than the gate.
 */
export type CopyForm = {
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: { readonly version: string; readonly confirm: string }
}

export function CopyPreviousWeek({
  anchorId,
  form,
  version,
  /** The week the copy would land in, computed on the server. */
  destination,
  /** False when the live row holds nothing a guest could read (§6). */
  available,
}: {
  anchorId: string
  form: CopyForm
  version: string
  destination: IsoWeek
  available: boolean
}) {
  const noteId = `${anchorId}-note`

  return (
    <form
      action={form.action}
      aria-label="Kopiér sidste uge"
      className="bg-surface border-border rounded-card flex flex-col gap-3 border p-3 md:flex-row md:items-center md:justify-between md:px-4"
    >
      <input name={form.fieldNames.version} type="hidden" value={version} />

      <p className="min-w-0">
        <b className="text-neutral-ink font-semibold">Start ugen fra sidste uge</b>
        <span className="text-ink-2 text-meta block" id={noteId}>
          {available
            ? `Henter det, der står på hjemmesiden nu, ind som kladde til uge ${String(destination.week)}. Hjemmesiden ændrer sig ikke.`
            : 'Der er ikke noget på hjemmesiden at kopiere endnu. Skriv ugens ret herunder, og offentliggør den — så kan næste uge kopieres frem.'}
        </span>
      </p>

      {/*
        `shrink-0`: from `md` the button sits beside a sentence longer than itself, and a
        shrinkable flex item hands the room to the sentence — which broke "Kopiér sidste
        uge" across two lines between 768 px and roughly 1024 px. The paragraph carries
        `min-w-0`, so the sentence is the one that wraps.
      */}
      <button
        aria-describedby={noteId}
        className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section disabled:border-disabled-surface disabled:text-disabled-ink min-h-tap inline-flex w-full shrink-0 items-center justify-center border-[1.5px] px-5 font-semibold disabled:cursor-not-allowed disabled:hover:bg-transparent md:w-auto"
        disabled={!available}
        id={anchorId}
        type="submit"
      >
        Kopiér sidste uge
      </button>
    </form>
  )
}

/**
 * "Dette overskriver din nuværende kladde" — §6's own guard, as the approved
 * confirmation.
 *
 * Nothing has happened when this is on screen. The first press reached the database,
 * which answered `needs_confirmation` and **wrote nothing**; this dialog is what the
 * screen renders in response, and its button is the only control on the site that
 * submits the confirmation field. A person who types the confirmation's address by hand
 * gets the question, not the answer.
 *
 * It is the same `ModalDialog` the deletion confirmation uses, so the rules 1ae fixes
 * for this administration's dialogs hold here too: focus moves in, focus is trapped,
 * clicking the backdrop does not dismiss it, and Esc performs the same navigation the
 * cancel link does — which returns the keyboard to the control this was opened from.
 *
 * The **safe** choice is first and focused. A confirmation that opens with the keyboard
 * on the destructive control is a confirmation that can be dismissed by a reflex Enter.
 * Nothing here is destructive to the hjemmeside — a copy cannot publish — but it does
 * replace work somebody may still want, so it is treated with the same care.
 */
export function CopyPreviousWeekDialog({
  anchorId,
  form,
  version,
  destination,
  cancelHref,
}: {
  anchorId: string
  form: CopyForm
  version: string
  destination: IsoWeek
  /** Back to the copy control, so focus returns where it started. */
  cancelHref: string
}) {
  const headingId = `${anchorId}-titel`

  return (
    <ModalDialog cancelHref={cancelHref} id={anchorId} labelledBy={headingId}>
      <div className="flex flex-col gap-4 p-4 md:p-5">
        <div>
          <h2 className="text-heading font-sans font-semibold" id={headingId}>
            Dette overskriver din nuværende kladde
          </h2>
          <p className="text-ink-2 text-meta mt-1">
            {`Du har ændringer, der ikke er offentliggjort. Kopierer du sidste uge frem til uge ${String(destination.week)}, erstattes de af det, der står på hjemmesiden nu.`}
          </p>
        </div>

        <p className="rounded-field border-announce-border bg-announce-surface text-brand-700 flex items-start gap-2 border px-3 py-2 text-meta font-medium">
          <span aria-hidden="true" className="bg-brand-700 mt-1.5 size-2 shrink-0 rotate-45" />
          <span>
            Hjemmesiden ændrer sig ikke. Kopien bliver en kladde, som du selv
            offentliggør bagefter.
          </span>
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <a
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex items-center px-5 font-semibold text-white"
            data-autofocus
            href={cancelHref}
          >
            Behold min kladde
          </a>

          <form action={form.action}>
            <input name={form.fieldNames.version} type="hidden" value={version} />
            <input name={form.fieldNames.confirm} type="hidden" value="1" />
            <button
              className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section min-h-tap bg-surface inline-flex items-center border-[1.5px] px-4 font-semibold"
              type="submit"
            >
              Kopiér alligevel
            </button>
          </form>
        </div>
      </div>
    </ModalDialog>
  )
}
