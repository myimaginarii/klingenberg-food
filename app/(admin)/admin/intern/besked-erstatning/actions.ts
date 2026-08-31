'use server'

import { notFound, redirect } from 'next/navigation'

import {
  replaceAnnouncement,
  restoreAnnouncement,
} from '@/lib/announcements/replacement'
import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'

import {
  HARNESS_FORM,
  HARNESS_PATH,
  harnessEnabled,
  harnessReplacement,
  isHarnessVariant,
} from './harness'

/**
 * The two Server Actions phase 8C-1's integration proof needs — see `./harness.ts` for
 * why they exist here and not in the administration, and for when they are deleted.
 *
 * They are written the way 8C-3's real actions will be written, because the ordering is
 * the thing under test:
 *
 *   1. establish who is asking          — requireStaff()
 *   2. refuse unless the harness is on   — notFound()
 *   3. read a closed intent              — a variant key and a version token
 *   4. perform the transaction           — lib/announcements/replacement.ts
 *   5. expire the public cache tag       — **only after** a result that reached the row
 *   6. report                            — a redirect back to this address
 *
 * Step 5 is the whole point. `expirePublicCacheTags` calls `updateTag()`, which expires
 * the entry immediately rather than serving a stale copy behind a background refresh —
 * so the **first** guest request after the commit carries the new state. Expiring it for
 * a refusal, a conflict or an `invalid_payload` would rebuild the public pages into
 * exactly what they already were while the screen reported an error, which is the cache
 * telling a story the database does not agree with.
 */

function refuseUnlessEnabled(): void {
  if (!harnessEnabled()) notFound()
}

export async function harnessReplace(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  refuseUnlessEnabled()

  const variant = formData.get(HARNESS_FORM.variant)
  const version = formData.get(HARNESS_FORM.version)

  if (!isHarnessVariant(variant) || typeof version !== 'string') {
    redirect(`${HARNESS_PATH}?status=ugyldig`)
  }

  const result = await replaceAnnouncement(profile, {
    // Composed on the server from the closed variant key. The browser sent a name.
    replacement: harnessReplacement(variant),
    expectedUpdatedAt: version,
  })

  if (result.status !== 'replaced') {
    redirect(`${HARNESS_PATH}?status=${result.status}`)
  }

  // Committed. Only now may the public site be told.
  expirePublicCacheTags(result.cacheTags)

  redirect(`${HARNESS_PATH}?status=replaced&replaced=${result.replaced ?? 'ukendt'}`)
}

export async function harnessRestore(formData: FormData): Promise<void> {
  const profile = await requireStaff()
  refuseUnlessEnabled()

  const version = formData.get(HARNESS_FORM.version)

  if (typeof version !== 'string') redirect(`${HARNESS_PATH}?status=ugyldig`)

  const result = await restoreAnnouncement(profile, { expectedUpdatedAt: version })

  if (result.status !== 'restored') {
    redirect(`${HARNESS_PATH}?status=${result.status}`)
  }

  expirePublicCacheTags(result.cacheTags)

  redirect(
    `${HARNESS_PATH}?status=restored&showable=${result.showable === true ? '1' : '0'}`,
  )
}
