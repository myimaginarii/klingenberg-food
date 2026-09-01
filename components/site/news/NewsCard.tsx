import Link from 'next/link'

import type { NewsArticle } from '@/lib/content/types'

import { SiteImage } from '../SiteImage'
import { NewsMeta } from './NewsMeta'

/**
 * A news item in the list — design 1j (desktop) and 1n (mobile).
 *
 * The design draws two variants: an article with a photograph, and an article without
 * one, which gets a date circle instead so "layoutet falder ikke sammen" (1j). Since
 * phase 10C-2 an article with a selected library image renders it in 1j/1n's 3:2
 * frame; an article without one still shows the reserved frame — the date-circle
 * variant is a separate visual treatment the phase-10 lock pass decides on, because
 * building it changes the no-image card rather than filling the image slot.
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
  return (
    <article className="bg-surface border-border rounded-card-lg flex flex-col gap-4 border p-3.5 md:flex-row md:gap-5 md:p-4.5">
      <SiteImage
        image={article.image}
        ratio="hero"
        sizes="newsCard"
        loading={loading}
        placeholder={{ label: 'Nyhedsfoto', detail: '3:2 · valgfrit' }}
        className="rounded-card w-full shrink-0 self-start md:w-65"
      />

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <NewsMeta article={article} />

        <h2 className="font-display mt-2 text-[1.375rem] leading-tight font-semibold md:text-[1.75rem]">
          {article.title}
        </h2>

        {excerpt ? <p className="text-ink-2 mt-2 max-w-[56ch]">{excerpt}</p> : null}

        <p className="mt-3">
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
