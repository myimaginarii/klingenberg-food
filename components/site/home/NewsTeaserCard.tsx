import Link from 'next/link'

import { MediaPlaceholder } from '@/components/site/MediaPlaceholder'
import { NewsMeta } from '@/components/site/news/NewsMeta'
import type { NewsArticle } from '@/lib/content/types'

/**
 * The Forside's news teaser — design 1g and 1l.
 *
 * Smaller than the card on the Nyheder list, and deliberately so: on the Forside this
 * shares a row with the "Om os" excerpt, so it carries a compact photograph and two
 * lines of text. The headline is the link, because the design gives the teaser no
 * separate "Læs mere" action — that lives on the list.
 */
export function NewsTeaserCard({
  article,
  excerpt,
}: {
  article: NewsArticle
  excerpt: string | null
}) {
  return (
    <article className="bg-surface border-border rounded-card-lg flex flex-col gap-3.5 border p-3.5 md:flex-row md:gap-4">
      <MediaPlaceholder
        ratio="card"
        label="Foto"
        detail="valgfrit"
        className="rounded-card w-full shrink-0 self-start md:w-32.5"
      />

      <div className="min-w-0 flex-1">
        <NewsMeta article={article} />
        <h3 className="font-display mt-1.5 text-[1.1875rem] leading-snug font-semibold">
          <Link href={`/nyheder/${article.slug}`} className="text-ink no-underline hover:underline">
            {article.title}
          </Link>
        </h3>
        {excerpt ? <p className="text-ink-2 mt-1.5 text-meta">{excerpt}</p> : null}
      </div>
    </article>
  )
}
