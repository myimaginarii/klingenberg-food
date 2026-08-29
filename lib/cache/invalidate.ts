import 'server-only'

import { updateTag } from 'next/cache'

import type { CacheTag } from './tags'

/**
 * Expiring the public cache after a publish — technical plan §6.
 *
 * `updateTag()` rather than `revalidateTag()`, and deliberately:
 *
 *   * `updateTag(tag)` is the Next.js 16 API for read-your-own-writes. It expires the
 *     entry immediately, so the next request for an affected page waits for fresh data
 *     instead of being served the version that was live a second ago. A staff member
 *     who presses Offentliggør and then opens the public page must see what they just
 *     published — anything else looks like the publish failed.
 *   * `revalidateTag(tag, 'max')` would serve the stale page while refreshing behind
 *     it, which is the right trade for a webhook and the wrong one here.
 *   * The single-argument `revalidateTag(tag)` is deprecated in this version and warns
 *     at runtime. It is not used anywhere in this repository.
 *
 * `updateTag` may only be called from inside a Server Action; calling it from a Route
 * Handler throws. Phase 4 has no route handler that invalidates anything — the preview
 * routes only set and clear a cookie — so there is no second path to keep in step. If
 * one ever appears, `revalidateTag(tag, { expire: 0 })` is its equivalent.
 *
 * **Order matters and is the caller's responsibility.** This must run only after the
 * publish transaction has committed. Expiring a tag for a publish that then fails
 * would show visitors a "new" page that is identical to the old one and leave the
 * dashboard reporting an error — the cache would be telling a story the database does
 * not agree with. `lib/publishing/publish.ts` returns a result; the Server Action
 * calls this only for the entities whose result says `published`.
 */
export function expirePublicCacheTags(tags: Iterable<CacheTag>): void {
  // Deduplicated: publishing several entities at once commonly touches `contact` or
  // `menu` more than once, and expiring the same tag twice is pointless work.
  for (const tag of new Set(tags)) {
    updateTag(tag)
  }
}
