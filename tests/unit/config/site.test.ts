import { afterEach, describe, expect, it } from 'vitest'

import { absoluteUrl, assetPath, getBasePath, getSiteUrl, getSiteUrlObject } from '@/lib/config/site'

/**
 * The one door to an absolute site address — technical plan §10d.
 *
 * `SITE_URL` states the deployment's full public address, and two things are derived
 * from it and nowhere else: the origin every absolute URL is printed against, and the
 * sub-path the site is served under. A GitHub Pages *project* site is the second case
 * (`https://<owner>.github.io/<repository>/`), a custom domain later is the first, and
 * neither is a code change.
 */
const ORIGINAL = process.env.SITE_URL

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SITE_URL
  else process.env.SITE_URL = ORIGINAL
})

function withSiteUrl(value: string | undefined): void {
  if (value === undefined) delete process.env.SITE_URL
  else process.env.SITE_URL = value
}

describe('no SITE_URL — local development', () => {
  it('falls back to localhost with no base path', () => {
    withSiteUrl(undefined)
    expect(getSiteUrl()).toBe('http://localhost:3000')
    expect(getBasePath()).toBe('')
    expect(assetPath('/brand/logo.svg')).toBe('/brand/logo.svg')
    expect(absoluteUrl('/menu/')).toBe('http://localhost:3000/menu/')
    expect(getSiteUrlObject().toString()).toBe('http://localhost:3000/')
  })

  it('treats an empty or unusable value the same way', () => {
    for (const value of ['', '   ', 'not a url', 'ftp://example.test', 'https://']) {
      withSiteUrl(value)
      expect(getSiteUrl()).toBe('http://localhost:3000')
      expect(getBasePath()).toBe('')
    }
  })
})

describe('a site at the root of a host', () => {
  it('has no base path, and leaves every path alone', () => {
    withSiteUrl('https://example.test')
    expect(getBasePath()).toBe('')
    expect(getSiteUrl()).toBe('https://example.test')
    expect(assetPath('/media/home-hero/960.webp')).toBe('/media/home-hero/960.webp')
    expect(absoluteUrl('/find-os/')).toBe('https://example.test/find-os/')
  })

  it('accepts a bare host, and a trailing slash, as the same thing', () => {
    for (const value of ['example.test', 'https://example.test/', 'https://example.test']) {
      withSiteUrl(value)
      expect(getSiteUrl()).toBe('https://example.test')
      expect(getBasePath()).toBe('')
    }
  })
})

describe('a site under a sub-path — a GitHub Pages project site', () => {
  const PROJECT = 'https://example.test/a-repo/'

  it('reports the sub-path as a base path Next.js accepts: leading slash, no trailing one', () => {
    withSiteUrl(PROJECT)
    expect(getBasePath()).toBe('/a-repo')
  })

  it('reads the same base path with or without the trailing slash', () => {
    for (const value of ['https://example.test/a-repo', PROJECT, 'https://example.test/a-repo//']) {
      withSiteUrl(value)
      expect(getBasePath()).toBe('/a-repo')
    }
  })

  it('carries every static asset across the sub-path', () => {
    withSiteUrl(PROJECT)
    expect(assetPath('/brand/logo.svg')).toBe('/a-repo/brand/logo.svg')
    expect(assetPath('/media/home-hero/960.webp')).toBe('/a-repo/media/home-hero/960.webp')
  })

  it('prints canonical and sitemap URLs inside the sub-path, not beside it', () => {
    withSiteUrl(PROJECT)
    expect(getSiteUrl()).toBe('https://example.test/a-repo')
    expect(absoluteUrl('/')).toBe('https://example.test/a-repo/')
    expect(absoluteUrl('/menu/')).toBe('https://example.test/a-repo/menu/')
    expect(absoluteUrl('/nyheder/en-artikel/')).toBe('https://example.test/a-repo/nyheder/en-artikel/')
    expect(getSiteUrlObject().toString()).toBe('https://example.test/a-repo/')
  })
})
