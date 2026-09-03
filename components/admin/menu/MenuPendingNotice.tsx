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
 *
 * TWO ARRANGEMENTS (phase 12A)
 *
 * 1y draws the band as **one row** — the sentence on the left, Offentliggør on the
 * right — at the foot of the phone screen, where the page keeps it in view (see the
 * menu page's foot). So below `md` the band is that one row and the list of names is
 * not drawn: each pending row already carries its Kladde badge and its own sentence,
 * and a band that grew a line per dish would eat the screen it is pinned to. From `md`
 * the names are back beneath the sentence, as before.
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
      className="rounded-card border-warning-border bg-warning-surface border-l-warning flex items-center gap-3 border border-l-4 p-3 md:px-4"
      role="status"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden="true" className="bg-warning size-4 shrink-0 rotate-45" />

        <p className="text-warning-ink min-w-0 flex-1 text-meta font-semibold wrap-anywhere md:text-body">
          {count === 1
            ? 'Én ændring i menuen er ikke offentliggjort.'
            : `${String(count)} ændringer i menuen er ikke offentliggjort.`}
          {names.length > 0 ? (
            <span className="text-warning-ink-2 hidden text-meta font-normal md:block">
              {names.join(' · ')}
            </span>
          ) : null}
        </p>
      </div>

      {/* Beside the sentence at every width — 1y's band is one row, and so is 1r's. */}
      <form action={action} className="shrink-0">
        <button
          className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap flex items-center justify-center px-5 font-semibold text-white"
          type="submit"
        >
          Offentliggør
        </button>
      </form>
    </div>
  )
}
