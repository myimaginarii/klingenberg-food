import { formatDanishDate } from '@/lib/format/danish'
import type { NewsArticle } from '@/lib/content/types'

/**
 * The date and category line above a news headline — design 1j, 1l, 1n.
 *
 * The same line appears on the list, on the Forside teaser and on the article itself, so
 * it is one component rather than three copies that could drift apart. The date is a
 * `<time>`, so it is machine-readable as well as legible.
 */
export function NewsMeta({ article }: { article: NewsArticle }) {
  if (article.displayDate === null && article.category === null) return null

  return (
    <p className="flex flex-wrap items-center gap-2.5">
      {article.displayDate ? (
        <time
          dateTime={article.displayDate}
          className="text-ink-3 font-mono text-[0.78125rem] tabular-nums"
        >
          {formatDanishDate(article.displayDate)}
        </time>
      ) : null}
      {article.category ? (
        <span className="bg-brand-50 text-brand-700 rounded-badge px-2.5 py-1.5 text-micro leading-none font-medium">
          {article.category}
        </span>
      ) : null}
    </p>
  )
}
