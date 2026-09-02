/**
 * The three pending-state marks every draft editor draws — design 1aa ("MÆRKATER &
 * STATUS"), 1u, 1aj, 1v; technical plan §6.
 *
 * One file, shared since phase 11B, because three section screens (Forsiden, Mad ud
 * af huset, Kontaktoplysninger) draw the same band, the same pill and the same card
 * badge in the same tokens — and a badge that drifted between them would be a design
 * change nobody made. Presentation only: which sentence the band says and which cards
 * are pending are each screen's own rules (`lib/pages/home.ts`,
 * `lib/pages/takeaway.ts`, `lib/contact/editor.ts`).
 */

/**
 * 1aa's pending band, with the screen's own Offentliggør.
 *
 * `sentence` names **which** sections or fields are waiting, derived by the caller
 * from the stored draft's own keys, so the band cannot claim a change the database
 * does not hold. The action takes no content: it re-reads what is pending on the
 * server.
 */
export function PendingBand({
  sentence,
  action,
}: {
  readonly sentence: string | null
  readonly action: () => Promise<void>
}) {
  if (sentence === null) return null

  return (
    <div
      className="rounded-card border-warning-border bg-warning-surface border-l-warning flex flex-col gap-3 border border-l-4 p-3 md:flex-row md:items-center md:px-4"
      role="status"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden="true" className="bg-warning mt-1 size-4 shrink-0 rotate-45" />

        <div className="text-warning-ink min-w-0 flex-1">
          <p className="font-semibold">Ændringer venter på at blive offentliggjort.</p>
          <p className="text-warning-ink-2 text-meta">{sentence}</p>
        </div>
      </div>

      <form action={action}>
        <button
          className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap flex w-full items-center justify-center px-5 font-semibold text-white md:w-auto"
          type="submit"
        >
          Offentliggør
        </button>
      </form>
    </div>
  )
}

/**
 * The pill in the burgundy bar: "Kladde" while something waits, "Offentliggjort"
 * otherwise — the same badge every section bar draws, in the same tokens.
 */
export function StateBadge({ pending }: { pending: boolean }) {
  return (
    <span
      className={`rounded-badge inline-flex items-center gap-2 border px-3 py-1.5 text-meta font-semibold ${
        pending
          ? 'border-warning-border bg-warning-surface text-warning-ink'
          : 'border-white/50 text-white'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rotate-45 ${pending ? 'bg-warning' : 'bg-white'}`}
      />
      {pending ? 'Kladde' : 'Offentliggjort'}
    </span>
  )
}

/**
 * The Kladde badge on a card — the phase-5 vocabulary and tokens (1aa), with the
 * frame's own sentence beside it. Warning tone, a shape before the words, and the
 * words carry the meaning, so the state survives the colours being switched off. Not
 * a live region: the pending band above the cards is the screen's status announcement.
 */
export function CardPendingBadge({ note }: { note: string }) {
  return (
    <p className="flex flex-wrap items-center gap-2">
      <span className="rounded-badge border-warning-border bg-warning-surface text-warning-ink inline-flex items-center gap-2 border px-3 py-1.5 text-meta font-semibold">
        <span aria-hidden="true" className="bg-warning size-2 shrink-0 rotate-45" />
        Kladde
      </span>
      <span className="text-warning-ink text-meta">{note}</span>
    </p>
  )
}
