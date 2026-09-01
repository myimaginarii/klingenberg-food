import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { readSiteContact } from '@/lib/content/contact'
import { articleExcerpt, readPublishedArticle } from '@/lib/content/news'
import { pageMetadata } from '@/lib/seo/metadata'

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
 * slug generation, publish and unpublish are `/admin/nyheder` (phase 9A, §0q), and the
 * `NewsArticle` JSON-LD and the sitemap entry are phase 9B. What is here is a loader
 * that can only see published rows — which in Draft Mode reads through the staff
 * member's own JWT, so Forhåndsvis opens an unpublished article at its real address
 * (§6) — a renderer for the structured body, and a 404 for everything else.
 *
 * The layout follows the approved system rather than introducing a new design (§7f):
 * title, category, date, image frame, body, a link back to the list, and the phone call
 * to action the whole site carries.
 */
type ArticleParams = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: ArticleParams): Promise<Metadata> {
  const { slug } = await params
  const article = await readPublishedArticle(slug)

  if (article === null) return pageMetadata('Nyhed', 'Nyhed fra Klingenberg Food.')

  return pageMetadata(article.title, articleExcerpt(article) ?? 'Nyt fra Klingenberg Food.')
}

export default async function NyhedPage({ params }: ArticleParams) {
  const { slug } = await params
  const [article, contact] = await Promise.all([readPublishedArticle(slug), readSiteContact()])

  if (article === null) notFound()

  return (
    <PageContainer className="py-7 md:py-11">
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
