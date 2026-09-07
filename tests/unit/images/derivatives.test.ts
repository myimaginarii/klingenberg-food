import { describe, expect, it } from 'vitest'

import {
  derivativeHeightFor,
  derivativePath,
  planDerivativeWidths,
  planDerivatives,
  staticDerivativeUrl,
  DERIVATIVE_FORMATS,
  DERIVATIVE_WIDTHS,
  STATIC_MEDIA_DIRECTORY,
} from '@/lib/images/derivatives'

/**
 * The derivative plan — technical plan §1 (adjustment 3).
 *
 * One ladder, stated once, never upscaled, and one path grammar shared by the page
 * that names a file and the build script that writes it. This suite pins both, so a
 * change to either would have to be a deliberate change to both.
 */

const SLOT = 'home-hero'

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

describe('the path grammar', () => {
  it('composes `<slot>/<width>.<format>`', () => {
    expect(derivativePath(SLOT, 480, 'avif')).toBe(`${SLOT}/480.avif`)
    expect(derivativePath(SLOT, 2160, 'webp')).toBe(`${SLOT}/2160.webp`)
  })

  it('serves the rendered files from /media, which is what the build writes into', () => {
    expect(STATIC_MEDIA_DIRECTORY).toBe('media')
    expect(staticDerivativeUrl(SLOT, 960, 'webp')).toBe(`/media/${SLOT}/960.webp`)
    expect(staticDerivativeUrl(SLOT, 960, 'avif')).toBe(`/media/${SLOT}/960.avif`)
  })

  it('offers AVIF before WebP, as a <picture> would', () => {
    expect(DERIVATIVE_FORMATS).toEqual(['avif', 'webp'])
  })
})
