/**
 * The derivative plan — technical plan §1 (adjustment 3), §4.
 *
 * One fixed ladder, stated once: AVIF + WebP at 480 / 960 / 1440 / 2160, filtered
 * to the source width so a small photograph is never upscaled, with the source width
 * itself as the single rung when it is smaller than the smallest step.
 *
 * Two callers share it and cannot disagree: `scripts/images/build-static-derivatives.mjs`
 * renders exactly these rungs into `public/media/` at build time, and
 * `lib/images/public.ts` names exactly these rungs in the `srcset` a page prints. The
 * ladder, the encoder settings and the path grammar are all here rather than restated
 * in either place.
 */

/** §1 adjustment 3's ladder, in ascending order. */
export const DERIVATIVE_WIDTHS = [480, 960, 1440, 2160] as const

/** The two output formats, in the order a `<picture>` would offer them. */
export const DERIVATIVE_FORMATS = ['avif', 'webp'] as const

/**
 * Encoder settings — one statement, read by the build-time pipeline
 * (`scripts/images/build-static-derivatives.mjs`) rather than restated there.
 */
export const AVIF_QUALITY = 55
export const WEBP_QUALITY = 80

export type DerivativeFormat = (typeof DERIVATIVE_FORMATS)[number]

/** One rung of the ladder: the dimensions a derivative pair was rendered at. */
export type DerivativeSize = {
  readonly width: number
  readonly height: number
}

/** A rendered ladder: which formats exist, and at which dimensions. */
export type DerivativeRecord = {
  readonly formats: readonly DerivativeFormat[]
  readonly widths: readonly DerivativeSize[]
}

/**
 * The widths to render for a source of the given width: the ladder filtered to the
 * source — never upscaled — or the source width alone when it is below the ladder.
 */
export function planDerivativeWidths(sourceWidth: number): readonly number[] {
  const within = DERIVATIVE_WIDTHS.filter((width) => width <= sourceWidth)
  return within.length > 0 ? within : [sourceWidth]
}

/** The height a resize-to-width produces, as sharp rounds it, never below 1. */
export function derivativeHeightFor(
  targetWidth: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  return Math.max(1, Math.round((targetWidth * sourceHeight) / sourceWidth))
}

/** The full plan for a source: every rung with its expected dimensions. */
export function planDerivatives(
  sourceWidth: number,
  sourceHeight: number,
): readonly DerivativeSize[] {
  return planDerivativeWidths(sourceWidth).map((width) => ({
    width,
    height: derivativeHeightFor(width, sourceWidth, sourceHeight),
  }))
}

/**
 * The one place a derivative's path is composed: `<slot>/<width>.<format>`.
 */
export function derivativePath(slot: string, width: number, format: DerivativeFormat): string {
  return `${slot}/${width}.${format}`
}

/**
 * Where the rendered derivatives live under `public/`.
 *
 * `public/<STATIC_MEDIA_DIRECTORY>/<slot>/<width>.<format>`, rendered once by
 * `scripts/images/build-static-derivatives.mjs` from the tracked photographs in
 * `public/photos/` and served as ordinary static files.
 */
export const STATIC_MEDIA_DIRECTORY = 'media'

/** The site-relative URL of one static derivative: `/media/home-hero/960.webp`. */
export function staticDerivativeUrl(slot: string, width: number, format: DerivativeFormat): string {
  return `/${STATIC_MEDIA_DIRECTORY}/${derivativePath(slot, width, format)}`
}
