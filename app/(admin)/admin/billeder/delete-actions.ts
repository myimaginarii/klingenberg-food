'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { enforceRateLimit } from '@/lib/rate-limit/actions'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { readImageStorageFacts } from '@/lib/content/images-admin'
import { deleteLibraryImage } from '@/lib/images/admin'
import { createImageStorage } from '@/lib/images/storage'
import { rowId } from '@/lib/schemas/primitives'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { IMAGES_FORM } from './image-form'
import { imagesHref } from './routes'

/**
 * Deleting an image — design 1w; phase 10B (brief §14–§16).
 *
 * The form submits three things: the image id, the version token the confirmation
 * was rendered from, and — when the rendered confirmation covered an in-use image —
 * the one confirmation bit. The storage paths are **not** among them: the
 * derivative paths are read from the row server-side before the call, and the
 * original's path comes back from `delete_image()` itself, so the browser cannot
 * name a file to delete (brief §16).
 *
 * The refusals are honest about the race the bit leaves open: a confirmation that
 * was rendered for an unused image can meet a row somebody has referenced in the
 * meantime. `delete_image()` then answers `in_use` — nothing deleted — and the
 * screen reopens the confirmation over the fresh usage list, so the person decides
 * about the image as it is, never as it was.
 */
/*
 * A confirmed delete takes the image off every public surface that rendered it
 * (phase 10C-2): the wrapper expires the tags of the live references
 * `delete_image()` itself reports having detached — after the commit, before the
 * files go — through the one invalidation door this action hands it (§20).
 */
export async function deleteImage(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  await enforceRateLimit('image:destructive', imagesHref({ status: RATE_LIMIT_STATUS }))

  const id = rowId('Billedet').safeParse(formData.get(IMAGES_FORM.imageId))
  const version = formData.get(IMAGES_FORM.version)

  if (!id.success || typeof version !== 'string' || version.length === 0) {
    redirect(imagesHref({ status: 'findes_ikke' }))
  }

  const confirmed = formData.get(IMAGES_FORM.confirmed) === '1'

  // The trusted derivation (brief §15): what files the row's own record names,
  // read through the caller's JWT before the transition runs.
  const facts = await readImageStorageFacts(id.data)
  if (facts === null) {
    redirect(imagesHref({ status: 'findes_ikke' }))
  }

  const supabase = await createSupabaseServerClient()
  const result = await deleteLibraryImage(
    supabase,
    createImageStorage(),
    profile,
    {
      imageId: id.data,
      expectedUpdatedAt: version,
      confirmed,
      derivativePaths: facts.derivativePaths,
    },
    { expireTags: expirePublicCacheTags },
  )

  switch (result.status) {
    case 'deleted':
      redirect(imagesHref({ status: 'slettet' }))
      break
    case 'in_use':
      // Rendered for an unused image, met a used one: reopen the confirmation over
      // the fresh usage list. Nothing was deleted.
      redirect(imagesHref({ image: id.data, confirmDelete: id.data, status: 'i_brug' }))
      break
    case 'owner_only':
      // The Forside names the image, and this caller is not the owner (§5, phase
      // 11A). Nothing was deleted, and the sentence says who can.
      redirect(imagesHref({ image: id.data, status: 'kun_ejer' }))
      break
    case 'conflict':
      redirect(imagesHref({ image: id.data, status: 'konflikt' }))
      break
    case 'not_found':
      redirect(imagesHref({ status: 'findes_ikke' }))
      break
    case 'forbidden':
      redirect(imagesHref({ image: id.data, status: 'afvist' }))
      break
    case 'failed':
      redirect(imagesHref({ image: id.data, status: 'fejl' }))
  }
}
