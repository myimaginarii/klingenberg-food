import Link from 'next/link'

import type { NewsArticle } from '@/lib/content/types'
import { formatDateCircle } from '@/lib/format/danish'
import type { IsoDate } from '@/lib/time/calendar'

import { SiteImage } from '../SiteImage'
import { NewsMeta } from './NewsMeta'

/**
 * A news item in the list — design 1j (desktop) and 1n (mobile).
 *
 * The design draws two variants: an article with a photograph, and an article without
 * one, which gets a **date circle** instead — "Nyheder uden billede får en datocirkel i
 * stedet — layoutet falder ikke sammen" (1j), "Tekstnyhed uden billede" (1n). Phase 3
 * built the formatter for it (`formatDateCircle`) and deferred the card to the phase
 * that could tell the two articles apart; since phase 10C-2 an article with a selected
 * library image renders it in 1j/1n's 3:2 frame, and the phase-10 lock pass built the
 * date circle for the rest. The circle is the date the card already prints in its meta
 * line, so it is decorative for assistive technology; an article with neither an image
 * nor a display date has nothing to draw there, and its text takes the card's width.
 *
 * The Forside's smaller teaser is a different card, not a prop on this one; see
 * `components/site/home/NewsTeaserCard.tsx`.
 */
export function NewsCard({
  article,
  excerpt,
  loading = 'lazy',
}: {
  article: NewsArticle
  excerpt: string | null
  /** `eager` for the first card, which is above the fold on the list. */
  loading?: 'lazy' | 'eager'
}) {
  const dateCircle = article.image === null && article.displayDate !== null

  return (
    <article
      className={`bg-surface border-border rounded-card-lg flex border ${
        dateCircle
          ? 'flex-row items-start gap-3.5 p-3.5 md:items-center md:gap-5 md:p-4'
          : 'flex-col gap-4 p-3.5 md:flex-row md:gap-5 md:p-4.5'
      }`}
    >
      {article.image === null ? (
        article.displayDate === null ? null : <NewsDateCircle date={article.displayDate} />
      ) : (
        <SiteImage
          image={article.image}
          ratio="hero"
          sizes="newsCard"
          loading={loading}
          placeholder={{ label: 'Nyhedsfoto', detail: '3:2 · valgfrit' }}
          className="rounded-card w-full shrink-0 self-start md:w-65"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <NewsMeta article={article} />

        <h2 className="font-display text-card mt-2">
          {article.title}
        </h2>

        {excerpt ? <p className="text-ink-2 text-support mt-1.5 max-w-[56ch]">{excerpt}</p> : null}

        <p className="mt-1.5">
          <Link
            href={`/nyheder/${article.slug}`}
            className="text-brand-700 border-brand-700 inline-flex min-h-tap items-center gap-1.5 border-b-[1.5px] text-nav font-medium no-underline"
          >
            Læs mere
            <span aria-hidden="true">→</span>
          </Link>
        </p>
      </div>
    </article>
  )
}

/**
 * 1j's date circle: on a desktop it sits centred in the column the photograph would
 * have taken (16.25rem wide, a rule on its right); on a phone (1n) it is a smaller
 * circle beside the text. Day in the display face, month as the mono abbreviation.
 */
function NewsDateCircle({ date }: { date: IsoDate }) {
  const { day, month } = formatDateCircle(date)

  return (
    <div
      aria-hidden="true"
      className="news-date-circle border-border flex shrink-0 items-center justify-center md:w-28 md:self-stretch md:border-r"
    >
      <span className="border-border flex size-14 flex-col items-center justify-center rounded-full border-[1.5px] md:size-16">
        <span className="font-display text-ink text-[1.125rem] leading-none font-bold md:text-[1.25rem]">
          {day}
        </span>
        <span className="text-ink-3 mt-1 font-mono text-[0.625rem] leading-none">
          {month}
        </span>
      </span>
    </div>
  )
}
