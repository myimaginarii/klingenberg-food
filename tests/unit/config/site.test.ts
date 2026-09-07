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
 *
 * A Netlify build sets no variable at all: the platform already publishes the address of
 * every deploy, and the module reads it. Those cases are the second block below, and
 * they are pinned here because the choice between "the site's main address" and "this
 * preview's own address" is what keeps a Deploy Preview from printing canonical URLs
 * that point at production.
 */
const NETLIFY_VARIABLES = ['SITE_URL', 'NETLIFY', 'CONTEXT', 'URL', 'DEPLOY_PRIME_URL'] as const

const ORIGINAL = Object.fromEntries(
  NETLIFY_VARIABLES.map((name) => [name, process.env[name]]),
) as Record<(typeof NETLIFY_VARIABLES)[number], string | undefined>

afterEach(() => {
  for (const name of NETLIFY_VARIABLES) {
    const value = ORIGINAL[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function withSiteUrl(value: string | undefined): void {
  if (value === undefined) delete process.env.SITE_URL
  else process.env.SITE_URL = value
}

/** The read-only variables a Netlify builder sets, as that builder would set them. */
function onNetlify(vars: { context: string; url?: string; deployPrimeUrl?: string }): void {
  withSiteUrl(undefined)
  process.env.NETLIFY = 'true'
  process.env.CONTEXT = vars.context
  if (vars.url === undefined) delete process.env.URL
  else process.env.URL = vars.url
  if (vars.deployPrimeUrl === undefined) delete process.env.DEPLOY_PRIME_URL
  else process.env.DEPLOY_PRIME_URL = vars.deployPrimeUrl
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

describe('a Netlify build — the platform states its own address', () => {
  const MAIN = 'https://example.test'
  const PREVIEW = 'https://deploy-preview-7--example.test'

  it('prints the main address of the site on a production deploy', () => {
    onNetlify({ context: 'production', url: MAIN, deployPrimeUrl: MAIN })
    expect(getSiteUrl()).toBe(MAIN)
    expect(getBasePath()).toBe('')
    expect(absoluteUrl('/menu/')).toBe(`${MAIN}/menu/`)
    expect(assetPath('/brand/logo.svg')).toBe('/brand/logo.svg')
  })

  it('prints the address of the preview itself on a Deploy Preview, never production', () => {
    onNetlify({ context: 'deploy-preview', url: MAIN, deployPrimeUrl: PREVIEW })
    expect(getSiteUrl()).toBe(PREVIEW)
    expect(absoluteUrl('/find-os/')).toBe(`${PREVIEW}/find-os/`)
    // The preview is served at the root of its own host, so nothing is prefixed.
    expect(getBasePath()).toBe('')
    expect(assetPath('/media/home-hero/960.webp')).toBe('/media/home-hero/960.webp')
  })

  it('does the same for a branch deploy', () => {
    const BRANCH = 'https://a-branch--example.test'
    onNetlify({ context: 'branch-deploy', url: MAIN, deployPrimeUrl: BRANCH })
    expect(getSiteUrl()).toBe(BRANCH)
  })

  it('falls back to the other variable when one of the two is missing', () => {
    onNetlify({ context: 'production', deployPrimeUrl: MAIN })
    expect(getSiteUrl()).toBe(MAIN)

    onNetlify({ context: 'deploy-preview', url: MAIN })
    expect(getSiteUrl()).toBe(MAIN)
  })

  it('lets an explicit SITE_URL win, so a deployment can still be told its address', () => {
    onNetlify({ context: 'production', url: MAIN, deployPrimeUrl: MAIN })
    withSiteUrl('https://other.test/a-repo/')
    expect(getSiteUrl()).toBe('https://other.test/a-repo')
    expect(getBasePath()).toBe('/a-repo')
  })

  it('reads none of it off a Netlify builder, however URL is set', () => {
    onNetlify({ context: 'production', url: MAIN, deployPrimeUrl: MAIN })
    for (const value of [undefined, 'false', '0', 'yes']) {
      if (value === undefined) delete process.env.NETLIFY
      else process.env.NETLIFY = value
      expect(getSiteUrl()).toBe('http://localhost:3000')
      expect(getBasePath()).toBe('')
    }
  })

  it('falls back to localhost when the platform states nothing usable', () => {
    onNetlify({ context: 'production', url: '   ', deployPrimeUrl: 'not a url' })
    expect(getSiteUrl()).toBe('http://localhost:3000')
  })
})
