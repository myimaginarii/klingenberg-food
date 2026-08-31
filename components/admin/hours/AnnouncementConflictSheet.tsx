import Link from 'next/link'

import { ModalDialog } from '@/components/admin/menu/ModalDialog'
import { formatExpiryStamp } from '@/lib/announcements/expiry-editor'

/**
 * "Der vises allerede en besked på hjemmesiden." — design 1ae; technical plan §6, §7e
 * item 8. **Phase 8C-3B.**
 *
 * The frame, in its own words: two messages side by side, *"VISES NU"* above *"ERSTATTES
 * AF"* above *"NY BESKED"*, each with its expiry, and two buttons — **Behold eksisterende
 * besked** and **Erstat med den nye besked**. *"Der kan kun vises én besked ad gangen.
 * Vælg, hvilken gæsterne skal se."*
 *
 * ================= THE HOURS ARE ALREADY PUBLIC =================
 *
 * 1ae says it twice and it is the thing to understand about this sheet: *"Åbningstiderne
 * bliver gemt uanset hvad — de to handlinger er adskilt."* By the time this is drawn the
 * override has been published and the `hours` tag has been expired. Neither button can
 * change that, and neither is offered as though it could: the question is only *which of
 * two messages* a guest reads.
 *
 * ================= WHY IT CANNOT BE DISMISSED =================
 *
 * 1ae: *"Arket kan ikke lukkes ved at trykke udenfor — der skal træffes et valg."*
 *
 *   * **Backdrop clicks** do nothing, because a native `<dialog>` opened with
 *     `showModal()` does nothing on a backdrop click. Not a handler — the platform.
 *   * **Focus is trapped** inside it and everything behind is inert, for the same reason.
 *   * **`Esc` resolves nothing** — `ModalDialog`'s `locked`. Mapping it to "Behold" would
 *     drop the new message on somebody's behalf; mapping it to "Erstat" would publish one.
 *     Both are decisions, and this sheet exists precisely because a decision is required.
 *   * **There are always two labelled ways out**, both visible, both 44 px, both operable
 *     by keyboard. A sheet with no exit would be the other way to get this wrong.
 *
 * Focus starts on **Behold eksisterende besked** — the choice that changes nothing a guest
 * can read — which is the same rule `DeleteDishDialog` follows for the same reason.
 *
 * ================= NOTHING HERE DECIDES ANYTHING =================
 *
 * Both messages and both expiries are handed in, already read from the database by the
 * screen: the current one from the announcement row, the proposed one from the generator
 * re-run against the *published* override. This file formats two instants and renders two
 * controls. It calls no generator, imports no coordinator, and has no branch in which it
 * could show one sentence and submit another — "Erstat" submits the wording the screen was
 * given, and the server regenerates everything else around it.
 */

export type ConflictAnnouncement = {
  readonly message: string
  /** The stored ISO instant. Printed here, never submitted. */
  readonly expiresAt: string | null
}

export type AnnouncementConflictSheetProps = {
  readonly idPrefix: string
  /** What a guest can read right now. */
  readonly current: ConflictAnnouncement
  /** What "Erstat" would publish — the generator's, against the published override. */
  readonly proposed: ConflictAnnouncement
  /** "Behold eksisterende besked": a link, because it writes nothing at all (§12). */
  readonly keepHref: string
  /** "Erstat med den nye besked". */
  readonly action: (formData: FormData) => Promise<void>
  readonly fieldNames: {
    readonly override: string
    readonly overrideVersion: string
    readonly version: string
    readonly message: string
    readonly confirm: string
  }
  readonly overrideId: string
  /** The version tokens the sheet was *rendered* with, so a change since is refused (§6). */
  readonly overrideVersion: string
  readonly version: string
  /** The wording the person approved, carried through the redirect that drew this. */
  readonly message: string
  /**
   * The id of the control this sheet was opened from — 1t's "Gem og offentliggør".
   *
   * §11: a dialog that takes focus owes it back. Both ways out of this sheet are *soft*
   * navigations — a `<Link>` and a Server Action redirect — so a fragment would move the
   * URL without moving the keyboard. `ModalDialog` focuses this id as it unmounts instead.
   */
  readonly returnFocusTo: string
}

export function AnnouncementConflictSheet({
  idPrefix,
  current,
  proposed,
  keepHref,
  action,
  fieldNames,
  overrideId,
  overrideVersion,
  version,
  message,
  returnFocusTo,
}: AnnouncementConflictSheetProps) {
  const headingId = `${idPrefix}-konflikt-titel`
  const explanationId = `${idPrefix}-konflikt-forklaring`

  return (
    <ModalDialog
      cancelHref={null}
      id={`${idPrefix}-konflikt`}
      labelledBy={headingId}
      locked
      returnFocusTo={returnFocusTo}
    >
      <div className="p-4 md:p-6">
        <div className="mb-2.5 flex items-start gap-3">
          {/*
            1ae's amber rotated square. `aria-hidden`, because the heading beside it says
            the same thing in words — 1aa: a state is never carried by a shape or a colour
            alone.
          */}
          <span aria-hidden="true" className="bg-warning mt-1 size-5 shrink-0 rotate-45" />
          <h2 className="text-heading font-sans font-semibold" id={headingId}>
            Der vises allerede en besked på hjemmesiden.
          </h2>
        </div>

        <p className="text-ink-2 mb-4" id={explanationId}>
          Der kan kun vises én besked ad gangen. Vælg, hvilken gæsterne skal se.
          Åbningstiderne er gemt uanset hvad.
        </p>

        <div className="flex flex-col gap-2.5">
          <AnnouncementCard
            announcement={current}
            eyebrow="Vises nu"
            headingId={`${idPrefix}-konflikt-nuvaerende`}
            tone="current"
          />

          {/* 1ae's own divider between the two. Decorative: the two eyebrows carry it. */}
          <div aria-hidden="true" className="flex items-center gap-2.5 px-1">
            <span className="bg-border h-px flex-1" />
            <span className="text-ink-3 font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
              Erstattes af
            </span>
            <span className="bg-border h-px flex-1" />
          </div>

          <AnnouncementCard
            announcement={proposed}
            eyebrow="Ny besked"
            headingId={`${idPrefix}-konflikt-ny`}
            tone="proposed"
          />
        </div>
      </div>

      {/*
        1ae's footer. Stacked on a phone and a row from `md` up, and the DOM order is the
        visual order at **both** sizes — Behold first, Erstat second — so the tab order and
        the reading order agree everywhere.

        That order is the desktop frame's exactly. It is also what the mobile frame's own
        caption asks for — *"På mobil ligger den primære handling nederst, inden for
        tommelfingerens rækkevidde"* — with the primary "Erstat" as the lower of the two.
        The mobile mockup happens to draw them the other way up; the caption is the half
        that states an intention, and an order that reversed itself between breakpoints
        would have to move focus order with it.
      */}
      <div className="border-border bg-section flex flex-col gap-2.5 border-t p-4 md:flex-row md:justify-end md:p-5">
        <Link
          className="rounded-field border-neutral-ink text-neutral-ink hover:bg-surface min-h-tap bg-surface inline-flex items-center justify-center px-5 font-semibold border-[1.5px]"
          data-autofocus
          href={keepHref}
        >
          Behold eksisterende besked
        </Link>

        <form action={action}>
          <input name={fieldNames.override} type="hidden" value={overrideId} />
          <input name={fieldNames.overrideVersion} type="hidden" value={overrideVersion} />
          <input name={fieldNames.version} type="hidden" value={version} />
          <input name={fieldNames.message} type="hidden" value={message} />
          <input name={fieldNames.confirm} type="hidden" value="1" />

          <button
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap flex w-full items-center justify-center px-5 font-semibold text-white md:w-auto"
            type="submit"
          >
            Erstat med den nye besked
          </button>
        </form>
      </div>
    </ModalDialog>
  )
}

/**
 * One of 1ae's two message cards.
 *
 * The eyebrow is a real heading, so the two messages are two named regions rather than two
 * anonymous boxes a screen reader reads as one run of text. "Aktiv" is drawn only on the
 * current one, because it is the only one that is: the proposed message is not published
 * and saying it was would be the sheet's own question answered in advance.
 */
function AnnouncementCard({
  announcement,
  eyebrow,
  headingId,
  tone,
}: {
  announcement: ConflictAnnouncement
  eyebrow: string
  headingId: string
  tone: 'current' | 'proposed'
}) {
  const expiry = formatExpiryStamp(announcement.expiresAt)

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-field border p-3 md:p-3.5 ${
        tone === 'proposed'
          ? 'border-brand-700 bg-brand-50 border-[1.5px]'
          : 'border-border bg-field-bg'
      }`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
        <h3
          className={`font-mono text-[0.6875rem] tracking-[0.14em] uppercase ${
            tone === 'proposed' ? 'text-brand-700' : 'text-ink-3'
          }`}
          id={headingId}
        >
          {eyebrow}
        </h3>

        {tone === 'current' ? (
          <span className="rounded-badge border-success-border bg-success-surface text-success-ink text-micro inline-flex items-center gap-1.5 border px-2 py-1 font-semibold">
            <span aria-hidden="true" className="bg-success size-1.5 rounded-full" />
            Aktiv
          </span>
        ) : null}
      </div>

      <p className="text-neutral-ink font-semibold">{announcement.message}</p>

      {expiry === null ? null : (
        <p className="text-ink-3 text-meta mt-1 tabular-nums">Udløber {expiry}</p>
      )}
    </section>
  )
}
