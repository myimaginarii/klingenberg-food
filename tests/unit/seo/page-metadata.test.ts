import { describe, expect, it } from 'vitest'

import { buildStaticPublicImage, seoImageOf } from '@/lib/images/public'
import { homeMetadata, pageMetadata, unindexedMetadata } from '@/lib/seo/metadata'

/**
 * Titles, canonical URLs and the share card for the six public pages — technical
 * plan §11; phase 2B.
 *
 * The rules, as assertions:
 *
 *   * one title pattern, `Menu | Klingenberg Food`, with no em dash and no venue name
 *     repeated into every page's width — the Forside is the one page that names what
 *     the business is;
 *   * every page states its own canonical URL, absolute, trailing-slashed and resolved
 *     through `lib/config/site.ts`, so it is the same address the sitemap names;
 *   * the Open Graph block agrees with the tags above it rather than restating them
 *     differently, and carries `og:locale = da_DK`;
 *   * a page with no photograph carries **no** `og:image` and falls back to the small
 *     Twitter card, because a large-image card with no image is an empty box;
 *   * a page that is about to 404 gets neither a canonical URL nor a share card.
 */

const IMAGE = seoImageOf(
  buildStaticPublicImage({ slot: 'test-photo', alt: 'Et billede', width: 1440, height: 960 }),
)

describe('pageMetadata', () => {
  const metadata = pageMetadata('Menu', 'Kortet.', { path: '/menu', image: IMAGE })

  it('uses one separator, the business name, and no em dash', () => {
    expect(metadata.title).toBe('Menu | Klingenberg Food')
    expect(String(metadata.title)).not.toContain('—')
  })

  it('states the canonical URL the sitemap also names, trailing slash and all', () => {
    expect(metadata.alternates).toEqual({ canonical: 'http://localhost:3000/menu/' })
  })

  it('gives Open Graph the same title, description and URL as the tags above it', () => {
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      title: 'Menu | Klingenberg Food',
      description: 'Kortet.',
      url: 'http://localhost:3000/menu/',
      siteName: 'Klingenberg Food',
      locale: 'da_DK',
    })
  })

  it('names one processed derivative, with its measured size and authored description', () => {
    expect((metadata.openGraph as { images: unknown[] }).images).toEqual([
      {
        // Absolute, not left for `metadataBase` to complete: Next joins its pathname
        // onto a site-relative URL, which prefixes a sub-path deployment twice.
        url: 'http://localhost:3000/media/test-photo/1440.webp',
        width: 1440,
        height: 960,
        alt: 'Et billede',
      },
    ])
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' })
  })

  it('omits the image entirely, and shrinks the card, for a page without a photograph', () => {
    const withoutImage = pageMetadata('Nyheder', 'Nyt.', { path: '/nyheder' })
    const openGraph = withoutImage.openGraph as Record<string, unknown>

    expect('images' in openGraph).toBe(false)
    expect(withoutImage.twitter).toMatchObject({ card: 'summary' })
    expect('images' in (withoutImage.twitter as Record<string, unknown>)).toBe(false)
  })

  it('takes the path as this repository writes it and adds the slash itself', () => {
    expect(pageMetadata('Find os', 'x', { path: '/find-os' }).alternates).toEqual({
      canonical: 'http://localhost:3000/find-os/',
    })
  })
})

describe('homeMetadata', () => {
  const metadata = homeMetadata('Forsidens beskrivelse.', { image: IMAGE })

  it('names the business and what it is, rather than "Forside"', () => {
    expect(metadata.title).toBe('Klingenberg Food | Burgerbar i Carl Nielsen Hallen')
  })

  it('is canonical at the root of the site', () => {
    expect(metadata.alternates).toEqual({ canonical: 'http://localhost:3000/' })
    expect(metadata.openGraph).toMatchObject({ url: 'http://localhost:3000/' })
  })
})

describe('unindexedMetadata', () => {
  const metadata = unindexedMetadata('Siden findes ikke', 'Adressen findes ikke.')

  it('titles the page but claims no address for it', () => {
    expect(metadata.title).toBe('Siden findes ikke | Klingenberg Food')
    expect(metadata.alternates).toBeUndefined()
  })

  it('hands a messaging app no card for an address that names nothing', () => {
    expect(metadata.openGraph).toBeUndefined()
    expect(metadata.twitter).toBeUndefined()
  })
})
