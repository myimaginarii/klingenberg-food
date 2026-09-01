import {
  isAcceptedUploadMime,
  CLIENT_MAX_SIDE_PX,
  type AcceptedUploadMime,
} from './rules'

/**
 * Browser-side upload preparation — technical plan §1 (adjustments 2 and 3);
 * phase 10A.
 *
 * The client half of the pipeline, unmounted until the 10B library screen exists
 * (the same no-caller state 8C-2's generator shipped in). It does exactly two
 * things:
 *
 *   1. Downscale an oversized camera photo to at most 2560 px on its longest side
 *      before it travels — §1 adjustment 3 verbatim: "fast on phones, cheap on the
 *      network". This is an optimisation and nothing else. The server re-measures,
 *      re-validates and re-encodes everything from the bytes it receives; a
 *      bypassed or buggy downscale changes bandwidth, never safety.
 *   2. PUT the bytes to the one signed URL the server minted. The URL arrives
 *      complete from the Server Action, so the browser holds no Supabase client,
 *      no key and no configuration (§1 adjustment 2) — one fetch to one
 *      pre-authorized address.
 *
 * ORIENTATION. `createImageBitmap(file, { imageOrientation: 'from-image' })` bakes
 * the EXIF orientation into the pixels before drawing, so a re-encoded photo can
 * never end up sideways. A small file is passed through untouched — its EXIF tag
 * still orients it everywhere, and the server's `.rotate()` normalises it in every
 * derivative.
 *
 * WHAT IS DELIBERATELY NOT HERE: no cropping, no editing, no format choice, no
 * derivative dimensions — the browser proposes nothing the server treats as
 * authoritative (§3 of the phase brief). No `'use client'` directive either: this
 * is a library module for the 10B component to import, not a component.
 */

/** The planned re-encode for an oversized image, or null for pass-through. */
export type DownscalePlan = {
  readonly width: number
  readonly height: number
} | null

/**
 * Pure planning: at most `maxSide` on the longest side, aspect preserved, never
 * upscaled. Null means the file travels as it is.
 */
export function planClientDownscale(
  width: number,
  height: number,
  maxSide: number = CLIENT_MAX_SIDE_PX,
): DownscalePlan {
  if (width <= maxSide && height <= maxSide) {
    return null
  }
  const scale = maxSide / Math.max(width, height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** JPEG/WebP re-encode quality for the pre-upload downscale. */
export const CLIENT_ENCODE_QUALITY = 0.85

export type PreparedUpload =
  | {
      readonly status: 'ready'
      /** The bytes to upload — the original file, or its downscaled re-encode. */
      readonly blob: Blob
      /** The blob's actual type: what the upload request must declare. */
      readonly mime: AcceptedUploadMime
      /** The person's filename, passed along as display metadata. */
      readonly filename: string
    }
  | { readonly status: 'unsupported_type' | 'not_an_image' }

/**
 * Decode, orient and — when oversized — downscale a picked file. Runs only in a
 * browser; the pure parts above carry the unit-tested rules.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedUpload> {
  if (!isAcceptedUploadMime(file.type)) {
    return { status: 'unsupported_type' }
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return { status: 'not_an_image' }
  }

  try {
    const plan = planClientDownscale(bitmap.width, bitmap.height)
    if (plan === null) {
      return { status: 'ready', blob: file, mime: file.type, filename: file.name }
    }

    const canvas = document.createElement('canvas')
    canvas.width = plan.width
    canvas.height = plan.height
    const context = canvas.getContext('2d')
    if (context === null) {
      // No 2D context (memory pressure, headless quirk): send the original and
      // let the server's own limits decide. The downscale is an optimisation.
      return { status: 'ready', blob: file, mime: file.type, filename: file.name }
    }
    context.drawImage(bitmap, 0, 0, plan.width, plan.height)

    const blob = await new Promise<Blob | null>((resolve) => {
      // Re-encode in the file's own format. A browser that cannot encode the
      // requested type falls back to PNG per the canvas spec — also accepted.
      canvas.toBlob(resolve, file.type, CLIENT_ENCODE_QUALITY)
    })
    if (blob === null || !isAcceptedUploadMime(blob.type)) {
      return { status: 'not_an_image' }
    }

    return { status: 'ready', blob, mime: blob.type, filename: file.name }
  } finally {
    bitmap.close()
  }
}

/**
 * The plain PUT §1 adjustment 2 describes, to the one URL the server minted.
 * True when the storage service accepted the bytes.
 */
export async function putToSignedUploadUrl(url: string, blob: Blob): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': blob.type, 'x-upsert': 'false' },
      body: blob,
    })
    return response.ok
  } catch {
    return false
  }
}
