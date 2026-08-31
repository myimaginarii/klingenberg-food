import Link from 'next/link'

import { Notice, type NoticeTone } from '@/components/admin/Notice'
import {
  describeOverrideDay,
  overrideStateBadge,
  type OverrideLifecycle,
  type OverrideRemoval,
} from '@/lib/hours/override-form'
import type { OverrideContent } from '@/lib/hours/override-form'
import type { IsoDate } from '@/lib/time/calendar'

/**
 * What the one-off card says about itself — design 1t, 1aa; technical plan §5, §6, §7e.
 *
 * One file, for the reason `./HoursNotices.tsx` is one file: all of these are *reports*
 * rather than editors, and they share a vocabulary — the Kladde tone, the closed set of
 * status codes, the pending band with its own Offentliggør — that phases 5, 6 and 7
 * established and this one reuses rather than reinvents.
 *
 * Every status code here begins `enkelt_`, so the lower card's messages and the upper
 * card's cannot collide. `conflict` means "the week moved" above and "this date moved"
 * below, and those are two different sentences to two different people.
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
 */
const MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  enkelt_gemt: {
    tone: 'success',
    text: 'Ændringen er gemt som kladde. Hjemmesiden viser stadig de normale tider for den dag, indtil du trykker Gem og offentliggør.',
  },
  /*
   * A save that put the date back to what its row already held. The draft is gone, so the
   * Kladde badge and the dashboard count are gone with it (§4), and saying so plainly is
   * kinder than a "Gemt" that leaves somebody looking for a badge that is not there.
   */
  enkelt_uaendret: {
    tone: 'success',
    text: 'Ændringen er den samme som den, der allerede står for den dag, så der er ingen kladde at offentliggøre længere.',
  },
  enkelt_offentliggjort: {
    tone: 'success',
    text: 'Ændringen står nu på hjemmesiden. Den dag følger ikke længere de normale åbningstider.',
  },
  enkelt_fjernet: {
    tone: 'success',
    text: 'Ændringen er fjernet. Den dato følger igen de normale åbningstider.',
  },
  enkelt_kladde_fjernet: {
    tone: 'success',
    text: 'Kladden er fjernet. Det, der står på hjemmesiden, er uændret.',
  },
  /*
   * The date already had a change, and the version token in the form belonged to another
   * row — so nothing was written and the card was re-opened on that date instead. This is
   * the "two tabs, one date" answer as well as the "I typed a different date" one (§7e).
   */
  enkelt_findes: {
    tone: 'warning',
    text: 'Der er allerede en ændring for den dato. Herunder står den, som den er nu — ret i den, og gem igen.',
  },
  enkelt_intet_valgt: {
    tone: 'warning',
    text: 'Der er ingen ændring, der venter på at blive offentliggjort for den dato.',
  },
  enkelt_conflict: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så du retter i den nyeste version.',
  },
  enkelt_nothing_to_publish: {
    tone: 'warning',
    text: 'Der var ingen kladde at offentliggøre. Måske er den allerede offentliggjort i en anden fane.',
  },
  enkelt_ugyldig: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  enkelt_invalid: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  enkelt_invalid_draft: {
    tone: 'error',
    text: 'Den gemte kladde kan ikke læses, så den blev ikke offentliggjort. Gem felterne igen for at erstatte den.',
  },
  enkelt_forbidden: {
    tone: 'error',
    text: 'Du har ikke adgang til at ændre åbningstiderne for en enkelt dag.',
  },
  enkelt_not_found: { tone: 'error', text: 'Den ændring findes ikke længere.' },
  enkelt_failed: {
    tone: 'error',
    text: 'Ændringen kunne ikke gemmes. Intet blev ændret — prøv igen.',
  },
}

export function OverrideStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

  const message = MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}

/**
 * A stored draft that no longer satisfies its schema — technical plan §6, rule 4.
 *
 * `overlayDraft` refuses to apply half of a malformed draft, so the card shows what the row
 * itself holds. "No draft" and "a draft that cannot be read" look identical on screen and
 * only one of them needs doing something about, so it is said out loud — in the same words
 * and the same tone the other editors use for the same state.
 */
export function OverrideMalformedDraftNotice({ malformed }: { malformed: boolean }) {
  if (!malformed) return null

  return (
    <Notice tone="error">
      Den gemte kladde for den dato kan ikke læses og bliver ikke vist. Herunder står det,
      der gælder nu. Gem felterne igen for at erstatte kladden.
    </Notice>
  )
}

/**
 * "Søndag 14.09: Lukket hele dagen venter på at blive offentliggjort" — 1aa's pending band,
 * with this card's own Offentliggør.
 *
 * The sentence is derived from the stored row and its draft (`describeOverridePending`), so
 * the band cannot claim a change the database does not hold, and it names **which date** and
 * **what will happen** rather than saying "Ændringer".
 *
 * The form carries one field: the date. The server resolves the row, the version and the
 * entity from it, so the button is a request to publish that date's pending change rather
 * than a list of ids the browser chose.
 */
export function OverridePendingNotice({
  sentence,
  date,
  dateFieldName,
  action,
}: {
  readonly sentence: string | null
  readonly date: IsoDate
  readonly dateFieldName: string
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
          <p className="font-semibold">En ændring venter på at blive offentliggjort.</p>
          <p className="text-warning-ink-2 text-meta">{sentence}</p>
        </div>
      </div>

      <form action={action}>
        <input name={dateFieldName} type="hidden" value={date} />
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
 * "Fjern" — one control, three operations, and the one that a guest would notice asks
 * first.
 *
 * The destructive branch is a **link to a confirmation**, not a submit, for the reason
 * phase 5D's Slet ret is: pressing it must not remove anything. Navigating to a
 * confirmation is all the control does, so the removal cannot happen in one press — not
 * because a script intercepts it, but because there is nothing there to intercept. That
 * holds with JavaScript switched off, with a script error on the page, and with a
 * double-tap on a phone. The server checks the confirmation again for itself.
 *
 * The other two branches change nothing a guest can read, so they are ordinary submits.
 * Which branch is drawn is decided by `describeOverrideRemoval` from the row the *server*
 * read — the same function the action calls, so the label and the behaviour cannot drift.
 */
export function OverrideRemovalControl({
  removal,
  overrideId,
  version,
  confirming,
  confirmHref,
  cancelHref,
  fieldNames,
  action,
  idPrefix,
}: {
  readonly removal: OverrideRemoval | null
  readonly overrideId: string
  readonly version: string
  readonly confirming: boolean
  readonly confirmHref: string
  readonly cancelHref: string
  readonly fieldNames: { readonly id: string; readonly version: string; readonly confirm: string }
  readonly action: (formData: FormData) => Promise<void>
  readonly idPrefix: string
}) {
  if (removal === null) return null

  const describedBy = `${idPrefix}-fjern-forklaring`

  if (removal.confirms && !confirming) {
    return (
      <div className="border-border mt-5 flex flex-col gap-2 border-t pt-4">
        <Link
          aria-describedby={describedBy}
          className="rounded-field border-error text-error-ink hover:bg-error-surface min-h-tap bg-surface inline-flex w-full items-center justify-center border-[1.5px] px-4 font-semibold md:w-auto md:self-start"
          href={confirmHref}
        >
          {removal.label}
        </Link>
        <p className="text-ink-3 text-micro" id={describedBy}>
          {removal.description}
        </p>
      </div>
    )
  }

  return (
    <form
      action={action}
      aria-label={removal.label}
      className="border-border mt-5 flex flex-col gap-2 border-t pt-4"
    >
      <input name={fieldNames.id} type="hidden" value={overrideId} />
      <input name={fieldNames.version} type="hidden" value={version} />
      {removal.confirms ? <input name={fieldNames.confirm} type="hidden" value="1" /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          aria-describedby={describedBy}
          className="rounded-field border-error text-error-ink hover:bg-error-surface min-h-tap bg-surface inline-flex items-center border-[1.5px] px-4 font-semibold"
          type="submit"
        >
          {removal.confirms ? `Ja — ${removal.label.toLowerCase()}` : removal.label}
        </button>

        {removal.confirms ? (
          <Link
            className="rounded-field border-neutral-ink text-neutral-ink hover:bg-section min-h-tap bg-surface inline-flex items-center border-[1.5px] px-4 font-semibold"
            href={cancelHref}
          >
            Behold ændringen
          </Link>
        ) : null}
      </div>

      <p className="text-ink-3 text-micro" id={describedBy}>
        {removal.description}
      </p>
    </form>
  )
}

/**
 * The dates that already have a one-off change — 1t's card, with something in it.
 *
 * 1t draws one form and no list, because it draws one date being edited. A list is what
 * makes the rest of them reachable: §7e's rule is that somebody who picks a date with an
 * existing change must be shown *that* change rather than allowed to create a second one,
 * and a card with no way to see what exists would leave "which dates already have one?"
 * answerable only by typing dates until one of them is taken.
 *
 * It shows today onwards, in the administration's established list vocabulary, each row
 * naming its own state in words as well as in tone (1aa). A past date is not listed,
 * because §7e item 7 makes it uneditable and `overrides_select_public` makes it invisible.
 */
export function OverrideList({
  overrides,
  selectedDate,
  hrefFor,
  headingId,
}: {
  readonly overrides: readonly {
    readonly date: IsoDate
    readonly current: OverrideContent
    readonly lifecycle: OverrideLifecycle
  }[]
  readonly selectedDate: IsoDate
  readonly hrefFor: (date: IsoDate) => string
  readonly headingId: string
}) {
  return (
    <div className="border-border mt-5 border-t pt-4">
      <h3 className="text-meta text-neutral-ink font-semibold" id={headingId}>
        Kommende ændringer
      </h3>

      {overrides.length === 0 ? (
        <p className="text-ink-3 text-meta mt-2">
          Der er ingen ændringer for enkelte dage. Alle dage følger de normale åbningstider.
        </p>
      ) : (
        <ul aria-labelledby={headingId} className="border-border mt-2 rounded-card border">
          {overrides.map((override) => {
            const badge = overrideStateBadge(override.lifecycle)
            const selected = override.date === selectedDate

            return (
              <li
                className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
                key={override.date}
              >
                <span className="text-meta min-w-0">
                  {describeOverrideDay(override.date, override.current)}
                  {badge === null ? null : (
                    <span className="text-ink-3"> · {badge}</span>
                  )}
                </span>

                <Link
                  aria-current={selected ? 'true' : undefined}
                  className="text-brand-700 text-meta min-h-tap inline-flex items-center underline"
                  href={hrefFor(override.date)}
                >
                  {selected ? 'Vist herover' : 'Ret'}
                  <span className="sr-only"> — {describeOverrideDay(override.date, override.current)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * What a staff member sees where the owner sees the recurring week — §5, §0i.
 *
 * §5 says Owner-only areas are **absent** for Staff rather than shown-and-disabled, and
 * phase 8A applied that by keeping the whole screen away from them. Phase 8B cannot: the
 * one-off card on the same screen is theirs, and §5 puts it in both columns. So the
 * Owner-only *card* is what is absent, and a statement stands in its place — the same
 * choice phase 7 made for the visibility switch when there was nothing to switch.
 *
 * It is not a locked form. There is no `<form>`, no field and no control here at all, so
 * there is nothing to submit and nothing that could be re-enabled from the browser. The
 * enforcement is not this component: `requireOwner()` in the weekly card's two Server
 * Actions and `opening_hours_update_owner` in the database are, and they refuse a staff
 * member whatever this screen renders.
 */
export function WeeklyHoursOwnerOnlyNotice() {
  return (
    <section
      aria-labelledby="normale-tider-titel"
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
    >
      <h2 className="text-heading font-sans font-semibold" id="normale-tider-titel">
        Normale åbningstider
      </h2>
      <p className="text-ink-2 text-meta mt-2">
        De faste tider for ugens syv dage kan kun ejeren rette. De står i bunden af alle
        sider, på Find os og bag “Åbent nu”.
      </p>
      <p className="text-ink-2 text-meta mt-2">
        Skal en enkelt dag være anderledes — en lukkedag eller andre tider — kan du gøre det
        herunder uden at ændre den normale uge.
      </p>
    </section>
  )
}
