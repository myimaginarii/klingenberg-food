import { articleExcerpt, readPublishedNews } from '@/lib/content/news'
import { pageMetadata } from '@/lib/seo/metadata'

import { NewsCard } from '@/components/site/news/NewsCard'
import { PageContainer } from '@/components/site/PageContainer'

/**
 * Nyheder — design 1j (desktop) and 1n (mobile).
 *
 * A list of published articles, newest first. Writing, publishing and unpublishing them
 * is `/admin/nyheder` (phase 9A, §0q); this page only reads, and an unpublished article
 * is invisible to it because the RLS policy grants `anon` nothing else.
 */
export const metadata = pageMetadata(
  'Nyheder',
  'Lukkedage, nye retter, særlige åbningstider og andet nyt fra Klingenberg Food i Carl Nielsen Hallen.',
)

const INTRO = 'Lukkedage, nye retter, særlige åbningstider og andet nyt fra hallen.'
const EMPTY_STATE = 'Der er ingen nyheder lige nu.'

export default async function NyhederPage() {
  const articles = await readPublishedNews()

  return (
    <PageContainer className="py-7 md:py-11">
      <h1 className="font-display text-[2.25rem] tracking-[-0.03em] md:text-[3rem]">Nyheder</h1>
      <p className="text-ink-2 mt-2 max-w-[62ch]">{INTRO}</p>

      {articles.length === 0 ? (
        <p className="text-ink-2 mt-6">{EMPTY_STATE}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4.5">
          {articles.map((article) => (
            <li key={article.id}>
              <NewsCard article={article} excerpt={articleExcerpt(article)} />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  )
}
