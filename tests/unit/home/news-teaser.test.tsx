import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { NewsAndAbout } from '@/components/site/home/NewsAndAbout'
import type { NewsArticle } from '@/lib/content/types'
import type { IsoDate } from '@/lib/time/calendar'

/**
 * The Forside's news teaser — design 1g / 1l ("Nyeste vises automatisk på
 * forsiden"); phase 9B verifies what phase 3 built.
 *
 * Two layers, asserted separately:
 *
 *   * **Selection** — the Forside takes the newest entry of the tracked article list
 *     and hard-codes none of its own. That is a property of the page's
 *     source, asserted over the source the way `admin-mapping.test.ts` asserts
 *     boundaries — a mocked render could not notice a literal article creeping in.
 *   * **Rendering** — the newest published article is a linked card, and no article
 *     at all is the honest empty state: a "Nyheder" column that says there is nothing
 *     yet, with no invented headline and no article link, while "Om os" keeps its half
 *     of the band.
 */

function article(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Ny burger i oktober',
    slug: 'ny-burger-i-oktober',
    category: 'Ny burger',
    displayDate: '2026-10-01' as IsoDate,
    updatedAt: '2026-09-01T10:00:00.000Z',
    body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Første afsnit.' }] }] },
    image: null,
    ...overrides,
  }
}

function render(latest: NewsArticle | null): string {
  return renderToStaticMarkup(
    <NewsAndAbout
      latestArticle={latest}
      latestExcerpt={latest === null ? null : 'Første afsnit.'}
      aboutHeading="Om os-overskrift"
      aboutText="Om os-tekst."
    />,
  )
}

describe('the teaser, rendered', () => {
  it('shows the article as a link to its own address', () => {
    const html = render(article())

    expect(html).toContain('Seneste nyt')
    expect(html).toContain('Ny burger i oktober')
    expect(html).toContain('href="/nyheder/ny-burger-i-oktober"')
    expect(html).toContain('Første afsnit.')
  })

  it('renders the honest empty state, and no article, when nothing is published', () => {
    const html = render(null)

    expect(html).not.toContain('Seneste nyt')
    expect(html).not.toContain('/nyheder/')
    expect(html).toContain('Nyheder')
    expect(html).toContain('Der er ingen nyheder lige nu.')
    expect(html).toContain('href="/nyheder"')
    // The band itself survives: Om os is still there.
    expect(html).toContain('Om os-overskrift')
  })
})

describe('the selection, asserted over the Forside’s own source', () => {
  const source = readFileSync(join(process.cwd(), 'app', '(site)', 'page.tsx'), 'utf-8')

  it('reads the tracked, newest-first list and nothing else', () => {
    expect(source).toContain("import { NEWS_ARTICLES } from '@/content/site/news'")
  })

  it('takes the list’s first entry and otherwise nothing', () => {
    expect(source).toContain('NEWS_ARTICLES[0] ?? null')
  })

  it('hard-codes no article: every title on the Forside comes from data', () => {
    // The award fallback is the one sanctioned literal block; nothing about news is.
    expect(source).not.toMatch(/NewsTeaserCard/)
    expect(source).not.toMatch(/nyheder\//)
  })
})
