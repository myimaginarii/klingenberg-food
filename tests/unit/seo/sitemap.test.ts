import { describe, expect, it } from 'vitest'

import {
  canonicalUrl,
  newsSitemapEntries,
  STATIC_SITEMAP_PATHS,
  staticSitemapEntries,
} from '@/lib/seo/sitemap'

/**
 * Sitemap membership — §11, §7f. What the sitemap contains is a pure function, so
 * eligibility is asserted as data: the six public pages, plus exactly the tracked
 * articles handed in, at their stable slugs, stamped with their own `updatedAt`.
 *
 * Every URL ends in a slash, because `trailingSlash: true` means every page of the
 * export is a directory. A sitemap that named `/menu` would advertise an address the
 * host answers with a redirect, and would disagree with the site's own links.
 */

describe('staticSitemapEntries', () => {
  it('lists exactly the six public pages, absolute and trailing-slashed', () => {
    const urls = staticSitemapEntries().map((entry) => entry.url)

    expect(STATIC_SITEMAP_PATHS).toHaveLength(6)
    expect(urls).toEqual([
      'http://localhost:3000/',
      'http://localhost:3000/menu/',
      'http://localhost:3000/mad-ud-af-huset/',
      'http://localhost:3000/om-os/',
      'http://localhost:3000/nyheder/',
      'http://localhost:3000/find-os/',
    ])
  })

  it('names no address the retired administration used to answer', () => {
    const urls = staticSitemapEntries().map((entry) => entry.url)
    expect(urls.some((url) => url.includes('/admin') || url.includes('/api'))).toBe(false)
  })

  it('gives every entry the trailing slash the export actually serves', () => {
    for (const entry of staticSitemapEntries()) {
      expect(entry.url.endsWith('/'), entry.url).toBe(true)
    }
  })

  it('invents no lastModified for pages whose data records none', () => {
    for (const entry of staticSitemapEntries()) {
      expect(entry.lastModified).toBeUndefined()
    }
  })

})

describe('canonicalUrl', () => {
  it('is the same shape the sitemap names, so a page and its entry agree', () => {
    expect(canonicalUrl('/menu')).toBe('http://localhost:3000/menu/')
    expect(canonicalUrl('/menu/')).toBe('http://localhost:3000/menu/')
    expect(canonicalUrl('/')).toBe('http://localhost:3000/')
  })
})

describe('newsSitemapEntries', () => {
  it('maps each published article to its frozen slug with lastModified from updated_at', () => {
    const entries = newsSitemapEntries([
      { slug: 'ny-burger-i-oktober', updatedAt: '2026-09-01T10:00:00.000Z' },
      { slug: 'lukket-i-paasken', updatedAt: '2026-08-20T08:00:00.000Z' },
    ])

    expect(entries).toEqual([
      {
        url: 'http://localhost:3000/nyheder/ny-burger-i-oktober/',
        lastModified: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        url: 'http://localhost:3000/nyheder/lukket-i-paasken/',
        lastModified: new Date('2026-08-20T08:00:00.000Z'),
      },
    ])
  })

  it('adds nothing of its own: no articles in, no entries out', () => {
    expect(newsSitemapEntries([])).toEqual([])
  })
})
