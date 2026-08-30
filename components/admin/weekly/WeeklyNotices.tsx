import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { UndoStrip, UndoSubmit } from '@/components/admin/menu/UndoStrip'
import type { WeeklySoldOutTarget } from '@/lib/menu/weekly'

import {
  WeeklyAvailabilityFields,
  type WeeklyAvailabilityForm,
} from './WeeklyAvailability'

/**
 * The four things this screen says about itself — design 1aa, 1ag.
 *
 * One file, because all four are *reports* rather than controls, and because the
 * vocabulary they share — the Kladde tone, the green Fortryd strip, the closed set of
 * status codes — is the one phase 5 established and this phase reuses rather than
 * reinvents.
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
 */
const MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  // "Hjemmesiden er uændret" rather than "den er ikke på hjemmesiden endnu": these two
  // sentences name a *card*, and the card normally is on the hjemmeside already — in the
  // version that is published. What is not there yet is the change. It is the same
  // sentence the Månedens burger screen uses for the same state, and the same promise the
  // card's own footer makes two lines below it.
  gemt: {
    tone: 'success',
    text: 'Ugens ret er gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  loerdag_gemt: {
    tone: 'success',
    text: 'Lørdagsmenuen er gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  // The week rollover (§7e item 5). The sentence says what happened *and* what did not,
  // because "the form went blank" is alarming until you know the hjemmeside did not.
  uge_skiftet: {
    tone: 'success',
    text: 'Du er begyndt på en ny uge. Skemaet er tomt, og hjemmesiden viser stadig den uge, der er offentliggjort.',
  },
  uge_gendannet: {
    tone: 'success',
    text: 'Du er tilbage på den uge, der ligger på hjemmesiden. Kladden til Ugens ret er ryddet.',
  },
  kopieret: {
    tone: 'success',
    text: 'Sidste uge er hentet ind som kladde. Hjemmesiden er uændret — tryk Offentliggør, når ugen er skrevet færdig.',
  },
  kopi_nothing_to_copy: {
    tone: 'warning',
    text: 'Der er ikke noget på hjemmesiden at kopiere endnu.',
  },
  kopi_conflict: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Der blev ikke kopieret noget — hent siden igen og prøv en gang til.',
  },
  kopi_invalid_week: {
    tone: 'error',
    text: 'Ugen kunne ikke regnes ud. Vælg et ugenummer, og prøv igen.',
  },
  kopi_forbidden: { tone: 'error', text: 'Du har ikke adgang til at rette Ugens ret.' },
  kopi_not_found: { tone: 'error', text: 'Ugens ret findes ikke.' },
  kopi_failed: {
    tone: 'error',
    text: 'Der blev ikke kopieret noget. Intet blev ændret — prøv igen.',
  },
  offentliggjort: { tone: 'success', text: 'Ugens ret er opdateret på hjemmesiden.' },
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
  forbidden: { tone: 'error', text: 'Du har ikke adgang til at rette Ugens ret.' },
  not_found: { tone: 'error', text: 'Ugens ret findes ikke.' },
  failed: { tone: 'error', text: 'Ændringen kunne ikke gemmes. Intet blev ændret — prøv igen.' },
}

export function WeeklyStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

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
 * words and the same tone the phase-4 content editor uses for the same state.
 */
export function WeeklyMalformedDraftNotice({ malformed }: { malformed: boolean }) {
  if (!malformed) return null

  return (
    <Notice tone="error">
      Den gemte kladde kan ikke læses og bliver ikke vist. Gem felterne igen for at
      erstatte den.
    </Notice>
  )
}

/**
 * "Ugens ret har ændringer, der ikke er offentliggjort" — 1aa's pending band, with this
 * screen's own Offentliggør.
 *
 * Derived from the stored draft's own changed fields, so the band cannot claim a change
 * the database does not hold, and it names **which of the two cards** is pending — which
 * is the whole of §11's requirement, and the one thing a shared band could not do for a
 * row that carries two editors.
 *
 * The action takes no input at all: it re-reads what is pending on the server (see
 * `publish-actions.ts`), so the button is a request to publish this screen's scope, not
 * a list of ids the browser chose.
 *
 * A copied week produces the same band as any other draft, and deliberately so: it *is*
 * a draft like any other. What makes it worth a sentence is that it looks finished,
 * because it is full of last week's text — so the band says it is waiting, and the
 * status line above it says where it came from.
 */
export function WeeklyPendingNotice({
  sentences,
  action,
}: {
  readonly sentences: readonly string[]
  readonly action: () => Promise<void>
}) {
  if (sentences.length === 0) return null

  return (
    <div
      className="rounded-card border-warning-border bg-warning-surface border-l-warning flex flex-col gap-3 border border-l-4 p-3 md:flex-row md:items-center md:px-4"
      role="status"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden="true" className="bg-warning mt-1 size-4 shrink-0 rotate-45" />

        <div className="text-warning-ink min-w-0 flex-1">
          <p className="font-semibold">
            {sentences.length === 1
              ? 'Én ændring venter på at blive offentliggjort.'
              : `${String(sentences.length)} ændringer venter på at blive offentliggjort.`}
          </p>
          <ul className="text-warning-ink-2 text-meta">
            {sentences.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
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
 * The bar, its timer and its button are `UndoStrip`, shared with the menu screen; what
 * is here is the half that is about *this* operation — which fields the Fortryd submits.
 * The sentence itself is composed by `describeWeeklyAvailabilityChange` in
 * `lib/menu/weekly-availability.ts` and handed in, the same way the dish strips are
 * handed theirs: vocabulary belongs beside the rules, where the unit suite can assert it.
 *
 * **THE CHANGE IS ALREADY LIVE.** This is not a confirmation and not a pending state.
 * The column changed, the `weekly` cache tag was expired and an audit row was written
 * before this strip was rendered at all. Fortryd is a *second* write down the same path,
 * with the same guard, the same validation, the same concurrency check and its own audit
 * row. Nothing authoritative lives in the browser: the three values the form carries all
 * come back from the server that performed the write, and none is trusted on the way in.
 */
export function WeeklyAvailabilityUndo({
  form,
  target,
  label,
  message,
  version,
  /** The state Fortryd would restore — the opposite of what the card is in now. */
  restoreSoldOut,
}: {
  form: WeeklyAvailabilityForm
  target: WeeklySoldOutTarget
  label: string
  message: string
  version: string
  restoreSoldOut: boolean
}) {
  return (
    // `key` on the version token: a second change is a new message with a fresh ten
    // seconds, rather than the previous one's timer running out under it.
    <UndoStrip key={version} message={message}>
      <form action={form.action}>
        <WeeklyAvailabilityFields
          fieldNames={form.fieldNames}
          soldOut={restoreSoldOut}
          target={target}
          version={version}
        />
        <UndoSubmit>sæt {label} tilbage</UndoSubmit>
      </form>
    </UndoStrip>
  )
}
