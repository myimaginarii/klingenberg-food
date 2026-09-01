import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { ModalDialog } from '@/components/admin/menu/ModalDialog'
import { UndoStrip, UndoSubmit } from '@/components/admin/menu/UndoStrip'

import {
  MonthlyAvailabilityFields,
  MONTHLY_AVAILABILITY_LABEL,
  type MonthlyAvailabilityForm,
} from './MonthlyAvailability'

/**
 * The five things this screen says about itself — design 1aa, 1ah; §6, §7d.
 *
 * One file, because all five are *reports or questions* rather than editors, and because
 * the vocabulary they share — the Kladde tone, the green Fortryd strip, the closed set of
 * status codes, the modal confirmation — is the one phases 5 and 6A established and this
 * phase reuses rather than reinvents.
 */

/**
 * What just happened — design 1aa ("BESKEDER I ADMIN").
 *
 * The Server Actions redirect back with one code from a closed set, so the report
 * survives a page load and needs no client state. A code that is not in this table
 * produces nothing at all, which is what stops a query string somebody typed by hand
 * from putting a sentence on the screen.
 *
 * The conflict wording is the design's own: **"Nogen andre har rettet dette."** Nothing
 * was overwritten and nothing was lost (§6, §7e item 2).
 *
 * `offentliggjort_planlagt` is deliberately **not** in this table. §7d requires that
 * message to name the date the burger will appear on, and a date cannot be a constant —
 * it is composed by `describeScheduledPublish` from the published `starts_on` and handed
 * in as `scheduledMessage`.
 */
const MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  gemt: {
    tone: 'success',
    text: 'Månedens burger er gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  // "Ryd felterne" (1ah). The sentence says what happened *and* what did not, because
  // an emptied card is alarming until you know the hjemmeside is untouched.
  ryddet: {
    tone: 'success',
    text: 'Felterne er ryddet i kladden. Hjemmesiden viser stadig den burger, der er offentliggjort.',
  },
  // The image slot (phase 10C-1). A selection is a draft like any other field, and
  // the removal sentence says the §10 distinction out loud: nothing left the library.
  billede_gemt: {
    tone: 'success',
    text: 'Billedet er gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  billede_fjernet: {
    tone: 'success',
    text: 'Billedet er fjernet i kladden — det bliver i billedbiblioteket. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  billede_findes_ikke: {
    tone: 'error',
    text: 'Billedet findes ikke længere i biblioteket. Intet blev gemt — vælg et andet billede.',
  },
  offentliggjort: {
    tone: 'success',
    text: 'Månedens burger er opdateret på hjemmesiden.',
  },
  // §7d's other end: publishing a period that has already finished is allowed once
  // somebody has confirmed it, and the result is said plainly rather than dressed up as
  // a success.
  offentliggjort_udloebet: {
    tone: 'warning',
    text: 'Offentliggjort. Perioden er allerede forbi, så burgeren vises hverken på menuen eller på forsiden.',
  },
  offentliggjort_tomt: {
    tone: 'warning',
    text: 'Offentliggjort. Der står ikke noget navn, så menuen viser feltet som “ikke oplyst endnu”, og forsiden viser intet afsnit.',
  },
  intet_valgt: {
    tone: 'warning',
    text: 'Der er ingen ændringer, der venter på at blive offentliggjort.',
  },
  publish_failed: {
    tone: 'error',
    text: 'Ændringerne kunne ikke offentliggøres. Intet blev ændret — prøv igen.',
  },
  conflict: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så du retter i den nyeste version.',
  },
  ugyldig: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  invalid: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  // The immediate availability path (§6, §7b). A success has no entry here: it is
  // reported by the green Fortryd strip, and two confirmations of one change is one too
  // many.
  uaendret: {
    tone: 'success',
    text: 'Det stod allerede sådan på hjemmesiden. Intet blev ændret.',
  },
  udsolgt_dato: {
    tone: 'error',
    text: 'Tilgængeligheden kunne ikke ændres, fordi datoen ikke passede. Hent siden igen og prøv en gang til.',
  },
  forbidden: { tone: 'error', text: 'Du har ikke adgang til at rette Månedens burger.' },
  not_found: { tone: 'error', text: 'Månedens burger findes ikke.' },
  failed: { tone: 'error', text: 'Ændringen kunne ikke gemmes. Intet blev ændret — prøv igen.' },
}

/** The one status whose sentence carries a real date, and is therefore composed. */
export const SCHEDULED_PUBLISH_STATUS = 'offentliggjort_planlagt'

export function MonthlyStatusNotice({
  status,
  scheduledMessage,
}: {
  status?: string
  /** `describeScheduledPublish(...)`, composed on the page from the published dates. */
  scheduledMessage: string
}) {
  if (status === undefined) return null

  if (status === SCHEDULED_PUBLISH_STATUS) {
    return <Notice tone="success">{scheduledMessage}</Notice>
  }

  const message = MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}

/**
 * A stored draft that no longer satisfies its schema — technical plan §6, rule 4.
 *
 * `overlayDraft` refuses to apply half of a malformed draft: showing a mixture nobody
 * wrote and nobody could publish would be worse than showing none of it. But "no draft"
 * and "a draft that cannot be read" look identical on screen, and only one of them is
 * something a person needs to do anything about — so it is said out loud, in the same
 * words and the same tone the other editors use for the same state.
 */
export function MonthlyMalformedDraftNotice({ malformed }: { malformed: boolean }) {
  if (!malformed) return null

  return (
    <Notice tone="error">
      Den gemte kladde kan ikke læses og bliver ikke vist. Gem felterne igen for at
      erstatte den.
    </Notice>
  )
}

/**
 * "Ny pris afventer offentliggørelse" — 1aa's pending band, with this screen's own
 * Offentliggør.
 *
 * Derived from the stored draft's own changed fields (`describeMonthlyPending`), so the
 * band cannot claim a change the database does not hold, and it names **which** fields
 * are waiting rather than saying "Ændringer".
 *
 * The action takes no content at all: it re-reads what is pending on the server (see
 * `publish-actions.ts`), so the button is a request to publish this screen's scope, not
 * a list of ids the browser chose. It is a `<form>` rather than a bare button because
 * the publish action reads one field — §7d's expired-period confirmation — and this
 * button deliberately does not carry it, so pressing it on an expired window asks the
 * question rather than answering it.
 */
export function MonthlyPendingNotice({
  sentence,
  action,
}: {
  readonly sentence: string | null
  readonly action: (formData: FormData) => Promise<void>
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
 * The ~10-second Fortryd after an immediate availability change — 1aa, §6.
 *
 * The bar, its timer and its button are `UndoStrip`, shared with the menu and weekly
 * screens; what is here is the half that is about *this* operation — which fields the
 * Fortryd submits. The sentence itself is composed by
 * `describeMonthlyAvailabilityChange` in `lib/menu/monthly-availability.ts` and handed
 * in, the same way the other strips are handed theirs: vocabulary belongs beside the
 * rules, where the unit suite can assert it.
 *
 * **THE CHANGE IS ALREADY LIVE.** This is not a confirmation and not a pending state.
 * The column changed, the `monthly` cache tag was expired and an audit row was written
 * before this strip was rendered at all. Fortryd is a *second* write down the same path,
 * with the same guard, the same validation, the same concurrency check and its own audit
 * row. Nothing authoritative lives in the browser: the two values the form carries both
 * come back from the server that performed the write, and neither is trusted on the way
 * in.
 *
 * It does not move focus — `UndoStrip` is `role="status"` and `AutoDismiss` will not
 * remove the strip while focus is inside it (1aa).
 */
export function MonthlyAvailabilityUndo({
  form,
  message,
  version,
  /** The state Fortryd would restore — the opposite of what the burger is in now. */
  restoreSoldOut,
}: {
  form: MonthlyAvailabilityForm
  message: string
  version: string
  restoreSoldOut: boolean
}) {
  return (
    // `key` on the version token: a second change is a new message with a fresh ten
    // seconds, rather than the previous one's timer running out under it.
    <UndoStrip key={version} message={message}>
      <form action={form.action}>
        <MonthlyAvailabilityFields
          fieldNames={form.fieldNames}
          soldOut={restoreSoldOut}
          version={version}
        />
        <UndoSubmit>sæt {MONTHLY_AVAILABILITY_LABEL} tilbage</UndoSubmit>
      </form>
    </UndoStrip>
  )
}

/**
 * "Denne periode er allerede forbi" — §7d's own warning, as the approved confirmation.
 *
 * Nothing has happened when this is on screen. The first press reached the server, which
 * computed what publishing *would* put live, saw a window that has already ended, and
 * **published nothing**; this dialog is what the screen renders in response, and its
 * button is the only control on the site that submits the confirmation field. A person
 * who types the confirmation's address by hand gets the question, not the answer.
 *
 * **The dates are not touched by either choice.** §7d asks for a warning, and a warning
 * that silently moved `ends_on` forward would be an administration deciding what
 * somebody meant. So the safe choice simply returns to the form, where the period is a
 * field they can change.
 *
 * It is the same `ModalDialog` the deletion and copy confirmations use, so the rules 1ae
 * fixes for this administration's dialogs hold here too: focus moves in, focus is
 * trapped, clicking the backdrop does not dismiss it, and Esc performs the same
 * navigation the cancel link does — which returns the keyboard to the Offentliggør
 * button this was opened from.
 *
 * The **safe** choice is first and focused. A confirmation that opens with the keyboard
 * on the consequential control is a confirmation that can be dismissed by a reflex
 * Enter.
 */
export function MonthlyExpiredPublishDialog({
  anchorId,
  action,
  confirmField,
  cancelHref,
  warning,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  confirmField: string
  /** Back to the Offentliggør button, so focus returns where it started. */
  cancelHref: string
  /** `describeExpiredPublishWarning(...)` — §7d's sentence, with the real date in it. */
  warning: string
}) {
  const headingId = `${anchorId}-titel`

  return (
    <ModalDialog cancelHref={cancelHref} id={anchorId} labelledBy={headingId}>
      <div className="flex flex-col gap-4 p-4 md:p-5">
        <div>
          <h2 className="text-heading font-sans font-semibold" id={headingId}>
            Perioden er allerede forbi
          </h2>
          <p className="text-ink-2 text-meta mt-1">{warning}</p>
        </div>

        <p className="rounded-field border-warning-border bg-warning-surface text-warning-ink flex items-start gap-2 border px-3 py-2 text-meta font-medium">
          <span aria-hidden="true" className="bg-warning mt-1.5 size-2 shrink-0 rotate-45" />
          <span>
            Du kan godt offentliggøre den. Den bliver bare ikke vist, før slutdatoen er
            i dag eller senere.
          </span>
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <a
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex items-center px-5 font-semibold text-white"
            data-autofocus
            href={cancelHref}
          >
            Ret perioden
          </a>

          <form action={action}>
            <input name={confirmField} type="hidden" value="1" />
            <button
              className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section min-h-tap bg-surface inline-flex items-center border-[1.5px] px-4 font-semibold"
              type="submit"
            >
              Offentliggør alligevel
            </button>
          </form>
        </div>
      </div>
    </ModalDialog>
  )
}
