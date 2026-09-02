import { Notice, type NoticeTone } from '@/components/admin/Notice'

/**
 * What the Mad ud af huset screen says about itself — design 1aa, 1aj; §6.
 *
 * The Server Actions redirect back with one code from a closed set, so the report
 * survives a page load and needs no client state. A code that is not in this table
 * produces nothing at all, which is what stops a query string somebody typed by hand
 * from putting a sentence on the screen.
 *
 * The conflict wording is the design's own: **"Nogen andre har rettet dette."**
 * Nothing was overwritten and nothing was lost (§6, §7e item 2).
 */
export const TAKEAWAY_MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
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
  afsnit_tilfoejet: {
    tone: 'success',
    text: 'Afsnittet er tilføjet i kladden. Skriv det, og gem. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  afsnit_fjernet: {
    tone: 'success',
    text: 'Afsnittet er fjernet i kladden. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  afsnit_flyttet: {
    tone: 'success',
    text: 'Rækkefølgen er gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  // The switch (§0aa): a draft like every other field on 1aj, and the sentence says
  // exactly what publishing will do to the page and the menu item.
  synlighed_fra: {
    tone: 'success',
    text: 'Gemt som kladde: når du offentliggør, forsvinder både siden og menupunktet fra hjemmesiden. Indtil da er hjemmesiden uændret.',
  },
  synlighed_til: {
    tone: 'success',
    text: 'Gemt som kladde: når du offentliggør, vises både siden og menupunktet på hjemmesiden igen. Indtil da er hjemmesiden uændret.',
  },
  synlighed_uaendret: {
    tone: 'success',
    text: 'Siden står allerede sådan på hjemmesiden, så der venter ingen ændring af synligheden.',
  },
  // The image slot (phase 10C-1's vocabulary).
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
  offentliggjort: { tone: 'success', text: 'Mad ud af huset er opdateret på hjemmesiden.' },
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
}

export function TakeawayStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

  const message = TAKEAWAY_MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}

/**
 * A stored draft that no longer satisfies its schema — technical plan §6, rule 4.
 *
 * `overlayDraft` refuses to apply half of a malformed draft, and "no draft" and "a
 * draft that cannot be read" look identical on screen — so it is said out loud, in
 * the same words the other editors use for the same state.
 */
export function TakeawayMalformedDraftNotice({ malformed }: { malformed: boolean }) {
  if (!malformed) return null

  return (
    <Notice tone="error">
      Den gemte kladde kan ikke læses og bliver ikke vist. Gem felterne igen for at
      erstatte den.
    </Notice>
  )
}
