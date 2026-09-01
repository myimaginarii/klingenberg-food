import { describe, expect, it } from 'vitest'

import { newsArticleJsonLd, serializeJsonLd } from '@/lib/seo/news-article'

/**
 * The NewsArticle JSON-LD block — §7f, §11; phase 9B. The shape is a value, so the
 * three rules are assertions: every field restates stored data, a value the data
 * does not carry is absent rather than invented, and the serialised form is valid
 * JSON that cannot close a <script> element early.
 */

const ARTICLE = {
  title: 'Ny burger i oktober',
  slug: 'ny-burger-i-oktober',
  displayDate: '2026-10-01' as const,
  updatedAt: '2026-09-01T10:00:00.000Z',
}

describe('newsArticleJsonLd', () => {
  it('builds §11’s block from the stored values, and only those', () => {
    expect(newsArticleJsonLd(ARTICLE)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      mainEntityOfPage: 'http://localhost:3000/nyheder/ny-burger-i-oktober',
      headline: 'Ny burger i oktober',
      datePublished: '2026-10-01',
      dateModified: '2026-09-01T10:00:00.000Z',
      publisher: { '@type': 'Organization', name: 'Klingenberg Food' },
    })
  })

  it('omits datePublished when no display date is stored — absent, not invented', () => {
    const block = newsArticleJsonLd({ ...ARTICLE, displayDate: null })

    expect('datePublished' in block).toBe(false)
    expect(block.dateModified).toBe(ARTICLE.updatedAt)
  })

  it('invents no image, no author and no publisher logo (§11: nothing invented)', () => {
    const block = newsArticleJsonLd(ARTICLE) as Record<string, unknown>

    expect(block.image).toBeUndefined()
    expect(block.author).toBeUndefined()
    expect((block.publisher as Record<string, unknown>).logo).toBeUndefined()
  })

  it('uses the frozen slug under the configured origin — never a hard-coded domain', () => {
    const block = newsArticleJsonLd({ ...ARTICLE, slug: 'anden-adresse' })

    expect(block.mainEntityOfPage).toBe('http://localhost:3000/nyheder/anden-adresse')
  })
})

describe('serializeJsonLd', () => {
  it('round-trips through JSON.parse unchanged', () => {
    const block = newsArticleJsonLd(ARTICLE)

    expect(JSON.parse(serializeJsonLd(block))).toEqual(block)
  })

  it('escapes the characters HTML cares about, so a title cannot close the script', () => {
    const hostile = newsArticleJsonLd({
      ...ARTICLE,
      title: '</script><script>alert(1)</script> & <b>',
    })
    const serialized = serializeJsonLd(hostile)

    expect(serialized).not.toContain('<')
    expect(serialized).not.toContain('>')
    expect(serialized).not.toContain('&')
    expect(JSON.parse(serialized)).toEqual(hostile)
  })
})
