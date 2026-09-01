import {
  DERIVATIVES_BUCKET,
  uploadIdOfStoragePath,
} from './rules'

/**
 * The derivative plan — technical plan §1 (adjustment 3), §4; phase 10A.
 *
 * One fixed ladder, stated once: AVIF + WebP at 480 / 960 / 1440 / 2160, filtered
 * to the source width so a small original is never upscaled, with the source width
 * itself as the single rung when the original is smaller than the smallest step.
 * `is_valid_image_derivatives()` (20260901140000) restates the same rule in SQL and
 * `create_image()` refuses a record that disagrees — two layers, neither trusted
 * alone (§5).
 *
 * Derivative *paths* are never stored. `images.derivatives` records only what was
 * measured (formats and per-rung dimensions); the path of every derivative is
 * derived from the row's own `storage_path` by `derivativePath()` below. A record
 * with no stored path is a record that cannot point anywhere else — the whole class
 * of forged-path bugs has nothing to hold on to.
 */

/** §1 adjustment 3's ladder, in ascending order. */
export const DERIVATIVE_WIDTHS = [480, 960, 1440, 2160] as const

/** The two output formats, in the order a `<picture>` would offer them. */
export const DERIVATIVE_FORMATS = ['avif', 'webp'] as const

export type DerivativeFormat = (typeof DERIVATIVE_FORMATS)[number]

export const DERIVATIVE_CONTENT_TYPES: Record<DerivativeFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
}

/** One rung of the ladder: the dimensions a derivative pair was rendered at. */
export type DerivativeSize = {
  readonly width: number
  readonly height: number
}

/** The stored `images.derivatives` document, exactly as SQL validates it. */
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

/** The document `create_image()` stores, built from measured rung dimensions. */
export function derivativeRecord(widths: readonly DerivativeSize[]): DerivativeRecord {
  return { formats: DERIVATIVE_FORMATS, widths }
}

/**
 * The one place a derivative's path in the public `media` bucket is composed:
 * `<upload-id>/<width>.<format>`, sharing the original's server-generated id.
 */
export function derivativePath(uploadId: string, width: number, format: DerivativeFormat): string {
  return `${uploadId}/${width}.${format}`
}

/** Every derivative path a stored record implies — for cleanup and for rendering. */
export function derivativePathsFor(
  storagePath: string,
  record: DerivativeRecord,
): readonly string[] {
  const uploadId = uploadIdOfStoragePath(storagePath)
  return record.widths.flatMap((size) =>
    record.formats.map((format) => derivativePath(uploadId, size.width, format)),
  )
}

/** The public URL path (relative to the Supabase URL) a derivative is served from. */
export function derivativePublicUrlPath(derivative: string): string {
  return `/storage/v1/object/public/${DERIVATIVES_BUCKET}/${derivative}`
}

/**
 * The absolute public URL of one derivative — the Supabase origin plus the path
 * above. The one place an absolute storage address is composed (phase 10C-2): the
 * admin thumbnails and the public read model both call this, so no component and
 * no loader ever assembles a storage URL of its own.
 */
export function derivativePublicUrl(origin: string, derivative: string): string {
  return `${origin}${derivativePublicUrlPath(derivative)}`
}
