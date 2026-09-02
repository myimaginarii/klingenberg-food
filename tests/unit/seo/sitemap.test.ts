import { describe, expect, it } from 'vitest'

import {
  newsSitemapEntries,
  STATIC_SITEMAP_PATHS,
  staticSitemapEntries,
} from '@/lib/seo/sitemap'

/**
 * Sitemap membership — §11, §7f; phase 9B. What the sitemap contains is a pure
 * function, so eligibility is asserted as data: the six public pages, plus exactly
 * the articles the published-only read handed in, at their frozen slugs, stamped
 * with their own `updated_at`.
 */

describe('staticSitemapEntries', () => {
  it('lists exactly the six public pages, absolute, and never /admin or /api', () => {
    const urls = staticSitemapEntries().map((entry) => entry.url)

    expect(STATIC_SITEMAP_PATHS).toHaveLength(6)
    expect(urls).toEqual([
      'http://localhost:3000/',
      'http://localhost:3000/menu',
      'http://localhost:3000/nyheder',
      'http://localhost:3000/om-os',
      'http://localhost:3000/find-os',
      'http://localhost:3000/mad-ud-af-huset',
    ])
    expect(urls.some((url) => url.includes('/admin') || url.includes('/api'))).toBe(false)
  })

  it('invents no lastModified for pages whose data records none', () => {
    for (const entry of staticSitemapEntries()) {
      expect(entry.lastModified).toBeUndefined()
    }
  })

  it('leaves Mad ud af huset out while the page is switched off, and nothing else (phase 11B)', () => {
    const urls = staticSitemapEntries(['takeaway']).map((entry) => entry.url)

    expect(urls).toHaveLength(5)
    expect(urls).not.toContain('http://localhost:3000/mad-ud-af-huset')
    expect(urls).toContain('http://localhost:3000/find-os')
  })

  it('an empty hidden list is the six pages', () => {
    expect(staticSitemapEntries([])).toEqual(staticSitemapEntries())
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
        url: 'http://localhost:3000/nyheder/ny-burger-i-oktober',
        lastModified: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        url: 'http://localhost:3000/nyheder/lukket-i-paasken',
        lastModified: new Date('2026-08-20T08:00:00.000Z'),
      },
    ])
  })

  it('adds nothing of its own: no articles in, no entries out', () => {
    expect(newsSitemapEntries([])).toEqual([])
  })
})
