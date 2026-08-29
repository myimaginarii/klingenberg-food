import type { PublishStatus } from '@/lib/publishing/publish'

import { Notice } from './Notice'

/**
 * What happened when you pressed Offentliggør — technical plan §6.
 *
 * The Server Action redirects back with one count per outcome, so the report survives
 * a page load and needs no client state. Each outcome gets its own sentence, because
 * "3 offentliggjort, 1 konflikt" is a different situation from "4 offentliggjort" and
 * the difference is the whole reason optimistic concurrency exists.
 *
 * The conflict wording is the one the design specifies: **"Nogen andre har rettet
 * dette."** Nothing was overwritten and nothing was lost — the item is still in the
 * list, now carrying the other person's version, and publishing it again publishes
 * what is actually there.
 *
 * Tone is icon and text together, never colour alone (1aa).
 */

type Outcome = {
  readonly tone: 'success' | 'warning' | 'error'
  readonly sentence: (count: number) => string
}

const OUTCOMES: Record<PublishStatus, Outcome> = {
  published: {
    tone: 'success',
    sentence: (count) =>
      count === 1 ? 'Én ændring er offentliggjort og er nu live.' : `${count} ændringer er offentliggjort og er nu live.`,
  },
  conflict: {
    tone: 'warning',
    sentence: (count) =>
      count === 1
        ? 'Nogen andre har rettet dette. Ændringen blev ikke offentliggjort — se den nye version i listen.'
        : `Nogen andre har rettet ${count} af ændringerne. De blev ikke offentliggjort — se de nye versioner i listen.`,
  },
  forbidden: {
    tone: 'error',
    sentence: (count) =>
      count === 1
        ? 'Én ændring kræver ejer-adgang og blev ikke offentliggjort.'
        : `${count} ændringer kræver ejer-adgang og blev ikke offentliggjort.`,
  },
  nothing_to_publish: {
    tone: 'warning',
    sentence: (count) =>
      count === 1
        ? 'Én ændring var allerede offentliggjort.'
        : `${count} ændringer var allerede offentliggjort.`,
  },
  not_found: {
    tone: 'warning',
    sentence: (count) =>
      count === 1
        ? 'Én ændring findes ikke længere.'
        : `${count} ændringer findes ikke længere.`,
  },
  invalid_draft: {
    tone: 'error',
    sentence: (count) =>
      count === 1
        ? 'Én kladde kunne ikke godkendes og blev ikke offentliggjort. Åbn den og ret den.'
        : `${count} kladder kunne ikke godkendes og blev ikke offentliggjort. Åbn dem og ret dem.`,
  },
  failed: {
    tone: 'error',
    sentence: (count) =>
      count === 1
        ? 'Én ændring kunne ikke gennemføres. Intet blev ændret — prøv igen.'
        : `${count} ændringer kunne ikke gennemføres. Intet blev ændret — prøv igen.`,
  },
}

const STATUSES = Object.keys(OUTCOMES) as PublishStatus[]

/**
 * Reads the counts out of the query string the publish action redirected with.
 *
 * Only the seven status names are looked at, so any other parameter on the URL — or a
 * count somebody typed by hand — contributes nothing rather than a made-up sentence.
 */
export function PublishSummary({ query }: { query: Partial<Record<string, string>> }) {
  const reported = STATUSES.map((status) => ({
    status,
    count: Number.parseInt(query[status] ?? '', 10),
  })).filter((entry) => Number.isInteger(entry.count) && entry.count > 0)

  if (reported.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {reported.map(({ status, count }) => (
        <Notice key={status} tone={OUTCOMES[status].tone}>
          {OUTCOMES[status].sentence(count)}
        </Notice>
      ))}
    </div>
  )
}
