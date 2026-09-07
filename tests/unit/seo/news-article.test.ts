import { describe, expect, it } from 'vitest'

import { buildStaticPublicImage } from '@/lib/images/public'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import { newsArticleJsonLd } from '@/lib/seo/news-article'

/**
 * The NewsArticle JSON-LD block — §7f, §11; phase 9B, image since 10C-2. The shape
 * is a value, so the rules are assertions: every field restates stored data, a
 * value the data does not carry is absent rather than invented, the `image` names
 * the same processed derivative the page's `og:image` names, and the serialised
 * form is valid JSON that cannot close a <script> element early.
 */

const ARTICLE = {
  title: 'Ny burger i oktober',
  slug: 'ny-burger-i-oktober',
  displayDate: '2026-10-01' as const,
  updatedAt: '2026-09-01T10:00:00.000Z',
  image: null,
}

const SLOT = 'news-photo'

/** A 1440 px source: the 480, 960 and 1440 rungs. */
const IMAGE = buildStaticPublicImage({
  slot: SLOT,
  alt: 'Burgeren fra siden.',
  width: 1440,
  height: 960,
})

describe('newsArticleJsonLd', () => {
  it('builds §11’s block from the stored values, and only those', () => {
    expect(newsArticleJsonLd(ARTICLE)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      mainEntityOfPage: 'http://localhost:3000/nyheder/ny-burger-i-oktober/',
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

  it('invents no image, no author and no publisher logo for an article without a photo (§11)', () => {
    const block = newsArticleJsonLd(ARTICLE) as Record<string, unknown>

    expect(block.image).toBeUndefined()
    expect('image' in block).toBe(false)
    expect(block.author).toBeUndefined()
    expect((block.publisher as Record<string, unknown>).logo).toBeUndefined()
  })

  it('names the selected image as an ImageObject over one public derivative, with its real dimensions (10C-2)', () => {
    const block = newsArticleJsonLd({ ...ARTICLE, image: IMAGE })

    expect(block.image).toEqual({
      '@type': 'ImageObject',
      // The rung at or above 1200 px — the ladder's 1440 — in WebP, from the public
      // `media` bucket. Never the private original, never a guessed size.
      // Absolute against the configured origin: a JSON-LD block has no metadataBase
      // behind it, so it states whole URLs rather than site-relative paths.
      url: `http://localhost:3000/media/${SLOT}/1440.webp`,
      width: 1440,
      height: 960,
    })
    expect(JSON.stringify(block)).not.toContain('media-originals')
  })

  it('uses the frozen slug under the configured origin — never a hard-coded domain', () => {
    const block = newsArticleJsonLd({ ...ARTICLE, slug: 'anden-adresse' })

    expect(block.mainEntityOfPage).toBe('http://localhost:3000/nyheder/anden-adresse/')
  })
})

describe('serializeJsonLd', () => {
  it('round-trips through JSON.parse unchanged', () => {
    const block = newsArticleJsonLd({ ...ARTICLE, image: IMAGE })

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
