import { Notice, type NoticeTone } from '@/components/admin/Notice'

/**
 * The three things this screen says about itself — design 1aa, 1ad; §6, §7c.
 *
 * One file, because all three are *reports* rather than editors, and because the
 * vocabulary they share — the Kladde tone, the closed set of status codes, the pending
 * band with its own Offentliggør — is the one phases 5 and 6 established and this phase
 * reuses rather than reinvents.
 */

/**
 * What just happened — design 1aa ("BESKEDER I ADMIN").
 *
 * The Server Actions redirect back with one code from a closed set, so the report
 * survives a page load and needs no client state. A code that is not in this table
 * produces nothing at all, which is what stops a query string somebody typed by hand from
 * putting a sentence on the screen.
 *
 * The conflict wording is the design's own: **"Nogen andre har rettet dette."** Nothing
 * was overwritten and nothing was lost (§6, §7e item 2).
 *
 * The three `kan_ikke_*` codes are the answer to a press that got past a greyed-out
 * Offentliggør — a second tab, a stale page, a forged POST. They say the same thing the
 * button's own explanation says, because they are about the same rule (1ac: "Udløb er
 * påkrævet").
 */
const MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  gemt: {
    tone: 'success',
    text: 'Beskeden er gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  offentliggjort: {
    tone: 'success',
    text: 'Beskeden er nu på hjemmesiden. Den forsvinder af sig selv, når udløbstidspunktet passerer.',
  },
  intet_valgt: {
    tone: 'warning',
    text: 'Der er ingen ændringer, der venter på at blive offentliggjort.',
  },
  kan_ikke_blank: {
    tone: 'warning',
    text: 'Der er ingen besked at offentliggøre. Skriv teksten, og gem den først.',
  },
  kan_ikke_no_expiry: {
    tone: 'warning',
    text: 'Beskeden blev ikke offentliggjort: den mangler et udløbstidspunkt.',
  },
  kan_ikke_expired: {
    tone: 'warning',
    text: 'Beskeden blev ikke offentliggjort: udløbstidspunktet er allerede passeret. Vælg et tidspunkt ude i fremtiden.',
  },
  publish_failed: {
    tone: 'error',
    text: 'Beskeden kunne ikke offentliggøres. Intet blev ændret — prøv igen.',
  },
  conflict: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så du retter i den nyeste version.',
  },
  ugyldig: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  invalid: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  forbidden: { tone: 'error', text: 'Du har ikke adgang til at rette beskeden.' },
  not_found: { tone: 'error', text: 'Beskeden findes ikke.' },
  failed: { tone: 'error', text: 'Ændringen kunne ikke gemmes. Intet blev ændret — prøv igen.' },
}

export function AnnouncementStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

  const message = MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}

/**
 * A stored draft that no longer satisfies its schema — technical plan §6.
 *
 * `overlayDraft` refuses to apply half of a malformed draft: showing a mixture nobody
 * wrote and nobody could publish would be worse than showing none of it. But "no draft"
 * and "a draft that cannot be read" look identical on screen, and only one of them is
 * something a person needs to do anything about — so it is said out loud, in the same
 * words and the same tone the other editors use for the same state.
 */
export function AnnouncementMalformedDraftNotice({ malformed }: { malformed: boolean }) {
  if (!malformed) return null

  return (
    <Notice tone="error">
      Den gemte kladde kan ikke læses og bliver ikke vist. Gem felterne igen for at
      erstatte den.
    </Notice>
  )
}

/**
 * "Ændringer venter på at blive offentliggjort" — 1aa's pending band, with this screen's
 * own Offentliggør.
 *
 * Derived from the stored draft's own changed fields (`describeAnnouncementPending`), so
 * the band cannot claim a change the database does not hold, and it names **which**
 * fields are waiting rather than saying "Ændringer".
 *
 * The action takes no content at all: it re-reads what is pending on the server (see
 * `publish-actions.ts`), so the button is a request to publish this screen's scope, not a
 * list of ids the browser chose.
 *
 * When the pending draft **cannot** be published — no message, no expiry, or an expiry
 * that has passed — the band shows the reason instead of the button. A greyed-out button
 * here as well as in the bar would be the same refusal twice; the sentence is the part
 * that tells somebody what to do about it (1ad).
 */
export function AnnouncementPendingNotice({
  sentence,
  obstacle,
  action,
}: {
  readonly sentence: string | null
  /** Why publishing is unavailable, or null when it is available. */
  readonly obstacle: string | null
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
          {obstacle === null ? null : (
            <p className="text-warning-ink-2 text-meta mt-1 font-medium">{obstacle}</p>
          )}
        </div>
      </div>

      {obstacle === null ? (
        <form action={action}>
          <button
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap flex w-full items-center justify-center px-5 font-semibold text-white md:w-auto"
            type="submit"
          >
            Offentliggør
          </button>
        </form>
      ) : null}
    </div>
  )
}
