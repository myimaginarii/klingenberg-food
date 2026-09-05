import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { RATE_LIMIT_NOTICE, RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

/**
 * What the last action did — one sentence, from a closed set of codes the actions in
 * `app/(admin)/admin/nyheder/` redirect back with. An unknown code renders nothing:
 * the query string is an address, not a message channel.
 *
 * The two save outcomes are deliberately two different sentences (§4, phase 9A's
 * model): a draft save changed nothing public, a published save is already on the
 * hjemmeside — the administration never leaves a person guessing which of the two
 * just happened.
 */
const STATUS_NOTICES: Record<string, { tone: NoticeTone; message: string }> = {
  oprettet: {
    tone: 'success',
    message: 'Nyheden er oprettet som kladde. Gæster kan ikke se den, før den offentliggøres.',
  },
  gemt: { tone: 'success', message: 'Kladden er gemt. Nyheden er ikke offentliggjort endnu.' },
  gemt_live: { tone: 'success', message: 'Ændringerne er gemt og er på hjemmesiden nu.' },
  offentliggjort: {
    tone: 'success',
    message: 'Nyheden er offentliggjort. Den er på hjemmesiden og forsiden nu.',
  },
  fjernet: {
    tone: 'success',
    message:
      'Nyheden er fjernet fra hjemmesiden og gemt som kladde. Den kan offentliggøres igen med samme adresse.',
  },
  slettet: { tone: 'success', message: 'Nyheden er slettet.' },
  // The image slot (phase 10C-1). News has no draft layer, so the sentences follow
  // the save model: a draft article's image is invisible until publish, a published
  // article's image change is live at once — and a removal never leaves the library.
  billede_gemt: {
    tone: 'success',
    message: 'Billedet er valgt. Nyheden er ikke offentliggjort endnu.',
  },
  billede_gemt_live: {
    tone: 'success',
    message: 'Billedet er valgt og er på hjemmesiden nu.',
  },
  billede_fjernet: {
    tone: 'success',
    message:
      'Billedet er fjernet fra nyheden — det bliver i billedbiblioteket. Nyheden er ikke offentliggjort endnu.',
  },
  billede_fjernet_live: {
    tone: 'success',
    message:
      'Billedet er fjernet fra nyheden — det bliver i billedbiblioteket. Hjemmesiden viser ændringen nu.',
  },
  billede_findes_ikke: {
    tone: 'error',
    message: 'Billedet findes ikke længere i biblioteket. Intet blev gemt — vælg et andet billede.',
  },
  ugyldig: { tone: 'warning', message: 'Ret felterne herunder, og prøv igen.' },
  adresse_optaget: {
    tone: 'warning',
    message: 'Nyhedens adresse blev optaget i mellemtiden. Gem igen for at få en ny.',
  },
  konflikt: {
    tone: 'warning',
    message:
      'En kollega har ændret nyheden i mellemtiden, så der blev ikke gemt noget. Felterne viser stadig dit — gennemse den nye version, og gem igen.',
  },
  allerede_offentliggjort: { tone: 'warning', message: 'Nyheden er allerede offentliggjort.' },
  allerede_fjernet: { tone: 'warning', message: 'Nyheden er ikke på hjemmesiden.' },
  findes_ikke: { tone: 'error', message: 'Nyheden findes ikke længere.' },
  afvist: { tone: 'error', message: 'Du har ikke adgang til at ændre nyheder.' },
  fejl: { tone: 'error', message: 'Noget gik galt. Der blev ikke ændret noget — prøv igen.' },
  // The limiter's refusal (phase 13B): the one code and sentence every screen shares.
  [RATE_LIMIT_STATUS]: { tone: RATE_LIMIT_NOTICE.tone, message: RATE_LIMIT_NOTICE.text },
}

export function NewsStatusNotice({ status }: { status: string | undefined }) {
  if (status === undefined) return null

  const notice = STATUS_NOTICES[status]
  if (notice === undefined) return null

  return <Notice tone={notice.tone}>{notice.message}</Notice>
}
