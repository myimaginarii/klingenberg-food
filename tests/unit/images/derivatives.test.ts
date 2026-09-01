import { describe, expect, it } from 'vitest'

import {
  derivativeHeightFor,
  derivativePath,
  derivativePathsFor,
  derivativePublicUrlPath,
  derivativeRecord,
  planDerivativeWidths,
  planDerivatives,
  DERIVATIVE_FORMATS,
  DERIVATIVE_WIDTHS,
} from '@/lib/images/derivatives'

/**
 * The derivative plan — technical plan §1 (adjustment 3); phase 10A.
 *
 * One ladder, stated once, never upscaled. `is_valid_image_derivatives()` restates
 * these rules in SQL; this suite pins the TypeScript side so the two cannot drift
 * without a red test on whichever side moved.
 */

const UPLOAD_ID = '0b1c2d3e-4f50-4172-8394-a5b6c7d8e9f0'

describe('planDerivativeWidths', () => {
  it('is §1 adjustment 3’s ladder for a large source', () => {
    expect(DERIVATIVE_WIDTHS).toEqual([480, 960, 1440, 2160])
    expect(planDerivativeWidths(2560)).toEqual([480, 960, 1440, 2160])
    expect(planDerivativeWidths(2160)).toEqual([480, 960, 1440, 2160])
  })

  it('never upscales — rungs above the source width are dropped', () => {
    expect(planDerivativeWidths(2159)).toEqual([480, 960, 1440])
    expect(planDerivativeWidths(1600)).toEqual([480, 960, 1440])
    expect(planDerivativeWidths(960)).toEqual([480, 960])
    expect(planDerivativeWidths(480)).toEqual([480])
  })

  it('gives a source below the smallest rung its own width as the single rung', () => {
    expect(planDerivativeWidths(479)).toEqual([479])
    expect(planDerivativeWidths(300)).toEqual([300])
    expect(planDerivativeWidths(1)).toEqual([1])
  })
})

describe('derivativeHeightFor', () => {
  it('rounds like a resize-to-width does', () => {
    expect(derivativeHeightFor(480, 1600, 1200)).toBe(360)
    expect(derivativeHeightFor(960, 1600, 1200)).toBe(720)
    expect(derivativeHeightFor(480, 1000, 667)).toBe(320)
  })

  it('never reaches zero for an extreme panorama', () => {
    expect(derivativeHeightFor(480, 9000, 3)).toBe(1)
  })
})

describe('planDerivatives', () => {
  it('pairs every rung with its expected dimensions', () => {
    expect(planDerivatives(1600, 1200)).toEqual([
      { width: 480, height: 360 },
      { width: 960, height: 720 },
      { width: 1440, height: 1080 },
    ])
  })

  it('handles the below-ladder source', () => {
    expect(planDerivatives(300, 200)).toEqual([{ width: 300, height: 200 }])
  })
})

describe('the derivative record and its paths', () => {
  const record = derivativeRecord([
    { width: 480, height: 360 },
    { width: 960, height: 720 },
  ])

  it('records formats and measured sizes — and nothing else, in particular no paths', () => {
    expect(record).toEqual({
      formats: ['avif', 'webp'],
      widths: [
        { width: 480, height: 360 },
        { width: 960, height: 720 },
      ],
    })
    expect(Object.keys(record).sort()).toEqual(['formats', 'widths'])
  })

  it('derives every path from the row’s own storage path', () => {
    expect(derivativePath(UPLOAD_ID, 480, 'avif')).toBe(`${UPLOAD_ID}/480.avif`)
    expect(derivativePathsFor(`${UPLOAD_ID}/original.jpg`, record)).toEqual([
      `${UPLOAD_ID}/480.avif`,
      `${UPLOAD_ID}/480.webp`,
      `${UPLOAD_ID}/960.avif`,
      `${UPLOAD_ID}/960.webp`,
    ])
  })

  it('refuses to derive paths from a path the flow never minted', () => {
    expect(() => derivativePathsFor('media/handpicked.jpg', record)).toThrow()
  })

  it('serves derivatives from the public media bucket', () => {
    expect(derivativePublicUrlPath(`${UPLOAD_ID}/480.avif`)).toBe(
      `/storage/v1/object/public/media/${UPLOAD_ID}/480.avif`,
    )
  })

  it('offers AVIF before WebP, as a <picture> would', () => {
    expect(DERIVATIVE_FORMATS).toEqual(['avif', 'webp'])
  })
})
