import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { RATE_LIMIT_NOTICE, RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

/**
 * What the Om os screen says about itself — design 1aa; §6; phase 14B1.
 *
 * The Server Actions redirect back with one code from a closed set, so the report
 * survives a page load and needs no client state. A code that is not in this table
 * produces nothing at all, which is what stops a query string somebody typed by hand
 * from putting a sentence on the screen.
 *
 * The conflict wording is the design's own: **"Nogen andre har rettet dette."**
 * Nothing was overwritten and nothing was lost (§6, §7e item 2).
 */
export const ABOUT_MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  gemt: {
    tone: 'success',
    text: 'Gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  // The delta rule (§4): a field edited back to what the hjemmeside already says
  // leaves the draft, so the sentence says that nothing is waiting from this card.
  uaendret: {
    tone: 'success',
    text: 'Det er det samme som på hjemmesiden, så der venter ingen ændring fra det.',
  },
  // The image slots (phase 10C-1's vocabulary).
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
  offentliggjort: { tone: 'success', text: 'Om os er opdateret på hjemmesiden.' },
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
    text: 'Den gemte kladde kan ikke offentliggøres, som den er. Gem felterne igen, og prøv en gang til.',
  },
  conflict: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så du retter i den nyeste version.',
  },
  ugyldig: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  invalid: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  forbidden: { tone: 'error', text: 'Du har ikke adgang til at rette denne side.' },
  not_found: { tone: 'error', text: 'Siden findes ikke.' },
  failed: { tone: 'error', text: 'Ændringen kunne ikke gemmes. Intet blev ændret — prøv igen.' },
  // The limiter's refusal (phase 13B): the one code and sentence every screen shares.
  [RATE_LIMIT_STATUS]: RATE_LIMIT_NOTICE,
}

export function AboutStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

  const message = ABOUT_MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}

/**
 * A stored draft that no longer satisfies its schema — technical plan §6, rule 4.
 *
 * `overlayDraft` refuses to apply half of a malformed draft, and "no draft" and "a
 * draft that cannot be read" look identical on screen — so it is said out loud, in the
 * same words the other editors use for the same state. A draft the retired phase-4
 * editor wrote (no image keys in its sections) is exactly this case.
 */
export function AboutMalformedDraftNotice({ malformed }: { malformed: boolean }) {
  if (!malformed) return null

  return (
    <Notice tone="error">
      Den gemte kladde kan ikke læses og bliver ikke vist. Gem felterne igen for at
      erstatte den.
    </Notice>
  )
}
