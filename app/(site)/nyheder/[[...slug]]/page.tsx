import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SITE_CONTACT } from '@/content/site/contact'
import { NEWS_ARTICLES } from '@/content/site/news'
import type { NewsArticle } from '@/lib/content/types'
import { seoImageOf } from '@/lib/images/public'
import { articleExcerpt } from '@/lib/news/excerpt'
import { newsArticlePath } from '@/lib/news/slug'
import { newsArticleMetadata, pageMetadata } from '@/lib/seo/metadata'
import { newsArticleJsonLd, serializeJsonLd } from '@/lib/seo/news-article'

import { SiteImage } from '@/components/site/SiteImage'
import { NewsBody } from '@/components/site/news/NewsBody'
import { NewsCard } from '@/components/site/news/NewsCard'
import { NewsMeta } from '@/components/site/news/NewsMeta'
import { PageContainer } from '@/components/site/PageContainer'
import { PhoneAction } from '@/components/site/PhoneAction'

/**
 * Nyheder and one article — design 1j (desktop) and 1n (mobile); technical plan §7f.
 *
 * One optional catch-all route for both addresses: `/nyheder/` is the list and
 * `/nyheder/<slug>/` is one article. They share a file for a static reason rather than
 * a design one: the export needs every address generated at build time, and a
 * `[slug]` route with no article at all would be refused by the framework ("at least
 * one route must be generated"). With the list as the segment's own address, zero
 * articles is a valid site — the list renders its empty state, and the first article
 * written is one more generated page. `dynamicParams` is off, so an address that
 * names no article is a 404 rather than a render.
 *
 * The articles are the tracked list (`content/site/news.ts`); nothing else decides
 * what is published. The article page follows the approved system rather than
 * introducing a new design (§7f): title, category, date, image frame, body, a link
 * back to the list, and the phone call to action the whole site carries. Its selected
 * photograph is also the `og:image` and the `NewsArticle` JSON-LD `image`.
 */
export const dynamicParams = false

type NewsParams = { params: Promise<{ slug?: string[] }> }

/** The list, then one address per tracked article. Zero articles is one route. */
export function generateStaticParams(): { slug: string[] }[] {
  return [{ slug: [] }, ...NEWS_ARTICLES.map((article) => ({ slug: [article.slug] }))]
}

/** The article a request names, `null` for the list, `undefined` for no such article. */
async function resolveArticle(params: NewsParams['params']): Promise<NewsArticle | null | undefined> {
  const { slug } = await params
  if (slug === undefined || slug.length === 0) return null
  if (slug.length !== 1) return undefined
  return NEWS_ARTICLES.find((article) => article.slug === slug[0])
}

const LIST_METADATA = pageMetadata(
  'Nyheder',
  'Lukkedage, nye retter, særlige åbningstider og andet nyt fra Klingenberg Food i Carl Nielsen Hallen.',
)

export async function generateMetadata({ params }: NewsParams): Promise<Metadata> {
  const article = await resolveArticle(params)
  if (article === null) return LIST_METADATA
  if (article === undefined) return pageMetadata('Nyhed', 'Nyhed fra Klingenberg Food.')

  return newsArticleMetadata({
    title: article.title,
    description: articleExcerpt(article) ?? 'Nyt fra Klingenberg Food.',
    path: newsArticlePath(article.slug),
    publishedDate: article.displayDate,
    modifiedAt: article.updatedAt,
    image: article.image === null ? null : seoImageOf(article.image),
  })
}

export default async function NyhederPage({ params }: NewsParams) {
  const article = await resolveArticle(params)
  if (article === null) return <NewsList articles={NEWS_ARTICLES} />
  if (article === undefined) notFound()

  return <NewsArticlePage article={article} />
}

const INTRO = 'Lukkedage, nye retter, særlige åbningstider og andet nyt fra hallen.'
const EMPTY_STATE = 'Der er ingen nyheder lige nu.'

/** The list of published articles, newest first. */
function NewsList({ articles }: { articles: readonly NewsArticle[] }) {
  return (
    <PageContainer className="py-page-mobile md:py-page">
      <h1 className="font-display text-page">Nyheder</h1>
      <p className="text-ink-2 text-lead mt-2 max-w-[62ch]">{INTRO}</p>

      {articles.length === 0 ? (
        <p className="text-ink-2 mt-6">{EMPTY_STATE}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4.5">
          {articles.map((article, index) => (
            <li key={article.id}>
              <NewsCard
                article={article}
                excerpt={articleExcerpt(article)}
                loading={index === 0 ? 'eager' : 'lazy'}
              />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  )
}

function NewsArticlePage({ article }: { article: NewsArticle }) {
  return (
    <PageContainer className="py-7 md:py-11">
      {/*
        §11's NewsArticle block: the article's own values only, built by the SEO helper
        and rendered as an ordinary text child — the serializer escapes what HTML would
        care about, so no dangerouslySetInnerHTML (§8).
      */}
      <script type="application/ld+json">{serializeJsonLd(newsArticleJsonLd(article))}</script>

      <article className="max-w-[62ch]">
        <NewsMeta article={article} />

        <h1 className="font-display text-statement mt-3">
          {article.title}
        </h1>

        <SiteImage
          image={article.image}
          ratio="hero"
          sizes="newsArticle"
          loading="eager"
          placeholder={{ label: 'Nyhedsfoto', detail: '3:2 · valgfrit' }}
          className="rounded-card-lg mt-5 w-full"
        />

        <div className="text-ink-2 mt-5">
          <NewsBody body={article.body} />
        </div>
      </article>

      <div className="border-border mt-8 flex flex-col gap-4 border-t pt-6 md:flex-row md:items-center">
        <Link
          href="/nyheder"
          className="text-brand-700 inline-flex min-h-tap items-center gap-1.5 text-nav font-medium"
        >
          <span aria-hidden="true">←</span>
          Alle nyheder
        </Link>
        {SITE_CONTACT.primaryPhone ? (
          <PhoneAction phone={SITE_CONTACT.primaryPhone} label="Bestil på telefon" showNumber />
        ) : null}
      </div>
    </PageContainer>
  )
}
