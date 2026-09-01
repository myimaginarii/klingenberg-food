import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Profile } from '@/lib/auth/session'

import { derivativePath, derivativePathsFor } from './derivatives'
import { processImage } from './processing'
import {
  isOriginalStoragePath,
  mayManageImages,
  mimeOfStoragePath,
  sanitizeOriginalFilename,
  uploadIdOfStoragePath,
  IMAGE_REFUSALS,
  type ImageRefusalCode,
} from './rules'
import type { ImageStorage } from './storage'

/**
 * Finalizing an upload — technical plan §1 (adjustments 2 and 3), §8; phase 10A.
 *
 * The second half of the pipeline, and the step where trust is established:
 *
 *   download the uploaded original (private bucket, service role)
 *     -> validate and process the actual bytes (lib/images/processing.ts)
 *     -> write every derivative to the public bucket
 *     -> only then create the images row, through create_image(), with the
 *        caller's own JWT so RLS and the audit trail see the real person
 *     -> on any failure: remove what was written, return one Danish sentence,
 *        leave no row.
 *
 * WRITE ORDERING (§12 of the phase brief). The database row is written last, so a
 * row can never point at files that do not exist. The failure inverse — files that
 * no row points at — is handled by best-effort removal in every failure branch;
 * where even the removal fails, the leftovers are unreferenced bytes in storage
 * (the original in a private bucket; derivatives at an unpublished random path),
 * logged server-side, and never a broken page. That asymmetry is deliberate: a
 * usable half-record is a bug, an orphaned file is garbage.
 *
 * IDEMPOTENCY (§13). The storage path is the identity of one finalized upload.
 * `create_image()` answers a replay — a double-click, a browser retry, a duplicate
 * finalize — with the existing row and no second audit entry; derivative writes
 * upsert, so re-running the pipeline over the same upload converges on the same
 * state. A stale token replay cannot mint a *new* identity: paths are UUIDs the
 * server generated once.
 *
 * THE BROWSER'S CONTRIBUTION is the storage path it was handed by
 * `requestImageUpload()` and the display filename. Everything else — dimensions,
 * type, sizes, the derivative record, the uploader, the row id — is measured or
 * derived here and re-validated inside `create_image()` (§3 of the phase brief).
 */

export type FinalizeUploadRequest = {
  /** The path `requestImageUpload()` minted. Grammar-checked, never composed from input. */
  readonly storagePath: unknown
  /** The person's filename, kept as sanitised display metadata. */
  readonly originalFilename?: unknown
}

export type FinalizeUploadResult =
  | {
      /** `created` on the first finalize; `exists` when a replay found the row. */
      readonly status: 'created' | 'exists'
      readonly imageId: string
      readonly updatedAt: string
    }
  | {
      readonly status: ImageRefusalCode
      /** The Danish sentence the screen shows for this refusal. */
      readonly message: string
    }

function refusal(code: ImageRefusalCode): FinalizeUploadResult {
  return { status: code, message: IMAGE_REFUSALS[code] }
}

export type FinalizeDependencies = {
  readonly storage: ImageStorage
  /** The caller's own request-scoped client — RLS re-checks the person (§5). */
  readonly database: SupabaseClient
}

export async function finalizeImageUpload(
  deps: FinalizeDependencies,
  profile: Profile | null,
  request: FinalizeUploadRequest,
): Promise<FinalizeUploadResult> {
  if (!mayManageImages(profile)) {
    return refusal('forbidden')
  }

  if (!isOriginalStoragePath(request.storagePath)) {
    // Not a path this system ever minted — a tampered or truncated request.
    return refusal('failed')
  }
  const storagePath = request.storagePath

  const original = await deps.storage.downloadOriginal(storagePath)
  if (original === null) {
    return refusal('missing_upload')
  }

  const processed = await processImage(original)
  if (processed.status !== 'ok') {
    // The upload is not something this system serves; nothing may keep it.
    await deps.storage.removeOriginal(storagePath)
    return refusal(processed.status)
  }

  if (processed.mime !== mimeOfStoragePath(storagePath)) {
    // The bytes are a real image, but not the type the upload declared — the
    // stored extension would be a lie. The honest flow can never hit this (the
    // declared type chose the extension and the client sent that same file), so
    // treat it as tampering: refuse before any derivative exists, keep nothing.
    // create_image() re-checks the same pairing as the second layer.
    await deps.storage.removeOriginal(storagePath)
    return refusal('unsupported_type')
  }

  const uploadId = uploadIdOfStoragePath(storagePath)
  const written: string[] = []
  for (const derivative of processed.derivatives) {
    const path = derivativePath(uploadId, derivative.width, derivative.format)
    const ok = await deps.storage.uploadDerivative(path, derivative.data, derivative.contentType)
    if (!ok) {
      await deps.storage.removeDerivatives(written)
      await deps.storage.removeOriginal(storagePath)
      return refusal('failed')
    }
    written.push(path)
  }

  const { data, error } = await deps.database.rpc('create_image', {
    p_storage_path: storagePath,
    // The sniffed truth of the bytes — already checked against the stored
    // extension above; create_image() pairs the two again as the second layer.
    p_mime: processed.mime,
    p_width: processed.width,
    p_height: processed.height,
    p_bytes: processed.bytes,
    p_original_filename: sanitizeOriginalFilename(request.originalFilename),
    p_derivatives: processed.record,
  })

  const row = data as { status?: string; id?: string; updated_at?: string } | null
  if (error || !row || (row.status !== 'created' && row.status !== 'exists')) {
    if (error) {
      console.error(`create_image for ${storagePath} was refused: ${error.message}`)
    }
    await deps.storage.removeDerivatives(derivativePathsFor(storagePath, processed.record))
    await deps.storage.removeOriginal(storagePath)
    return refusal('failed')
  }

  return {
    status: row.status,
    imageId: row.id as string,
    updatedAt: row.updated_at as string,
  }
}
