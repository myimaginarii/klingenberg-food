import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { CardPendingBadge, PendingBand, StateBadge } from '@/components/admin/PendingBand'

/**
 * The things the Forsiden screen says about itself — design 1aa, 1u; §6.
 *
 * One file, because all of them are *reports* rather than editors, and because the
 * vocabulary they share — the Kladde tone, the closed set of status codes, the pending
 * band with its own Offentliggør — is the one phases 5–10 established and this phase
 * reuses rather than reinvents.
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
export const HOME_MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  gemt: {
    tone: 'success',
    text: 'Afsnittet er gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  // The delta rule (§4): a section edited back to what the hjemmeside already says
  // leaves the draft, so the sentence says that nothing is waiting from this card.
  uaendret: {
    tone: 'success',
    text: 'Afsnittet er det samme som på hjemmesiden, så der venter ingen ændring fra det.',
  },
  // The image slots (phase 10C-1's vocabulary). A selection is a draft like any other
  // field, and the removal sentence says the §10 distinction out loud.
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
  // "Udvalgte burgere" — every press is a draft change (§6).
  ret_tilfoejet: {
    tone: 'success',
    text: 'Retten er tilføjet i kladden. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  ret_skiftet: {
    tone: 'success',
    text: 'Retten er skiftet i kladden. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  ret_fjernet: {
    tone: 'success',
    text: 'Retten er fjernet fra kladden. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  ret_flyttet: {
    tone: 'success',
    text: 'Rækkefølgen er gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  ret_findes_ikke: {
    tone: 'error',
    text: 'Retten findes ikke på menuen længere. Intet blev gemt — vælg en anden ret.',
  },
  ret_allerede_valgt: {
    tone: 'warning',
    text: 'Den ret er allerede valgt. Den samme ret kan kun fremhæves én gang.',
  },
  ret_fuld: {
    tone: 'warning',
    text: 'Forsiden viser højst tre retter. Fjern eller skift en af dem først.',
  },
  ret_ugyldig: {
    tone: 'error',
    text: 'Ændringen kunne ikke gemmes. Hent siden igen, og prøv en gang til.',
  },
  offentliggjort: { tone: 'success', text: 'Forsiden er opdateret på hjemmesiden.' },
  intet_valgt: {
    tone: 'warning',
    text: 'Der er ingen ændringer, der venter på at blive offentliggjort.',
  },
  nothing_to_publish: {
    tone: 'warning',
    text: 'Ændringen var allerede offentliggjort — måske fra en anden fane. Intet blev ændret.',
  },
  publish_failed: {
    tone: 'error',
    text: 'Ændringerne kunne ikke offentliggøres. Intet blev ændret — prøv igen.',
  },
  invalid_draft: {
    tone: 'error',
    text: 'Den gemte kladde kan ikke offentliggøres, som den er. Gem afsnittene igen, og prøv en gang til.',
  },
  conflict: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så du retter i den nyeste version.',
  },
  ugyldig: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  invalid: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  forbidden: { tone: 'error', text: 'Kun ejeren kan rette forsiden.' },
  not_found: { tone: 'error', text: 'Forsiden findes ikke.' },
  failed: { tone: 'error', text: 'Ændringen kunne ikke gemmes. Intet blev ændret — prøv igen.' },
}

export function HomeStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

  const message = HOME_MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}

/**
 * A stored draft that no longer satisfies its schema — technical plan §6, rule 4.
 *
 * `overlayDraft` refuses to apply half of a malformed draft, and "no draft" and "a
 * draft that cannot be read" look identical on screen — so it is said out loud, in the
 * same words the other editors use for the same state. Since phase 11A a draft written
 * by the phase-4 editor (no `image_id` in its sections) is exactly this case.
 */
export function HomeMalformedDraftNotice({ malformed }: { malformed: boolean }) {
  if (!malformed) return null

  return (
    <Notice tone="error">
      Den gemte kladde kan ikke læses og bliver ikke vist. Gem afsnittene igen for at
      erstatte den.
    </Notice>
  )
}

/**
 * 1aa's pending band, the bar's pill and the card badge are the marks every draft
 * editor draws; since phase 11B they live in `components/admin/PendingBand.tsx` and
 * this screen draws them under its own names. The sentence comes from
 * `describeHomePending`, so the band cannot claim a change the database does not hold.
 */
export function HomePendingNotice({
  sentence,
  action,
}: {
  readonly sentence: string | null
  readonly action: () => Promise<void>
}) {
  return <PendingBand action={action} sentence={sentence} />
}

export function HomeStateBadge({ pending }: { pending: boolean }) {
  return <StateBadge pending={pending} />
}

export function HomeCardPending({ note }: { note: string }) {
  return <CardPendingBadge note={note} />
}
