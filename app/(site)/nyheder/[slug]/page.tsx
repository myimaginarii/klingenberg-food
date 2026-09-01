import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { readSiteContact } from '@/lib/content/contact'
import { articleExcerpt, readPublishedArticle } from '@/lib/content/news'
import { newsArticlePath } from '@/lib/news/slug'
import { newsArticleMetadata, pageMetadata } from '@/lib/seo/metadata'
import { newsArticleJsonLd, serializeJsonLd } from '@/lib/seo/news-article'

import { MediaPlaceholder } from '@/components/site/MediaPlaceholder'
import { NewsBody } from '@/components/site/news/NewsBody'
import { NewsMeta } from '@/components/site/news/NewsMeta'
import { PageContainer } from '@/components/site/PageContainer'
import { PhoneAction } from '@/components/site/PhoneAction'

/**
 * A single news article — technical plan §7f, design 1j.
 *
 * **Scope.** This is the smallest read-only page that keeps the approved "Læs mere"
 * action from pointing at nothing. The news *system* lives elsewhere: the editor, the
 * slug generation, publish and unpublish are `/admin/nyheder` (phases 9A + 9B, §0q,
 * §0r). What is here is a loader that can only see published rows — which in Draft
 * Mode reads through the staff member's own JWT, so Forhåndsvis opens an unpublished
 * article at its real address (§6) — a renderer for the structured body, the
 * `NewsArticle` JSON-LD and §7f's canonical/article metadata (9B, published articles
 * only), and a 404 for everything else.
 *
 * The layout follows the approved system rather than introducing a new design (§7f):
 * title, category, date, image frame, body, a link back to the list, and the phone call
 * to action the whole site carries.
 */
type ArticleParams = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: ArticleParams): Promise<Metadata> {
  const { slug } = await params
  const [article, draft] = await Promise.all([readPublishedArticle(slug), draftMode()])

  if (article === null) return pageMetadata('Nyhed', 'Nyhed fra Klingenberg Food.')

  const description = articleExcerpt(article) ?? 'Nyt fra Klingenberg Food.'

  // A Draft Mode preview may be showing an article that is not published: §7f's
  // canonical and article metadata belong to public addresses only, so the preview
  // carries the plain title and description and claims nothing.
  if (draft.isEnabled) return pageMetadata(article.title, description)

  return newsArticleMetadata({
    title: article.title,
    description,
    path: newsArticlePath(article.slug),
    publishedDate: article.displayDate,
    modifiedAt: article.updatedAt,
  })
}

export default async function NyhedPage({ params }: ArticleParams) {
  const { slug } = await params
  const [article, contact, draft] = await Promise.all([
    readPublishedArticle(slug),
    readSiteContact(),
    draftMode(),
  ])

  if (article === null) notFound()

  return (
    <PageContainer className="py-7 md:py-11">
      {/*
        §11's NewsArticle block: published database values only, built by the SEO
        helper and rendered as an ordinary text child — the serializer escapes what
        HTML would care about, so no dangerouslySetInnerHTML (§8). A Draft Mode
        preview may be showing an unpublished article and gets no block at all: a
        draft has no public claims to make (§7f).
      */}
      {draft.isEnabled ? null : (
        <script type="application/ld+json">{serializeJsonLd(newsArticleJsonLd(article))}</script>
      )}

      <article className="max-w-[62ch]">
        <NewsMeta article={article} />

        <h1 className="font-display mt-3 text-[2rem] leading-tight tracking-[-0.02em] md:text-[2.5rem]">
          {article.title}
        </h1>

        <MediaPlaceholder
          ratio="hero"
          label="Nyhedsfoto"
          detail="3:2 · valgfrit"
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
        {contact.primaryPhone ? (
          <PhoneAction phone={contact.primaryPhone} label="Bestil på telefon" showNumber />
        ) : null}
      </div>
    </PageContainer>
  )
}
