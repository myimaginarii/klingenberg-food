'use server'

import { z } from 'zod'

import { requireStaff } from '@/lib/auth/guards'
import { readImageStorageFacts } from '@/lib/content/images-admin'
import { replaceLibraryImage } from '@/lib/images/admin'
import { createImageStorage } from '@/lib/images/storage'
import type { UploadReplaceReply } from '@/lib/images/upload-flow'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Completing a replacement — design 1w's "Erstat"; phase 10B (brief §17).
 *
 * Called programmatically by the uploader once the NEW image has finalized —
 * upload first, transition second, old-file cleanup last, which is the ordering
 * the brief requires: the current image is never destroyed in the hope that a
 * replacement will succeed.
 *
 * The browser says three things: which image is being replaced, the version token
 * its panel was rendered from, and the id `finalizeUpload` just answered with. The
 * new id is not authority — `replace_image()` verifies it names a finished library
 * row, and a caller pointing at some other existing image performs a repointing
 * their own staff privileges already allow. The strict shape refuses everything
 * else.
 */

const replaceSchema = z.strictObject({
  oldId: z.uuid(),
  /** The version token the replace panel was rendered from (§6). */
  oldVersion: z.string().min(1).max(64),
  /** The id `finalizeUpload` answered with for the new image. */
  newId: z.uuid(),
})

export async function replaceUploadedImage(input: unknown): Promise<UploadReplaceReply> {
  const profile = await requireStaff()

  const parsed = replaceSchema.safeParse(input)
  if (!parsed.success) return { status: 'failed' }

  // The OLD image's derivative paths, derived server-side before the transition —
  // after it commits the row is gone and nothing could name them (brief §15).
  const facts = await readImageStorageFacts(parsed.data.oldId)
  if (facts === null) return { status: 'not_found' }

  const supabase = await createSupabaseServerClient()

  return replaceLibraryImage(supabase, createImageStorage(), profile, {
    oldImageId: parsed.data.oldId,
    expectedUpdatedAt: parsed.data.oldVersion,
    newImageId: parsed.data.newId,
    derivativePaths: facts.derivativePaths,
  })
}
