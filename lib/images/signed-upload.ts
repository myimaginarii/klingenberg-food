import 'server-only'

import type { Profile } from '@/lib/auth/session'

import {
  isAcceptedUploadMime,
  mayManageImages,
  originalStoragePath,
  sanitizeOriginalFilename,
  IMAGE_LIMITS,
  IMAGE_REFUSALS,
} from './rules'
import type { ImageStorage, SignedUploadTarget } from './storage'

/**
 * Requesting upload permission — technical plan §1 (adjustment 2), §8; phase 10A.
 *
 * The first step of the pipeline: an authenticated staff member declares an intent
 * ("a JPEG of roughly this size") and receives a constrained upload target — one
 * signed token, valid for one server-generated path in the private originals
 * bucket, and nothing else. The Server Action that will call this in 10B runs
 * `requireStaff()` first and hands the profile in; the flow refuses on its own as
 * well, so the authorization does not depend on every future caller remembering.
 *
 * THE AUTHORITY BOUNDARY (§3 of the phase brief). The browser contributes exactly
 * two things: the declared type — which only chooses the extension the original is
 * *stored* under, never what it is *treated* as — and a filename kept as sanitised
 * display metadata. The path is a server random UUID; the bucket is fixed; the
 * token is scoped by the storage service to that one path; and the finalize step
 * re-measures everything from the actual bytes. Declared size and type are checked
 * here only to refuse the obviously wrong upload before any bytes move — the
 * bucket's own `file_size_limit` and `allowed_mime_types` enforce them at the
 * door, and the server enforces them again from the downloaded bytes.
 */

export type UploadRequestIntent = {
  /** The file's declared MIME type — browser input, verified later from bytes. */
  readonly declaredMime: string
  /** The file's declared byte size — browser input, enforced again by the bucket and the server. */
  readonly declaredBytes: number
  /** The person's filename — becomes sanitised display metadata, never identity. */
  readonly filename?: string | null
}

export type UploadRequestResult =
  | {
      readonly status: 'ready'
      /** Where — and only where — the browser may PUT the bytes. */
      readonly target: SignedUploadTarget
      /** What finalize will store as `original_filename`, or null. */
      readonly originalFilename: string | null
    }
  | {
      readonly status: 'forbidden' | 'unsupported_type' | 'too_large' | 'failed'
      /** The Danish sentence the screen shows for this refusal. */
      readonly message: string
    }

export async function requestImageUpload(
  storage: ImageStorage,
  profile: Profile | null,
  intent: UploadRequestIntent,
): Promise<UploadRequestResult> {
  if (!mayManageImages(profile)) {
    return { status: 'forbidden', message: IMAGE_REFUSALS.forbidden }
  }

  if (!isAcceptedUploadMime(intent.declaredMime)) {
    return { status: 'unsupported_type', message: IMAGE_REFUSALS.unsupported_type }
  }

  if (
    !Number.isSafeInteger(intent.declaredBytes) ||
    intent.declaredBytes < 1 ||
    intent.declaredBytes > IMAGE_LIMITS.maxBytes
  ) {
    return { status: 'too_large', message: IMAGE_REFUSALS.too_large }
  }

  // The identity is born here, on the server, and nowhere else (§17).
  const path = originalStoragePath(crypto.randomUUID(), intent.declaredMime)

  const target = await storage.mintOriginalUpload(path)
  if (target === null) {
    return { status: 'failed', message: IMAGE_REFUSALS.failed }
  }

  return {
    status: 'ready',
    target,
    originalFilename: sanitizeOriginalFilename(intent.filename),
  }
}
