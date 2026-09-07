import { describe, expect, it } from 'vitest'

import { buildStaticPublicImage, seoImageOf } from '@/lib/images/public'
import { newsArticleJsonLd } from '@/lib/seo/news-article'
import { newsArticleMetadata } from '@/lib/seo/metadata'

/**
 * The article's Open Graph image — §11; phase 10C-2 (brief §14, §16).
 *
 * Three rules, each an assertion: a published article with a selected image carries
 * one `og:image` that is a public derivative with its measured dimensions; an article
 * without one carries no `og:image` at all (the branded fallback is not supplied, so
 * it is omitted rather than invented); and the visible image, the `og:image` and the
 * JSON-LD `image` name the same asset.
 */

const SLOT = 'news-photo'

const article = {
  title: 'Ny burger i oktober',
  description: 'Første afsnit.',
  path: '/nyheder/ny-burger-i-oktober',
  publishedDate: '2026-10-01',
  modifiedAt: '2026-09-01T10:00:00.000Z',
}

/** `sourceWidth` decides the ladder: 960 gives 480+960, 1440 adds the 1440 rung. */
function image(altText: string | null, sourceWidth = 960) {
  return buildStaticPublicImage({
    slot: SLOT,
    alt: altText,
    width: sourceWidth,
    height: Math.round((sourceWidth * 2) / 3),
  })
}

describe('newsArticleMetadata — og:image', () => {
  it('omits og:image entirely for an article without a selected image', () => {
    const metadata = newsArticleMetadata(article)
    const openGraph = metadata.openGraph as Record<string, unknown>

    expect('images' in openGraph).toBe(false)
    expect(newsArticleMetadata({ ...article, image: null }).openGraph).toEqual(openGraph)
    // The rest of §7f's block is exactly as phase 9B left it.
    expect(metadata.alternates).toEqual({
      canonical: 'http://localhost:3000/nyheder/ny-burger-i-oktober/',
    })
  })

  it('carries one public derivative with its real dimensions and the authored alt', () => {
    const metadata = newsArticleMetadata({ ...article, image: seoImageOf(image('Burgeren fra siden.')) })
    const openGraph = metadata.openGraph as { images: unknown[] }

    expect(openGraph.images).toEqual([
      {
        // Only 480 and 960 exist for this source, so the largest available rung is
        // the one at or above 1200 — nothing invented past the ladder.
        url: `/media/${SLOT}/960.webp`,
        width: 960,
        height: 640,
        alt: 'Burgeren fra siden.',
      },
    ])
  })

  it('omits the alt rather than sending an empty one when nothing is authored', () => {
    const metadata = newsArticleMetadata({ ...article, image: seoImageOf(image(null)) })
    const [first] = (metadata.openGraph as { images: Record<string, unknown>[] }).images

    expect(first).not.toHaveProperty('alt')
    expect(first!.url).toContain('/media/')
    expect(JSON.stringify(metadata)).not.toContain('media-originals')
  })

  it('names the same asset the JSON-LD image names (brief §16)', () => {
    const model = image('Burgeren fra siden.', 2160)
    const seo = seoImageOf(model)
    const metadata = newsArticleMetadata({ ...article, image: seo })
    const jsonLd = newsArticleJsonLd({
      title: article.title,
      slug: 'ny-burger-i-oktober',
      displayDate: '2026-10-01',
      updatedAt: article.modifiedAt,
      image: model,
    })

    const [ogImage] = (metadata.openGraph as { images: { url: string }[] }).images
    expect(ogImage!.url).toBe(jsonLd.image!.url)
    expect(ogImage!.url).toBe(`/media/${SLOT}/1440.webp`)
    // …and that asset is one of the candidates the visible <picture> offers.
    expect(model.candidates.map((candidate) => candidate.webpUrl)).toContain(ogImage!.url)
  })
})
