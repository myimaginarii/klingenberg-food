import { Notice, type NoticeTone } from '@/components/admin/Notice'

/**
 * What the last image action did — one sentence, from the closed set of codes the
 * actions in `app/(admin)/admin/billeder/` redirect back with (and the uploader
 * navigates back with). An unknown code renders nothing: the query string is an
 * address, not a message channel.
 */
const STATUS_NOTICES: Record<string, { tone: NoticeTone; message: string }> = {
  uploadet: {
    tone: 'success',
    message: 'Billedet er uploadet og ligger i biblioteket.',
  },
  erstattet: {
    tone: 'success',
    message:
      'Billedet er erstattet. Det nye billede bruges nu alle de steder, det gamle blev brugt, og det gamle er slettet.',
  },
  tekst_gemt: { tone: 'success', message: 'Beskrivelsen er gemt.' },
  slettet: { tone: 'success', message: 'Billedet er slettet.' },
  ugyldig: { tone: 'warning', message: 'Ret feltet herunder, og prøv igen.' },
  i_brug: {
    tone: 'warning',
    message:
      'Billedet er taget i brug, siden du åbnede bekræftelsen. Der blev ikke slettet noget — se hvor det bruges, og bekræft igen, hvis det stadig skal væk.',
  },
  konflikt: {
    tone: 'warning',
    message:
      'En kollega har ændret billedet i mellemtiden, så der blev ikke gemt noget. Gennemse den nye version, og prøv igen.',
  },
  findes_ikke: { tone: 'error', message: 'Billedet findes ikke længere.' },
  afvist: { tone: 'error', message: 'Du har ikke adgang til at ændre billeder.' },
  fejl: { tone: 'error', message: 'Noget gik galt. Der blev ikke ændret noget — prøv igen.' },
}

export function ImagesStatusNotice({ status }: { status: string | undefined }) {
  if (status === undefined) return null

  const notice = STATUS_NOTICES[status]
  if (notice === undefined) return null

  return <Notice tone={notice.tone}>{notice.message}</Notice>
}
