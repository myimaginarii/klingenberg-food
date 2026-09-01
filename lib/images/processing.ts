import 'server-only'

import sharp from 'sharp'

import {
  derivativeRecord,
  planDerivatives,
  DERIVATIVE_CONTENT_TYPES,
  DERIVATIVE_FORMATS,
  type DerivativeFormat,
  type DerivativeRecord,
  type DerivativeSize,
} from './derivatives'
import {
  IMAGE_LIMITS,
  isAcceptedUploadMime,
  type AcceptedUploadMime,
  type ImageLimits,
} from './rules'

/**
 * Trusted image processing — technical plan §1 (adjustment 3), §8; phase 10A.
 *
 * The only module that imports sharp, and the place §8's "Malicious upload" row is
 * implemented: the actual bytes are sniffed and decoded — the filename and the
 * declared Content-Type prove nothing — size and pixel limits are enforced by the
 * decoder itself, orientation is normalised from EXIF, and the derivative ladder is
 * re-encoded from scratch. Everything the images row will claim about the file is
 * measured here, on the server, after the fact.
 *
 * EXIF AND PRIVACY (§8: "strips EXIF including GPS"). sharp copies no metadata to
 * its output unless `withMetadata()`/`keepMetadata()` is called, and nothing here
 * calls either — so every derivative leaves this module with no EXIF, no GPS, no
 * XMP and no thumbnail, and orientation is baked into the pixels instead of carried
 * as a tag. The processing suite asserts it on real encoded output rather than
 * trusting this paragraph.
 *
 * DECOMPRESSION BOMBS. `limitInputPixels` hands the pixel cap to libvips, so a
 * 4 KB file claiming 4 000 000 000 pixels is refused by the decoder before any
 * allocation our arithmetic would have missed. The dimension checks below repeat
 * the rule from the sniffed header — two layers, as everywhere.
 *
 * MEMORY. Derivatives are rendered strictly one at a time from the single input
 * buffer (§28): at no point does more than one full-size decode live in memory,
 * and the encoded outputs are at most a few hundred kilobytes each.
 */

/** Encoder settings — one statement, shared by every rung. */
export const AVIF_QUALITY = 55
export const WEBP_QUALITY = 80

const FORMAT_MIMES: Record<string, AcceptedUploadMime> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** One encoded derivative, ready to be written to the public bucket. */
export type RenderedDerivative = {
  readonly width: number
  readonly height: number
  readonly format: DerivativeFormat
  readonly contentType: string
  readonly data: Buffer
}

export type ProcessedImage = {
  readonly status: 'ok'
  /** The sniffed type of the actual bytes — never the declared Content-Type. */
  readonly mime: AcceptedUploadMime
  /** Post-orientation dimensions: what a person sees, not what the file stores. */
  readonly width: number
  readonly height: number
  readonly bytes: number
  readonly record: DerivativeRecord
  readonly derivatives: readonly RenderedDerivative[]
}

export type ProcessingRefusalCode =
  | 'too_large'
  | 'too_many_pixels'
  | 'unsupported_type'
  | 'not_an_image'
  | 'animated'

export type ProcessingRefusal = { readonly status: ProcessingRefusalCode }

export type ProcessingResult = ProcessedImage | ProcessingRefusal

/** What the header sniff reports — the subset of sharp's metadata the rules read. */
export type SniffedImage = {
  readonly format?: string
  readonly width?: number
  readonly height?: number
  readonly orientation?: number
  readonly pages?: number
}

export type ClassifiedImage =
  | {
      readonly status: 'ok'
      readonly mime: AcceptedUploadMime
      /** Post-orientation: what a person sees, not what the file stores. */
      readonly width: number
      readonly height: number
    }
  | ProcessingRefusal

/**
 * The pure classification of a sniffed header: accepted type, no animation,
 * bounded size. Exported so every refusal branch — including `animated`, which
 * sharp itself cannot easily be made to *produce* a fixture for — is pinned as a
 * unit; `processImage()` is its one production caller.
 */
export function classifySniffedImage(
  sniffed: SniffedImage,
  byteLength: number,
  limits: ImageLimits = IMAGE_LIMITS,
): ClassifiedImage {
  if (byteLength < 1) {
    return { status: 'not_an_image' }
  }
  if (byteLength > limits.maxBytes) {
    return { status: 'too_large' }
  }

  const mime = sniffed.format === undefined ? undefined : FORMAT_MIMES[sniffed.format]
  if (mime === undefined || !isAcceptedUploadMime(mime)) {
    // A real format sharp knows (SVG, GIF, TIFF, AVIF, HEIF, PDF…) that this
    // system does not accept — or bytes it could not identify at all.
    return { status: 'unsupported_type' }
  }

  if (sniffed.pages !== undefined && sniffed.pages > 1) {
    return { status: 'animated' }
  }

  if (sniffed.width === undefined || sniffed.height === undefined) {
    return { status: 'not_an_image' }
  }

  // EXIF orientations 5–8 rotate by 90°, so the visible dimensions swap.
  const rotated = (sniffed.orientation ?? 1) >= 5
  const width = rotated ? sniffed.height : sniffed.width
  const height = rotated ? sniffed.width : sniffed.height

  if (
    width > limits.maxSidePx ||
    height > limits.maxSidePx ||
    width * height > limits.maxPixels
  ) {
    return { status: 'too_many_pixels' }
  }

  return { status: 'ok', mime, width, height }
}

/**
 * Validate an uploaded original and render its derivative ladder.
 *
 * The limits are a parameter so the refusal branches are testable with small
 * fixtures; every real caller passes nothing and gets `IMAGE_LIMITS`.
 */
export async function processImage(
  input: Uint8Array,
  limits: ImageLimits = IMAGE_LIMITS,
): Promise<ProcessingResult> {
  if (input.byteLength === 0) {
    return { status: 'not_an_image' }
  }

  // The sniff parses the header only — no pixel allocation — so it runs without
  // the pixel limit; a bomb is refused by the classification below, and the limit
  // is handed to every decoding pipeline as the second layer.
  let sniffed
  try {
    sniffed = await sharp(input).metadata()
  } catch {
    return { status: 'not_an_image' }
  }

  const classified = classifySniffedImage(sniffed, input.byteLength, limits)
  if (classified.status !== 'ok') {
    return classified
  }
  const { mime, width, height } = classified

  const plan = planDerivatives(width, height)

  const derivatives: RenderedDerivative[] = []
  const measured: DerivativeSize[] = []
  try {
    for (const size of plan) {
      for (const format of DERIVATIVE_FORMATS) {
        const pipeline = sharp(input, { limitInputPixels: limits.maxPixels })
          .rotate() // bake the EXIF orientation into the pixels
          .resize({ width: size.width, withoutEnlargement: true })

        const { data, info } = await (format === 'avif'
          ? pipeline.avif({ quality: AVIF_QUALITY })
          : pipeline.webp({ quality: WEBP_QUALITY })
        ).toBuffer({ resolveWithObject: true })

        derivatives.push({
          width: info.width,
          height: info.height,
          format,
          contentType: DERIVATIVE_CONTENT_TYPES[format],
          data,
        })

        if (format === DERIVATIVE_FORMATS[0]) {
          measured.push({ width: info.width, height: info.height })
        }
      }
    }
  } catch {
    // The header sniffed as an image but the pixel data does not decode — a
    // truncated or corrupt file, or a polyglot that stops being an image past
    // its header. Nothing partial leaves this module.
    return { status: 'not_an_image' }
  }

  return {
    status: 'ok',
    mime,
    width,
    height,
    bytes: input.byteLength,
    record: derivativeRecord(measured),
    derivatives,
  }
}
