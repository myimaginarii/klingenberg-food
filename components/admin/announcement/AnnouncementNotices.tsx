import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { UndoStrip, UndoSubmit } from '@/components/admin/menu/UndoStrip'

import {
  AnnouncementVisibilityFields,
  ANNOUNCEMENT_VISIBILITY_LABEL,
  type AnnouncementVisibilityForm,
} from './AnnouncementVisibility'

/**
 * The four things this screen says about itself — design 1aa, 1ad; §6, §7c.
 *
 * One file, because all four are *reports* rather than editors, and because the
 * vocabulary they share — the Kladde tone, the green Fortryd strip, the closed set of
 * status codes, the pending band with its own Offentliggør — is the one phases 5 and 6
 * established and this phase reuses rather than reinvents.
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
  // A stored draft that no longer satisfies its schema. Nothing was published, nothing
  // was merged and the draft is still there — so the sentence names the one thing that
  // helps rather than inviting a retry that would meet the same answer. It is the same
  // recovery path {@link AnnouncementMalformedDraftNotice} gives, said again where the
  // press was made.
  kan_ikke_unreadable_draft: {
    tone: 'warning',
    text: 'Beskeden blev ikke offentliggjort: den gemte kladde kan ikke læses. Gem felterne igen for at erstatte den.',
  },
  publish_failed: {
    tone: 'error',
    text: 'Beskeden kunne ikke offentliggøres. Intet blev ændret — prøv igen.',
  },
  conflict: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så du retter i den nyeste version.',
  },
  // The immediate visibility path (§6, 1ad). A success has no entry here: it is reported
  // by the green Fortryd strip, and two confirmations of one change is one too many.
  uaendret: {
    tone: 'success',
    text: 'Det stod allerede sådan på hjemmesiden. Intet blev ændret.',
  },
  // The refusals of the **on** direction (§0h) — met by a Fortryd whose message expired
  // inside the ten seconds it was offered, and by a "Vis besked" pressed on a message
  // that has since expired. One fact, one sentence: the published message is not one a
  // guest could be given, nothing came back to the hjemmeside, and the way forward is a
  // new expiry through the three steps. Nothing here moved the deadline to make the
  // press succeed.
  vis_udloebet: {
    tone: 'warning',
    text: 'Beskeden er udløbet, så den kunne ikke vises igen. Vælg et nyt udløbstidspunkt, og offentliggør beskeden igen, hvis den skal frem.',
  },
  vis_tom: {
    tone: 'warning',
    text: 'Der er ingen besked at vise. Skriv teksten, og offentliggør den.',
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

/**
 * The ~10-second Fortryd after an immediate visibility change — 1aa, §6, 1ad.
 *
 * The bar, its timer and its button are `UndoStrip`, shared with the menu, weekly and
 * monthly screens; what is here is the half that is about *this* operation — which fields
 * the Fortryd submits. The sentence itself is composed by
 * `describeAnnouncementVisibilityChange` in `lib/announcements/visibility.ts` and handed
 * in, the same way the other strips are handed theirs: vocabulary belongs beside the
 * rules, where the unit suite can assert it.
 *
 * **THE CHANGE IS ALREADY LIVE.** This is not a confirmation and not a pending state. The
 * column changed, the `announcement` cache tag was expired and an audit row was written
 * before this strip was rendered at all. Fortryd is a *second* write down the same path,
 * with the same guard, the same validation, the same concurrency check and its own audit
 * row. Nothing authoritative lives in the browser: the two values the form carries both
 * come back from the server that performed the write, and neither is trusted on the way
 * in. The ten seconds are a message's lifetime, never a security boundary.
 *
 * **It restores visibility, and only visibility.** The same published message, the same
 * link, the same expiry — not a replacement, not a restore from `previous`, and never a
 * pending draft made public.
 *
 * It does not move focus — `UndoStrip` is `role="status"` and `AutoDismiss` will not
 * remove the strip while focus is inside it (1aa).
 */
export function AnnouncementVisibilityUndo({
  form,
  message,
  version,
  /** The state Fortryd would restore — the opposite of what the bar is in now. */
  restoreVisible,
}: {
  form: AnnouncementVisibilityForm
  message: string
  version: string
  restoreVisible: boolean
}) {
  return (
    // `key` on the version token: a second change is a new message with a fresh ten
    // seconds, rather than the previous one's timer running out under it.
    <UndoStrip key={version} message={message}>
      <form action={form.action}>
        <AnnouncementVisibilityFields
          fieldNames={form.fieldNames}
          version={version}
          visible={restoreVisible}
        />
        <UndoSubmit>vis {ANNOUNCEMENT_VISIBILITY_LABEL} igen</UndoSubmit>
      </form>
    </UndoStrip>
  )
}
