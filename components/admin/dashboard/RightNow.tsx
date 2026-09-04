import Link from 'next/link'

import type { MenuCounts, NewsSummary, TodayOpening } from '@/lib/admin/dashboard'
import { formatDanishDate } from '@/lib/format/danish'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

/**
 * "LIGE NU" — design 1x (one card at the foot of the phone screen) and 1q (three cards
 * under the grid: LIGE NU, SENESTE NYHED, DAGENS ÅBNINGSTID).
 *
 * One markup. 1x's card carries three rows — "I dag", "Retter på hjemmesiden",
 * "Markeret udsolgt" — and 1q's LIGE NU carries "Retter på hjemmesiden", "Markeret
 * udsolgt" and "Offentliggjorte nyheder", with today's hours promoted to their own card
 * beside the latest article. So the "I dag" row is drawn below `md` only, the news row
 * from `md` only, and the two extra cards from `md` only; the numbers are the same
 * numbers.
 *
 * Every value is computed in `lib/admin/dashboard.ts` from published rows and the locked
 * rules. Nothing here is a metric the frames did not draw, and nothing is stored.
 */

function Card({
  eyebrow,
  id,
  className = '',
  children,
}: {
  eyebrow: string
  id: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className={`bg-surface border-border rounded-card shadow-admin-card border p-4 md:rounded-card-lg md:p-5 ${className}`}
    >
      <h2 className="font-mono text-label text-ink-3 mb-2.5 uppercase md:mb-3.5" id={id}>
        {eyebrow}
      </h2>
      {children}
    </section>
  )
}

function Row({
  label,
  value,
  tone = 'default',
  className = '',
}: {
  label: string
  value: string
  tone?: 'default' | 'error'
  className?: string
}) {
  return (
    <div
      className={`border-section flex justify-between gap-4 border-b py-2 text-[0.96875rem] last:border-b-0 ${className}`}
    >
      <dt>{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone === 'error' ? 'text-error-ink' : ''}`}>{value}</dd>
    </div>
  )
}

export function RightNow({
  today,
  menu,
  news,
  hoursHref,
  newsHref,
}: {
  today: TodayOpening
  menu: MenuCounts
  news: NewsSummary
  /** The one-off card on Åbningstider — 1q's "Ret kun i dag". */
  hoursHref: string
  /** The editor for the latest article — 1q's "Rediger". */
  newsHref: (articleId: string) => string
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
      <Card eyebrow="Lige nu" id="lige-nu-titel">
        <dl className="flex flex-col">
          <Row className="md:hidden" label="I dag" value={today.hours} />
          <Row label="Retter på hjemmesiden" value={String(menu.dishes)} />
          <Row label="Markeret udsolgt" tone="error" value={String(menu.soldOut)} />
          <Row className="hidden md:flex" label="Offentliggjorte nyheder" value={String(news.published)} />
        </dl>
      </Card>

      <Card className="hidden md:block" eyebrow="Seneste nyhed" id="seneste-nyhed-titel">
        {news.latest === null ? (
          <p className="text-ink-2 text-[0.96875rem]">Der er ingen nyheder på hjemmesiden endnu.</p>
        ) : (
          <>
            <p className="text-[1.0625rem] font-semibold wrap-anywhere">{news.latest.title}</p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-meta">
              <span className="rounded-badge border-success-border bg-success-surface text-success-ink inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[0.71875rem] leading-none font-semibold">
                <span aria-hidden="true" className="bg-success size-[7px] rounded-full" />
                Udgivet
              </span>
              {news.latest.publishedAt === null ? null : (
                <span className="text-ink-3 tabular-nums">
                  {formatDanishDate(copenhagenDateOf(new Date(news.latest.publishedAt)))}
                </span>
              )}
            </p>
            <p className="mt-2">
              <Link
                className="text-brand-700 min-h-tap inline-flex items-center text-nav underline"
                href={newsHref(news.latest.id)}
              >
                Rediger
                <span className="sr-only"> nyheden “{news.latest.title}”</span>
              </Link>
            </p>
          </>
        )}
      </Card>

      <Card className="hidden md:block" eyebrow="Dagens åbningstid" id="dagens-aabningstid-titel">
        <p className="font-display text-[1.875rem] leading-none font-bold tabular-nums">{today.hours}</p>
        <p className="text-ink-2 mt-1.5 text-[0.9375rem]">{today.weekday}</p>
        <p className="mt-2">
          <Link
            className="text-brand-700 min-h-tap inline-flex items-center text-nav underline"
            href={hoursHref}
          >
            Ret kun i dag
          </Link>
        </p>
      </Card>
    </div>
  )
}
