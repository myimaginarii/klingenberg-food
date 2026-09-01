import { describe, expect, it } from 'vitest'

import { overlayDraft } from '@/lib/drafts/overlay'
import {
  buildPublicImage,
  IMAGE_SIZES,
  publicImageAlt,
  seoImageOf,
} from '@/lib/images/public'
import { dishDraft } from '@/lib/schemas/menu'

/**
 * The public image model — phase 10C-2 (brief §3–§8, §33).
 *
 * A stored row becomes exactly one renderable value, or none: the processed
 * candidates in both formats, one fallback, the intrinsic dimensions and the alt.
 * Every refusal here is a refusal to guess — a malformed record or an untrusted
 * path yields `null` and the caller's placeholder, never an invented derivative
 * URL and never the private original.
 */

const ORIGIN = 'http://localhost:54321'
const UPLOAD = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const PATH = `${UPLOAD}/original.jpg`
const PUBLIC = `${ORIGIN}/storage/v1/object/public/media/${UPLOAD}`

const FULL_LADDER = {
  formats: ['avif', 'webp'],
  widths: [
    { width: 480, height: 320 },
    { width: 960, height: 640 },
    { width: 1440, height: 960 },
    { width: 2160, height: 1440 },
  ],
}

describe('buildPublicImage', () => {
  it('turns a stored record into ascending AVIF and WebP candidates from the public bucket', () => {
    const image = buildPublicImage(ORIGIN, {
      storage_path: PATH,
      alt_text: 'Burgeren fra siden.',
      derivatives: FULL_LADDER,
    })!

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
    const image = buildPublicImage(ORIGIN, {
      storage_path: PATH,
      alt_text: null,
      derivatives: FULL_LADDER,
    })!

    expect(image.width).toBe(2160)
    expect(image.height).toBe(1440)
  })

  it('references no rung the record does not carry — a small source has its own single rung', () => {
    const image = buildPublicImage(ORIGIN, {
      storage_path: PATH,
      alt_text: null,
      derivatives: { formats: ['avif', 'webp'], widths: [{ width: 320, height: 240 }] },
    })!

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
    const full = buildPublicImage(ORIGIN, { storage_path: PATH, alt_text: null, derivatives: FULL_LADDER })!
    expect(full.src).toBe(`${PUBLIC}/960.webp`)

    const twoRungs = buildPublicImage(ORIGIN, {
      storage_path: PATH,
      alt_text: null,
      derivatives: {
        formats: ['avif', 'webp'],
        widths: [
          { width: 480, height: 320 },
          { width: 700, height: 467 },
        ],
      },
    })!
    // Nothing reaches 960, so the largest available rung is the fallback.
    expect(twoRungs.src).toBe(`${PUBLIC}/700.webp`)
  })

  it('orders the candidates by width even when the record was stored out of order', () => {
    const image = buildPublicImage(ORIGIN, {
      storage_path: PATH,
      alt_text: null,
      derivatives: {
        formats: ['avif', 'webp'],
        widths: [
          { width: 960, height: 640 },
          { width: 480, height: 320 },
        ],
      },
    })!

    expect(image.candidates.map((candidate) => candidate.width)).toEqual([480, 960])
    expect(image.webpSrcSet.startsWith(`${PUBLIC}/480.webp 480w`)).toBe(true)
  })

  it('never names the private bucket or the original path', () => {
    const image = buildPublicImage(ORIGIN, {
      storage_path: PATH,
      alt_text: 'x',
      derivatives: FULL_LADDER,
    })!

    const everything = JSON.stringify(image)
    expect(everything).not.toContain('media-originals')
    expect(everything).not.toContain('original.jpg')
  })

  describe('a record that cannot be rendered safely yields null (brief §4)', () => {
    const malformed: unknown[] = [
      null,
      'ikke et objekt',
      {},
      { formats: ['avif', 'webp'] },
      { formats: ['avif', 'webp'], widths: [] },
      { formats: ['avif', 'webp'], widths: [{ width: '480', height: 320 }] },
      { formats: ['avif', 'webp'], widths: [{ width: 480 }] },
      { formats: ['avif', 'webp'], widths: [{ width: 0, height: 320 }] },
      { formats: ['jpeg'], widths: [{ width: 480, height: 320 }] },
      { formats: 'avif', widths: [{ width: 480, height: 320 }] },
    ]

    it.each(malformed)('%j', (derivatives) => {
      expect(buildPublicImage(ORIGIN, { storage_path: PATH, alt_text: null, derivatives })).toBeNull()
    })

    it('refuses a storage path the trusted upload flow could not have minted', () => {
      for (const storagePath of [
        null,
        '',
        '../original.jpg',
        `${UPLOAD}/original.gif`,
        'not-a-uuid/original.jpg',
        `${UPLOAD}/480.webp`,
      ]) {
        expect(
          buildPublicImage(ORIGIN, { storage_path: storagePath, alt_text: null, derivatives: FULL_LADDER }),
        ).toBeNull()
      }
    })
  })
})

describe('publicImageAlt — the accepted accessibility model (brief §8)', () => {
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

describe('seoImageOf — the one derivative every SEO surface names (brief §14–§16)', () => {
  it('chooses the smallest rung at or above 1200 px, in WebP, with its measured size', () => {
    const image = buildPublicImage(ORIGIN, { storage_path: PATH, alt_text: 'Alt.', derivatives: FULL_LADDER })!

    expect(seoImageOf(image)).toEqual({
      url: `${PUBLIC}/1440.webp`,
      width: 1440,
      height: 960,
      alt: 'Alt.',
    })
  })

  it('falls back to the largest rung when none reaches 1200 px', () => {
    const image = buildPublicImage(ORIGIN, {
      storage_path: PATH,
      alt_text: null,
      derivatives: {
        formats: ['avif', 'webp'],
        widths: [
          { width: 480, height: 320 },
          { width: 960, height: 640 },
        ],
      },
    })!

    expect(seoImageOf(image).url).toBe(`${PUBLIC}/960.webp`)
    expect(seoImageOf(image).width).toBe(960)
  })
})

describe('IMAGE_SIZES — one sizes string per approved slot (brief §7)', () => {
  it('names exactly the eight public surfaces the frames draw an entity image in', () => {
    expect(Object.keys(IMAGE_SIZES).sort()).toEqual(
      [
        'dishCard',
        'featuredDish',
        'monthlyFeature',
        'newsArticle',
        'newsCard',
        'newsTeaser',
        'weeklyCard',
      ].sort(),
    )
  })

  it('writes 100vw nowhere — every slot states its real rendered width', () => {
    for (const [slot, sizes] of Object.entries(IMAGE_SIZES)) {
      expect(sizes, slot).not.toMatch(/(^|[\s,])100vw\s*$/)
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

describe('the Draft Mode projection (brief §9)', () => {
  const LIVE = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  const PENDING = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'

  /** The read layer's own step, reduced: overlay first, then resolve the overlaid id. */
  function project(live: string | null, draft: unknown, images: Map<string, string>) {
    const { row } = overlayDraft({ image_id: live, name: 'Thor' }, draft, dishDraft)
    return row.image_id === null ? null : (images.get(row.image_id) ?? null)
  }

  const images = new Map([
    [LIVE, 'A'],
    [PENDING, 'B'],
  ])

  it('live A + draft B previews B; the guest path, which applies no draft, keeps A', () => {
    expect(project(LIVE, { image_id: PENDING }, images)).toBe('B')
    expect(project(LIVE, null, images)).toBe('A')
  })

  it('live A + a pending removal previews no image; the guest keeps A', () => {
    expect(project(LIVE, { image_id: null }, images)).toBeNull()
    expect(project(LIVE, null, images)).toBe('A')
  })

  it('live null + draft B previews B; the guest has none', () => {
    expect(project(null, { image_id: PENDING }, images)).toBe('B')
    expect(project(null, null, images)).toBeNull()
  })

  it('a pending id that names no readable image resolves to the placeholder, not a crash', () => {
    expect(project(LIVE, { image_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1' }, images)).toBeNull()
  })
})
