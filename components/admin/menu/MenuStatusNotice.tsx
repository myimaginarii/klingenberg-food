import { Notice, type NoticeTone } from '@/components/admin/Notice'

/**
 * What just happened on the menu screen — design 1aa ("BESKEDER I ADMIN").
 *
 * The Server Actions redirect back with one code from a closed set, so the report
 * survives a page load and needs no client state — the same pattern the dashboard's
 * `PublishSummary` uses. A code that is not in this table produces nothing at all,
 * which is what stops a query string somebody typed by hand from putting a sentence on
 * the screen.
 *
 * The conflict wording is the design's own: **"Nogen andre har rettet dette."** Nothing
 * was overwritten and nothing was lost — reloading shows the newer version, and the
 * edit can be made again on top of it (§6, §7e item 2).
 */
const MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  saved: { tone: 'success', text: 'Ændringen er gemt som kladde. Den er ikke på hjemmesiden endnu.' },
  created: {
    tone: 'success',
    text: 'Retten er oprettet som kladde. Den vises først på hjemmesiden, når du offentliggør den.',
  },
  offentliggjort: { tone: 'success', text: 'Menuen er opdateret på hjemmesiden.' },
  delvist: {
    tone: 'warning',
    text: 'Noget blev offentliggjort, og noget blev ikke. Se listen herunder og prøv igen.',
  },
  intet_valgt: {
    tone: 'warning',
    text: 'Der er ingen ændringer i menuen, der venter på at blive offentliggjort.',
  },
  conflict: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så du retter i den nyeste version.',
  },
  ugyldig: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  // The immediate availability path (§6, §7b). A success has no entry here: it is
  // reported by the green Fortryd strip, and two confirmations of one change is one
  // too many.
  uaendret: {
    tone: 'success',
    text: 'Retten stod allerede sådan på hjemmesiden. Intet blev ændret.',
  },
  udsolgt_dato: {
    tone: 'error',
    text: 'Tilgængeligheden kunne ikke ændres, fordi datoen ikke passede. Hent siden igen og prøv en gang til.',
  },
  // The deletion path (§6, §7e item 4). A successful deletion has no entry here either:
  // it is reported by the green Fortryd strip, for the same reason.
  gendannet: {
    tone: 'success',
    text: 'Retten er hentet tilbage. Den er på hjemmesiden igen, hvis den var offentliggjort.',
  },
  slettet: {
    tone: 'success',
    text: 'Retten er fjernet fra hjemmesiden. Du kan hente den tilbage fra ændringsloggen.',
  },
  invalid: { tone: 'error', text: 'Ret det, der er markeret herunder, og gem igen.' },
  invalid_category: { tone: 'error', text: 'Retten kan ikke ligge i den sektion.' },
  forbidden: { tone: 'error', text: 'Du har ikke adgang til at rette menuen.' },
  not_found: { tone: 'error', text: 'Retten findes ikke længere.' },
  failed: { tone: 'error', text: 'Ændringen kunne ikke gemmes. Intet blev ændret — prøv igen.' },
  publish_failed: {
    tone: 'error',
    text: 'Ændringerne kunne ikke offentliggøres. Intet blev ændret — prøv igen.',
  },
}

export function MenuStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

  const message = MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}
