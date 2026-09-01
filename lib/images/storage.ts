import 'server-only'

import { createSupabaseServiceClient } from '@/lib/supabase/service'

import { DERIVATIVES_BUCKET, ORIGINALS_BUCKET } from './rules'

/**
 * The storage boundary — technical plan §1 (adjustment 2), §8; phase 10A.
 *
 * This is the service-role key's first — and only — caller in the running
 * application, the door `lib/supabase/service.ts` was defined to have. §8 counts
 * "signed upload URLs" as the key's one runtime call site; this module is that call
 * site grown to the full pipeline the same sentence of §8 describes: minting the
 * signed URL, reading the uploaded original back for validation, writing the
 * processed derivatives, and removing files again when a step after them fails.
 * Nothing else in `app/` or `lib/` may import the service client, and the
 * images-boundary policy suite asserts exactly that.
 *
 * WHY THE SERVICE ROLE AT ALL. Neither bucket has (or may gain) an RLS policy for
 * `anon` or `authenticated`: a staff JWT that could write storage objects directly
 * could put unprocessed bytes into the public bucket, which is precisely what §8's
 * pipeline exists to make impossible. The browser writes through exactly one thing —
 * a signed upload token pinned to one generated path in the private bucket — and
 * every other object operation happens here, on the server, after `requireStaff()`.
 *
 * The exported surface is deliberately capability-shaped (mint, download, upload
 * derivative, remove) rather than a client handle, so no caller can reach an
 * arbitrary bucket or path through it (§16, §22).
 */

/** A constrained upload target: one path in the originals bucket, one token. */
export type SignedUploadTarget = {
  /** The path inside the originals bucket the token is valid for. */
  readonly path: string
  /** The single-use upload token the storage service will verify. */
  readonly token: string
  /**
   * The absolute URL the browser PUTs to — composed by the storage service, handed
   * through so the browser needs no Supabase client and no configuration of its own.
   */
  readonly url: string
}

export type ImageStorage = {
  /** Mint a signed upload token for one exact path in the private originals bucket. */
  mintOriginalUpload(path: string): Promise<SignedUploadTarget | null>
  /** Read an uploaded original back for validation, or null when it is not there. */
  downloadOriginal(path: string): Promise<Uint8Array | null>
  /** Write one processed derivative into the public bucket. True on success. */
  uploadDerivative(path: string, data: Uint8Array, contentType: string): Promise<boolean>
  /** Best-effort removal of an original; failures are logged, never thrown. */
  removeOriginal(path: string): Promise<void>
  /** Best-effort removal of derivatives; failures are logged, never thrown. */
  removeDerivatives(paths: readonly string[]): Promise<void>
}

/** Derivatives are immutable — their paths are content-unique — so caches may hold them for a year. */
const DERIVATIVE_CACHE_SECONDS = '31536000'

export function createImageStorage(): ImageStorage {
  const service = createSupabaseServiceClient()

  return {
    async mintOriginalUpload(path) {
      const { data, error } = await service.storage
        .from(ORIGINALS_BUCKET)
        .createSignedUploadUrl(path)
      if (error || !data) {
        console.error(`Minting a signed upload for the originals bucket failed: ${error?.message}`)
        return null
      }
      return { path: data.path, token: data.token, url: data.signedUrl }
    },

    async downloadOriginal(path) {
      const { data, error } = await service.storage.from(ORIGINALS_BUCKET).download(path)
      if (error || !data) {
        return null
      }
      return new Uint8Array(await data.arrayBuffer())
    },

    async uploadDerivative(path, data, contentType) {
      // upsert keeps a replayed finalize idempotent: the same pipeline writing the
      // same path is a no-op in effect, never a 409 that strands the flow.
      const { error } = await service.storage.from(DERIVATIVES_BUCKET).upload(path, data, {
        contentType,
        cacheControl: DERIVATIVE_CACHE_SECONDS,
        upsert: true,
      })
      if (error) {
        console.error(`Writing derivative ${path} failed: ${error.message}`)
        return false
      }
      return true
    },

    async removeOriginal(path) {
      const { error } = await service.storage.from(ORIGINALS_BUCKET).remove([path])
      if (error) {
        // An orphaned original in a private bucket is stale bytes, never a broken
        // page — log it for the operator rather than failing the caller's cleanup.
        console.error(`Removing original ${path} failed: ${error.message}`)
      }
    },

    async removeDerivatives(paths) {
      if (paths.length === 0) return
      const { error } = await service.storage.from(DERIVATIVES_BUCKET).remove([...paths])
      if (error) {
        console.error(`Removing ${paths.length} derivative(s) failed: ${error.message}`)
      }
    },
  }
}
