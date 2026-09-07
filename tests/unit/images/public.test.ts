import { afterEach, describe, expect, it } from 'vitest'

import { buildStaticPublicImage, IMAGE_SIZES, publicImageAlt, seoImageOf } from '@/lib/images/public'

/**
 * The public image model.
 *
 * A tracked photograph becomes exactly one renderable value: the candidates in both
 * formats, one fallback, the intrinsic dimensions and the alt. Every URL it names is a
 * rung `planDerivatives()` chooses, which is the same function
 * `scripts/images/build-static-derivatives.mjs` renders from — so the model can never
 * point at a file the build did not write, and there is no rung to invent.
 */

const SLOT = 'home-hero'
const PUBLIC = `/media/${SLOT}`

/** A source large enough for the whole ladder: 3000 × 2000. */
const LARGE = { slot: SLOT, alt: null as string | null, width: 3000, height: 2000 }

describe('buildStaticPublicImage', () => {
  it('turns a tracked photograph into ascending AVIF and WebP candidates under /media', () => {
    const image = buildStaticPublicImage({ ...LARGE, alt: 'Burgeren fra siden.' })

    expect(image.avifSrcSet).toBe(
      `${PUBLIC}/480.avif 480w, ${PUBLIC}/960.avif 960w, ${PUBLIC}/1440.avif 1440w, ${PUBLIC}/2160.avif 2160w`,
    )
    expect(image.webpSrcSet).toBe(
      `${PUBLIC}/480.webp 480w, ${PUBLIC}/960.webp 960w, ${PUBLIC}/1440.webp 1440w, ${PUBLIC}/2160.webp 2160w`,
    )
    expect(image.candidates.map((candidate) => candidate.width)).toEqual([480, 960, 1440, 2160])
    expect(image.alt).toBe('Burgeren fra siden.')
  })

  it('states the intrinsic dimensions of the largest rung, which every rung shares the ratio of', () => {
    const image = buildStaticPublicImage(LARGE)

    expect(image.width).toBe(2160)
    expect(image.height).toBe(1440)
  })

  it('never upscales — a source below the ladder has its own single rung', () => {
    const image = buildStaticPublicImage({ slot: SLOT, alt: null, width: 320, height: 240 })

    expect(image.avifSrcSet).toBe(`${PUBLIC}/320.avif 320w`)
    expect(image.webpSrcSet).toBe(`${PUBLIC}/320.webp 320w`)
    expect(image.src).toBe(`${PUBLIC}/320.webp`)
    expect(image.width).toBe(320)
    expect(image.height).toBe(240)
    for (const width of [480, 960, 1440, 2160]) {
      expect(image.avifSrcSet).not.toContain(`/${width}.`)
      expect(image.webpSrcSet).not.toContain(`/${width}.`)
    }
  })

  it('falls back to the 960 rung in WebP — never the largest, never AVIF', () => {
    expect(buildStaticPublicImage(LARGE).src).toBe(`${PUBLIC}/960.webp`)

    // A 700 px source carries the 480 rung alone; nothing reaches 960, so it stands.
    const small = buildStaticPublicImage({ slot: SLOT, alt: null, width: 700, height: 467 })
    expect(small.candidates.map((candidate) => candidate.width)).toEqual([480])
    expect(small.src).toBe(`${PUBLIC}/480.webp`)
  })

  it('names only the site-relative media path — no origin, no storage service, no source file', () => {
    const everything = JSON.stringify(buildStaticPublicImage({ ...LARGE, alt: 'x' }))

    expect(everything).not.toContain('http')
    expect(everything).not.toContain('.png')
    expect(everything).not.toContain('content/launch')
    for (const candidate of buildStaticPublicImage(LARGE).candidates) {
      expect(candidate.avifUrl.startsWith(`${PUBLIC}/`)).toBe(true)
      expect(candidate.webpUrl.startsWith(`${PUBLIC}/`)).toBe(true)
    }
  })
})

describe('publicImageAlt — the accepted accessibility model', () => {
  it('renders the authored description', () => {
    expect(publicImageAlt('Burgeren fra siden.')).toBe('Burgeren fra siden.')
  })

  it('renders an absent or blank description as alt="" — nothing is invented', () => {
    expect(publicImageAlt(null)).toBe('')
    expect(publicImageAlt(undefined)).toBe('')
    expect(publicImageAlt('')).toBe('')
    expect(publicImageAlt('   ')).toBe('')
    expect(publicImageAlt(42)).toBe('')
  })
})

describe('seoImageOf — the one derivative every SEO surface names', () => {
  it('chooses the smallest rung at or above 1200 px, in WebP, with its measured size', () => {
    const image = buildStaticPublicImage({ ...LARGE, alt: 'Alt.' })

    expect(seoImageOf(image)).toEqual({
      url: `${PUBLIC}/1440.webp`,
      width: 1440,
      height: 960,
      alt: 'Alt.',
    })
  })

  it('falls back to the largest rung when none reaches 1200 px', () => {
    // 1000 px carries 480 and 960 only.
    const image = buildStaticPublicImage({ slot: SLOT, alt: null, width: 1000, height: 667 })

    expect(seoImageOf(image).url).toBe(`${PUBLIC}/960.webp`)
    expect(seoImageOf(image).width).toBe(960)
  })
})

describe('IMAGE_SIZES — one sizes string per approved slot', () => {
  it('names exactly the public surfaces the frames draw an image in', () => {
    expect(Object.keys(IMAGE_SIZES).sort()).toEqual(
      [
        'dishCard',
        'featuredDish',
        'monthlyFeature',
        'newsArticle',
        'newsCard',
        'newsTeaser',
        'weeklyCard',
        'homeHero',
        'homeAward',
        'homeTeam',
        // Mad ud af huset's own photograph (1ai/1aj).
        'takeawayHero',
        // Om os's three frames (1i).
        'aboutVenue',
        'aboutTeam',
        'aboutKitchen',
      ].sort(),
    )
  })

  it('writes 100vw nowhere but the hero — every slot states its real rendered width', () => {
    for (const [slot, sizes] of Object.entries(IMAGE_SIZES)) {
      // 1l draws the hero photograph bleeding to both edges of the phone, with no
      // gutter (HomeHero's column has none), so the full viewport IS its width.
      if (slot !== 'homeHero') expect(sizes, slot).not.toMatch(/(^|[\s,])100vw\s*$/)
      expect(sizes, slot).toMatch(/\(min-width: 48rem\)/)
    }
  })

  it('keeps the thumbnails small: a 6rem card slot on a phone, 9.375rem from md', () => {
    expect(IMAGE_SIZES.dishCard).toBe('(min-width: 48rem) 9.375rem, 6rem')
    // The featured card is a third of the content measure from md, a 6rem thumbnail below it.
    expect(IMAGE_SIZES.featuredDish.endsWith(', 6rem')).toBe(true)
    expect(IMAGE_SIZES.featuredDish).toContain('calc((100vw - 7.5rem) / 3)')
  })
})

/**
 * A sub-path deployment — a GitHub Pages *project* site.
 *
 * These URLs end up in a plain `<img src>` and `srcset`, which is exactly what the
 * framework does **not** rewrite for a `basePath` build (it rewrites `next/link`, the
 * router's prefetches and `_next/` assets). So the prefix is applied here, through the
 * one door in `lib/config/site.ts`, and this is where that is pinned.
 */
describe('under a base path', () => {
  const ORIGINAL = process.env.SITE_URL

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SITE_URL
    else process.env.SITE_URL = ORIGINAL
  })

  it('carries every candidate, the fallback and the SEO image across the sub-path', () => {
    process.env.SITE_URL = 'https://example.test/a-repo/'
    const image = buildStaticPublicImage({ ...LARGE, alt: 'Burgeren fra siden.' })

    expect(image.src).toBe(`/a-repo${PUBLIC}/960.webp`)
    expect(image.avifSrcSet.startsWith(`/a-repo${PUBLIC}/480.avif 480w, `)).toBe(true)
    expect(image.webpSrcSet.startsWith(`/a-repo${PUBLIC}/480.webp 480w, `)).toBe(true)
    for (const candidate of image.candidates) {
      expect(candidate.avifUrl.startsWith(`/a-repo${PUBLIC}/`)).toBe(true)
      expect(candidate.webpUrl.startsWith(`/a-repo${PUBLIC}/`)).toBe(true)
    }
    expect(seoImageOf(image).url).toBe(`/a-repo${PUBLIC}/1440.webp`)
  })

  it('leaves the paths alone when the site is at the root of a host', () => {
    process.env.SITE_URL = 'https://example.test'
    expect(buildStaticPublicImage(LARGE).src).toBe(`${PUBLIC}/960.webp`)
  })
})
