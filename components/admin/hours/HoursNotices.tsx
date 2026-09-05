import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { RATE_LIMIT_NOTICE, RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

/**
 * The three things the Åbningstider screen says about itself — design 1aa, 1t; §5, §6.
 *
 * One file, because all three are *reports* rather than editors, and because the
 * vocabulary they share — the Kladde tone, the closed set of status codes, the pending
 * band with its own Offentliggør — is the one phases 5, 6 and 7 established and this phase
 * reuses rather than reinvents.
 *
 * There is no Fortryd strip here, and that is a property of the content rather than an
 * omission: the recurring weekly schedule has no immediate path. §6 names exactly four
 * operations that write the hjemmeside at once, and none of them is the opening hours — so
 * every change on this screen is a draft that waits for Offentliggør, and there is never a
 * live change to offer to undo.
 */

/**
 * What just happened — design 1aa ("BESKEDER I ADMIN").
 *
 * The Server Actions redirect back with one code from a closed set, so the report survives
 * a page load and needs no client state. A code that is not in this table produces nothing
 * at all, which is what stops a query string somebody typed by hand from putting a sentence
 * on the screen.
 *
 * The conflict wording is the design's own: **"Nogen andre har rettet dette."** Nothing was
 * overwritten and nothing was lost (§6, §7e item 2).
 *
 * `forbidden` is in the table even though a staff member never reaches this screen —
 * `requireOwner()` sends them to /admin/ingen-adgang before a single field is rendered. It
 * is here for the owner whose role is changed while the screen is open in another tab: the
 * save is refused by `mayChangeEntity` and again by RLS, and "Kun ejeren kan rette de
 * normale åbningstider" is a better answer than a silent no-op.
 */
const MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  gemt: {
    tone: 'success',
    text: 'Åbningstiderne er gemt som kladde. Hjemmesiden viser stadig de gamle tider, indtil du trykker Offentliggør.',
  },
  /*
   * A save that put the week back to what is already published. The draft is gone, so the
   * Kladde badge and the dashboard count are gone with it (§4), and saying so plainly is
   * kinder than a "Gemt" that leaves somebody looking for a badge that is not there.
   */
  uaendret: {
    tone: 'success',
    text: 'Tiderne er de samme som dem, der står på hjemmesiden, så der er ingen kladde at offentliggøre længere.',
  },
  offentliggjort: {
    tone: 'success',
    text: 'De nye åbningstider står nu på hjemmesiden.',
  },
  intet_valgt: {
    tone: 'warning',
    text: 'Der er ingen ændringer, der venter på at blive offentliggjort.',
  },
  conflict: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så du retter i den nyeste version.',
  },
  ugyldig: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  invalid: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  invalid_draft: {
    tone: 'error',
    text: 'Den gemte kladde kan ikke læses, så den blev ikke offentliggjort. Ret dagene og gem igen.',
  },
  nothing_to_publish: {
    tone: 'warning',
    text: 'Der var ingen kladde at offentliggøre. Måske er den allerede offentliggjort i en anden fane.',
  },
  forbidden: {
    tone: 'error',
    text: 'Kun ejeren kan rette de normale åbningstider.',
  },
  not_found: { tone: 'error', text: 'Åbningstiderne findes ikke.' },
  publish_failed: {
    tone: 'error',
    text: 'Ændringerne kunne ikke offentliggøres. Intet blev ændret — prøv igen.',
  },
  failed: { tone: 'error', text: 'Ændringen kunne ikke gemmes. Intet blev ændret — prøv igen.' },
  // The limiter's refusal (phase 13B): the one code and sentence every screen shares.
  [RATE_LIMIT_STATUS]: RATE_LIMIT_NOTICE,
}

export function HoursStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

  const message = MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}

/**
 * A stored draft that no longer satisfies its schema — technical plan §6, rule 4.
 *
 * `overlayDraft` refuses to apply half of a malformed draft: showing a mixture nobody wrote
 * and nobody could publish would be worse than showing none of it. But "no draft" and "a
 * draft that cannot be read" look identical on screen, and only one of them is something a
 * person needs to do anything about — so it is said out loud, in the same words and the same
 * tone the other editors use for the same state.
 *
 * The screen therefore shows the **published** week while this is on screen, which is the
 * honest answer: those are the hours the hjemmeside is serving.
 */
export function HoursMalformedDraftNotice({ malformed }: { malformed: boolean }) {
  if (!malformed) return null

  return (
    <Notice tone="error">
      Den gemte kladde kan ikke læses og bliver ikke vist. Herunder står de tider, der er
      offentliggjort. Gem ugen igen for at erstatte kladden.
    </Notice>
  )
}

/**
 * "Onsdag og torsdag venter på at blive offentliggjort" — 1aa's pending band, with this
 * screen's own Offentliggør.
 *
 * The sentence is derived from the stored draft and the published schedule
 * (`describeWeeklyHoursPending`), so the band cannot claim a change the database does not
 * hold, and it names **which days** are waiting rather than saying "Ændringer".
 *
 * The action takes no input at all: it re-reads what is pending on the server (see
 * `publish-actions.ts`), so the button is a request to publish this screen's scope, not a
 * list of ids the browser chose.
 */
export function HoursPendingNotice({
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
 * The pill in the burgundy bar.
 *
 * It says "Kladde" while a draft is waiting and "Live" otherwise — the same substitution
 * the monthly screen's badge makes, and for the same reason: a person who has just typed
 * something needs to know that what they are looking at is not what the hjemmeside says.
 * The state is carried by the word, and only decorated by the tone (1aa).
 */
export function HoursStateBadge({ pending }: { pending: boolean }) {
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
      {pending ? 'Kladde' : 'Live'}
    </span>
  )
}
