import { Notice, type NoticeTone } from '@/components/admin/Notice'

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
}

export function NewsStatusNotice({ status }: { status: string | undefined }) {
  if (status === undefined) return null

  const notice = STATUS_NOTICES[status]
  if (notice === undefined) return null

  return <Notice tone={notice.tone}>{notice.message}</Notice>
}
