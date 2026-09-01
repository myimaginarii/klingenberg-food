import type { Profile } from '@/lib/auth/session'

/**
 * Image upload rules — technical plan §1 (adjustment 3), §4, §8; phase 10A.
 *
 * The pure half of the image domain: every limit, every accepted type, the path
 * grammar and the refusal vocabulary live here, imported by the infrastructure
 * modules (`signed-upload.ts`, `finalize.ts`, `processing.ts`, `storage.ts`) and by
 * the browser's pre-upload downscale alike. Nothing here touches Supabase, sharp or
 * the DOM, so every rule is unit-testable and there is exactly one statement of each.
 *
 * The same rules are restated in SQL by `create_image()` and
 * `is_valid_image_derivatives()` (20260901140000): two independent layers, neither
 * trusted to be the only one (§5). A change to a limit is a change in both places,
 * and the pgTAP suite plus the unit suite hold them to each other.
 *
 * WHY THESE NUMBERS
 *   * 10 MiB byte cap — matches the storage service's own `file_size_limit`
 *     (supabase/config.toml and the `media-originals` bucket row). A client-downscaled
 *     2560 px photo is 1–3 MB; the cap is generous rather than large.
 *   * 30 megapixels / 10 000 px per side — the decompression-bomb guard. sharp is
 *     given this as `limitInputPixels`, so a tiny file claiming enormous dimensions
 *     is refused by the decoder, not by our arithmetic after the fact.
 *   * 2560 px client-side — §1 adjustment 3 verbatim: "Browser downscales to max
 *     2560 px with <canvas> before upload". An optimisation for phone networks,
 *     never a security boundary — the server re-measures everything.
 *   * JPEG, PNG and WebP in — what phone cameras and exports actually produce once
 *     Safari's canvas has re-encoded HEIC. SVG is deliberately not accepted: it is
 *     a script format wearing an image extension and needs a different security
 *     model this system has no reason to build. Animation is refused for the same
 *     product reason — every image slot in the design is a photograph.
 */

/** The three input types the pipeline accepts, and the extension each stores under. */
export const ACCEPTED_UPLOAD_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type AcceptedUploadMime = keyof typeof ACCEPTED_UPLOAD_TYPES

export function isAcceptedUploadMime(mime: string): mime is AcceptedUploadMime {
  return Object.hasOwn(ACCEPTED_UPLOAD_TYPES, mime)
}

/** The shape of the server-side limits — wide, so tests can shrink them. */
export type ImageLimits = {
  readonly maxBytes: number
  readonly maxPixels: number
  readonly maxSidePx: number
}

/** Server-side limits on what an original may be. Restated by `create_image()`. */
export const IMAGE_LIMITS: ImageLimits = {
  /** Maximum original size in bytes (10 MiB — the bucket's own limit). */
  maxBytes: 10_485_760,
  /** Maximum decoded pixels (30 MP) — handed to sharp as `limitInputPixels`. */
  maxPixels: 30_000_000,
  /** Maximum decoded width or height. */
  maxSidePx: 10_000,
}

/** §1 adjustment 3: the browser downscales to at most this before uploading. */
export const CLIENT_MAX_SIDE_PX = 2560

/** Private bucket holding validated originals. Written via signed upload only. */
export const ORIGINALS_BUCKET = 'media-originals'

/** Public bucket holding derivatives. Written by the service role only. */
export const DERIVATIVES_BUCKET = 'media'

const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ORIGINAL_PATH_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/original\.(jpg|png|webp)$/

/**
 * The one place an original's storage path is composed. The upload id is a server
 * random UUID — the person's filename is never part of the identity (§8), so
 * `../`, backslashes, Unicode confusables and duplicate names have nothing to reach.
 */
export function originalStoragePath(uploadId: string, mime: AcceptedUploadMime): string {
  if (!UPLOAD_ID_PATTERN.test(uploadId)) {
    throw new Error('originalStoragePath: the upload id must be a lowercase UUID')
  }
  return `${uploadId}/original.${ACCEPTED_UPLOAD_TYPES[mime]}`
}

/** True when a value is exactly a path the trusted upload flow could have minted. */
export function isOriginalStoragePath(value: unknown): value is string {
  return typeof value === 'string' && ORIGINAL_PATH_PATTERN.test(value)
}

/** The upload id inside a valid original path — the base every derivative shares. */
export function uploadIdOfStoragePath(storagePath: string): string {
  const uploadId = ORIGINAL_PATH_PATTERN.exec(storagePath)?.[1]
  if (uploadId === undefined) {
    throw new Error('uploadIdOfStoragePath: not a trusted original storage path')
  }
  return uploadId
}

/** The declared MIME an original path was stored under. */
export function mimeOfStoragePath(storagePath: string): AcceptedUploadMime {
  const match = ORIGINAL_PATH_PATTERN.exec(storagePath)
  if (match === null) {
    throw new Error('mimeOfStoragePath: not a trusted original storage path')
  }
  const entry = Object.entries(ACCEPTED_UPLOAD_TYPES).find(([, ext]) => ext === match[2])
  // The pattern and the table are built from the same three types.
  return entry![0] as AcceptedUploadMime
}

/**
 * The original filename, reduced to display metadata (§8: identity comes from the
 * generated path, never from here). Path separators are cut down to the basename,
 * control characters removed, length capped to the database's own constraint.
 * Blank is absent, as everywhere else in this system.
 */
export function sanitizeOriginalFilename(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const basename = value.split(/[/\\]/).pop() ?? ''
  const printable = basename.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (printable.length === 0) return null
  return printable.slice(0, 160)
}

/**
 * Who may manage images: any active staff or owner session (§5 — "Dish photos, and
 * all image upload / replace / delete: Staff yes, Owner yes"). The same predicate
 * `requireStaff()` enforces; stated here so the flow modules can refuse a profile
 * they were handed without importing the cookie-reading session module.
 */
export function mayManageImages(profile: Profile | null): profile is Profile {
  return profile !== null && profile.disabledAt === null
}

/**
 * Everything the upload pipeline can refuse, and the one Danish sentence each
 * refusal shows. The vocabulary is the module's contract with the 10B screen: the
 * screen maps codes to notices exactly as the news editor maps its own, and no
 * server log detail — no path, no processor message, no stack — ever reaches the
 * browser (§8, §10g).
 */
export const IMAGE_REFUSALS = {
  forbidden: 'Du har ikke adgang til at ændre billeder.',
  unsupported_type: 'Billedtypen understøttes ikke. Brug JPEG, PNG eller WebP.',
  too_large: 'Billedet fylder for meget. Det må højst fylde 10 MB.',
  too_many_pixels:
    'Billedet er for stort. Det må højst være 30 megapixel og højst 10.000 pixel på hver led.',
  not_an_image: 'Filen ser ikke ud til at være et billede. Vælg et JPEG-, PNG- eller WebP-billede.',
  animated: 'Animerede billeder understøttes ikke. Vælg et almindeligt foto.',
  missing_upload: 'Billedet nåede ikke frem. Prøv at uploade det igen.',
  failed: 'Billedet kunne ikke uploades. Prøv igen.',
} as const

export type ImageRefusalCode = keyof typeof IMAGE_REFUSALS

export function isImageRefusalCode(value: string): value is ImageRefusalCode {
  return Object.hasOwn(IMAGE_REFUSALS, value)
}
