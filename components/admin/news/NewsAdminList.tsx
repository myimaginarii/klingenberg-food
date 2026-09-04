import type { NewsStateLabel } from '@/lib/news/lifecycle'

/**
 * The article list — design 1z (left card), and the same arrangement at 1440, where
 * no separate desktop list frame exists: the phone's list is the approved one and
 * `max-w` keeps it a readable column rather than a stretched row.
 *
 * Each row is **one link** to the article's editor. The state is a pill in words
 * ("Udgivet" / "Kladde") with its own shape before them — a dot for live, the
 * administration's rotated square for a draft — and the whole card of a draft takes
 * the warning tone, exactly as 1z draws it. Never colour alone (1aa).
 *
 * Nothing here decides anything: the sentences and the tone come from
 * `describeNewsState`, and the list shows what the server read — title, state, the
 * relevant date. No view counts, no author column, nothing the frame does not draw.
 */

export type NewsAdminRow = {
  readonly id: string
  readonly title: string
  readonly href: string
  readonly state: NewsStateLabel
}

const ROW_TONE = {
  published: 'bg-surface border-border',
  draft: 'bg-warning-surface border-warning-border border-[1.5px]',
} as const

const LINE_TONE = {
  published: 'text-ink-3',
  draft: 'text-warning-ink',
} as const

export function NewsAdminList({
  rows,
  createHref,
}: {
  rows: readonly NewsAdminRow[]
  createHref: string
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-surface border-border rounded-card-lg border p-5">
        <p className="font-medium">Der er ingen nyheder endnu.</p>
        <p className="text-ink-2 text-meta mt-1">
          Skriv den første med{' '}
          <a className="text-brand-700 underline" href={createHref}>
            + Ny nyhed
          </a>
          .
        </p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.id}>
          <a
            className={`rounded-card flex min-h-tap items-center justify-between gap-3 border p-3.5 no-underline ${ROW_TONE[row.state.tone]}`}
            href={row.href}
          >
            <span className="min-w-0">
              {/*
                The title wraps — `anywhere`, so a 200-character title ending in one
                unbroken word breaks inside the card instead of the card growing past
                the phone (12A's lesson about flex items). Never truncated: two
                articles that begin alike must be tellable apart on the list.
              */}
              <span className="text-ink block font-semibold wrap-anywhere">{row.title}</span>
              <span className={`text-meta block ${LINE_TONE[row.state.tone]}`}>
                {row.state.line}
              </span>
            </span>

            <StatePill state={row.state} />
          </a>
        </li>
      ))}
    </ul>
  )
}

/** 1z's pill: a green dot for "Udgivet", the warning diamond for "Kladde". */
function StatePill({ state }: { state: NewsStateLabel }) {
  if (state.tone === 'published') {
    return (
      <span className="rounded-badge border-success-border bg-success-surface text-success-ink inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-micro leading-none font-semibold">
        <span aria-hidden="true" className="bg-success size-2 shrink-0 rounded-full" />
        {state.pill}
      </span>
    )
  }

  return (
    <span className="rounded-badge border-warning-border bg-surface text-warning-ink inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-micro leading-none font-semibold">
      <span aria-hidden="true" className="bg-warning size-2 shrink-0 rotate-45" />
      {state.pill}
    </span>
  )
}
