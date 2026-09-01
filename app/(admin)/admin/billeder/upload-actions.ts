'use server'

import { z } from 'zod'

import { requireStaff } from '@/lib/auth/guards'
import { finalizeImageUpload } from '@/lib/images/finalize'
import { IMAGE_REFUSALS } from '@/lib/images/rules'
import { requestImageUpload } from '@/lib/images/signed-upload'
import { createImageStorage } from '@/lib/images/storage'
import type { UploadFinalizeReply, UploadGrantReply } from '@/lib/images/upload-flow'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The upload flow's two doors — design 1w; technical plan §1 (adjustment 2), §8;
 * phase 10B.
 *
 * These are the thin authenticated Server Actions the phase-10A flows were written
 * for (`requestImageUpload`, `finalizeImageUpload`), called programmatically by the
 * uploader component because a signed PUT cannot be a form post. Each one:
 *
 *   1. runs `requireStaff()` first — the flows also refuse on their own, so the
 *      authorization does not depend on this file remembering (§5's two layers);
 *   2. parses its input against a **strict** shape — an unknown field, a wrong
 *      type or an extra key is a refusal, never something to pass along (brief
 *      §21: the field vocabulary is closed);
 *   3. answers with a closed, serialisable reply the reducer maps to one Danish
 *      sentence. No processor message, path detail or stack ever reaches the
 *      browser (§8, brief §22).
 *
 * What the browser may say is exactly the brief's list read backwards: a declared
 * type and size and a display filename on the way in, and the storage path the
 * server itself minted on the way back. It never chooses the uploader, the final
 * MIME, dimensions, bytes, derivatives, bucket, path or row id — no field exists
 * for any of them.
 */

const requestSchema = z.strictObject({
  /** The prepared blob's type. Checked against the accepted set server-side. */
  mime: z.string().max(100),
  /** The prepared blob's byte size. Checked against the 10 MiB cap server-side. */
  bytes: z.number().int().nonnegative(),
  /** The person's filename — display metadata, sanitised server-side. */
  filename: z.string().max(500).nullable(),
})

export async function requestUpload(input: unknown): Promise<UploadGrantReply> {
  const profile = await requireStaff()

  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    return { status: 'failed', message: IMAGE_REFUSALS.failed }
  }

  const result = await requestImageUpload(createImageStorage(), profile, {
    declaredMime: parsed.data.mime,
    declaredBytes: parsed.data.bytes,
    filename: parsed.data.filename,
  })

  if (result.status !== 'ready') {
    return {
      status: result.status === 'failed' ? 'failed' : 'refused',
      message: result.message,
    }
  }

  return { status: 'ready', url: result.target.url, path: result.target.path }
}

const finalizeSchema = z.strictObject({
  /** The path `requestUpload` answered with. Grammar-checked again by the flow. */
  path: z.string().max(300),
  filename: z.string().max(500).nullable(),
})

export async function finalizeUpload(input: unknown): Promise<UploadFinalizeReply> {
  const profile = await requireStaff()

  const parsed = finalizeSchema.safeParse(input)
  if (!parsed.success) {
    return { status: 'failed', message: IMAGE_REFUSALS.failed }
  }

  const result = await finalizeImageUpload(
    { storage: createImageStorage(), database: await createSupabaseServerClient() },
    profile,
    { storagePath: parsed.data.path, originalFilename: parsed.data.filename },
  )

  // `exists` is a replayed finalize converging on the row it already made — to the
  // person, the upload simply succeeded (10A's idempotency, brief §6).
  if ('imageId' in result) {
    return { status: 'done', imageId: result.imageId }
  }

  return {
    status: result.status === 'failed' ? 'failed' : 'refused',
    message: result.message,
  }
}
