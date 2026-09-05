import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { RATE_LIMIT_NOTICE, RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

/**
 * What the Kontaktoplysninger screen says about itself — design 1aa, 1v; §6.
 *
 * The Server Actions redirect back with one code from a closed set. A code that is
 * not in this table produces nothing at all. The conflict wording is the design's
 * own: **"Nogen andre har rettet dette."**
 */
export const CONTACT_MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  gemt: {
    tone: 'success',
    text: 'Gemt som kladde. Hjemmesiden er uændret, indtil du trykker Offentliggør.',
  },
  uaendret: {
    tone: 'success',
    text: 'Oplysningerne er de samme som på hjemmesiden, så der venter ingen ændring.',
  },
  offentliggjort: {
    tone: 'success',
    text: 'Kontaktoplysningerne er opdateret på hjemmesiden — på alle sider, Ring-knapperne medregnet.',
  },
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
  forbidden: { tone: 'error', text: 'Kun ejeren kan rette kontaktoplysningerne.' },
  not_found: { tone: 'error', text: 'Kontaktoplysningerne findes ikke.' },
  failed: { tone: 'error', text: 'Ændringen kunne ikke gemmes. Intet blev ændret — prøv igen.' },
  // The limiter's refusal (phase 13B): the one code and sentence every screen shares.
  [RATE_LIMIT_STATUS]: RATE_LIMIT_NOTICE,
}

export function ContactStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

  const message = CONTACT_MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}

/** A stored draft that no longer satisfies its schema — technical plan §6, rule 4. */
export function ContactMalformedDraftNotice({ malformed }: { malformed: boolean }) {
  if (!malformed) return null

  return (
    <Notice tone="error">
      Den gemte kladde kan ikke læses og bliver ikke vist. Gem felterne igen for at
      erstatte den.
    </Notice>
  )
}
