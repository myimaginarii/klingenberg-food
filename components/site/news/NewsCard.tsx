import Link from 'next/link'

import type { NewsArticle } from '@/lib/content/types'

import { MediaPlaceholder } from '../MediaPlaceholder'
import { NewsMeta } from './NewsMeta'

/**
 * A news item in the list — design 1j (desktop) and 1n (mobile).
 *
 * The design draws two variants: an article with a photograph, and an article without
 * one, which gets a date circle instead so "layoutet falder ikke sammen" (1j). Which
 * variant an article gets depends on whether it has an image, and images arrive with the
 * upload pipeline in phase 10 — so today every card shows the reserved photo frame, and
 * the date-circle variant is built in the phase that can tell the two apart.
 *
 * The Forside's smaller teaser is a different card, not a prop on this one; see
 * `components/site/home/NewsTeaserCard.tsx`.
 */
export function NewsCard({ article, excerpt }: { article: NewsArticle; excerpt: string | null }) {
  return (
    <article className="bg-surface border-border rounded-card-lg flex flex-col gap-4 border p-3.5 md:flex-row md:gap-5 md:p-4.5">
      <MediaPlaceholder
        ratio="hero"
        label="Nyhedsfoto"
        detail="3:2 · valgfrit"
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
