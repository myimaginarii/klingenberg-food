import type { PendingChange } from '@/lib/publishing/pending'

/**
 * "1 prisændring er ikke offentliggjort" — design 1y (the band beneath the list) and
 * 1aa ("2 ændringer venter på at blive offentliggjort").
 *
 * Derived from `pending_changes`, the view that reads `draft is not null` (§4), so the
 * count is the database's answer rather than anything the screen remembers. If the
 * band says two, there are two drafts.
 *
 * It carries its own Offentliggør, because on a phone the top bar has scrolled away by
 * the time a person has finished editing — which is exactly why 1y draws it here. The
 * action takes no input at all: it re-reads what is pending on the server (see
 * `publish-actions.ts`), so the button is a request to publish this screen's scope, not
 * a list of ids the browser chose.
 */
export function MenuPendingNotice({
  pending,
  action,
}: {
  pending: readonly PendingChange[]
  action: () => Promise<void>
}) {
  if (pending.length === 0) return null

  const count = pending.length
  const names = pending
    .map((change) => change.subject)
    .filter((subject): subject is string => subject !== null)

  return (
    <div
      className="rounded-card border-warning-border bg-warning-surface border-l-warning flex flex-col gap-3 border border-l-4 p-3 md:flex-row md:items-center md:px-4"
      role="status"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden="true" className="bg-warning size-4 shrink-0 rotate-45" />

        <p className="text-warning-ink min-w-0 flex-1 font-semibold">
          {count === 1
            ? 'Én ændring i menuen er ikke offentliggjort.'
            : `${String(count)} ændringer i menuen er ikke offentliggjort.`}
          {names.length > 0 ? (
            <span className="text-warning-ink-2 block text-meta font-normal">
              {names.join(' · ')}
            </span>
          ) : null}
        </p>
      </div>

      {/* Full width on a phone, where 1y draws it as the band's own action; inline
          beside the sentence from `md` up, where there is room for both. */}
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
