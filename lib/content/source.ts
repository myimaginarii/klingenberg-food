import 'server-only'

import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { PUBLIC_REVALIDATE_SECONDS, type CacheTag } from '@/lib/cache/tags'
import { isPreviewingDrafts } from '@/lib/drafts/preview'
import { createSupabasePublicClient, createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * The read layer's single connection to the database — technical plan §2, §6, §8.
 *
 * Every public page reads through this module and no page, layout or component ever
 * builds a Supabase client of its own. That is what keeps three properties true by
 * construction rather than by discipline:
 *
 *  * the public half sets **no cookies at all** (§12) — the published path uses a
 *    client that neither reads nor writes them, so no session can be acquired on a
 *    public request;
 *  * the public half can only ever **read published rows** — the anon key's authority
 *    is exactly the RLS `SELECT` policies, and no `INSERT`, `UPDATE` or `DELETE`
 *    policy exists for `anon` on any table (§8);
 *  * **drafts and published content never share a cache entry** — the two paths are
 *    different clients, and only one of them is cached at all.
 *
 * `import 'server-only'` makes reaching any of this from a Client Component a build
 * error, so the read layer cannot drift into the browser.
 *
 * ---------------------------------------------------------------------------------
 * THE TWO PATHS
 * ---------------------------------------------------------------------------------
 *
 * A public request takes the **published path**: the anonymous client, live columns
 * only, through a tagged cache entry that publishing expires (§6) and that the
 * five-minute safety net refreshes anyway (§7a).
 *
 * A staff member in Draft Mode takes the **preview path**: their own JWT, the `draft`
 * column included, and no caching at all. `unstable_cache` bypasses itself while Draft
 * Mode is on, so a draft cannot be written into a shared entry even by accident — but
 * the two paths are separated here as well, because a guarantee that rests on one
 * framework behaviour is a guarantee with one point of failure.
 *
 * Whether a request may take the preview path is decided in `lib/drafts/preview.ts`
 * and nowhere else: the bypass cookie alone is not enough, an active staff session is
 * also required.
 */

/** Which database connection a query runs on, and whether it may see drafts. */
export type ContentAccess = {
  readonly database: SupabaseClient
  readonly includeDrafts: boolean
}

/** The anonymous, cookie-free client the public site reads through. */
function publishedAccess(): ContentAccess {
  return { database: createSupabasePublicClient(), includeDrafts: false }
}

/** The staff member's own client, carrying their JWT so RLS still applies. */
async function previewAccess(): Promise<ContentAccess> {
  return { database: await createSupabaseServerClient(), includeDrafts: true }
}

/**
 * Define a public read: cached and tagged for visitors, uncached and draft-aware for
 * a staff preview.
 *
 * Every loader in this folder is built with this, so the branch between the two paths
 * is written once. Three layers of caching, each doing a different job:
 *
 *   * `unstable_cache` — the cross-request cache the tags belong to. A page inherits
 *     the tags of every cached read it performs, so expiring `menu` expires the menu
 *     page without any route being named anywhere (§6).
 *   * `revalidate` — the five-minute safety net, so time-dependent content corrects
 *     itself even if nobody publishes anything (§7a).
 *   * React's `cache` — deduplication within one render pass, so the layout and the
 *     page beneath it share one query rather than issuing two.
 *
 * The arguments a loader takes become part of the cache key, which is why they must
 * stay small and serialisable — a page key, a slug, a count.
 */
export function definePublicRead<Args extends readonly (string | number)[], Result>(
  cacheKey: string,
  tags: readonly CacheTag[],
  query: (access: ContentAccess, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  const readPublished = unstable_cache(
    (...args: Args) => query(publishedAccess(), ...args),
    [cacheKey],
    { tags: [...tags], revalidate: PUBLIC_REVALIDATE_SECONDS },
  )

  return cache(async (...args: Args): Promise<Result> => {
    if (await isPreviewingDrafts()) {
      return query(await previewAccess(), ...args)
    }

    return readPublished(...args)
  })
}

/**
 * The column list for a query, with `draft` added on the preview path.
 *
 * `draft` is not among the columns granted to `anon` at all (§8), so naming it on the
 * published path would not merely read something it should not — it would fail the
 * query outright. Keeping the two lists in one expression is what stops the preview
 * path and the public path from drifting apart column by column.
 */
export function columns(access: ContentAccess, live: string): string {
  return access.includeDrafts ? `${live}, draft` : live
}

/**
 * Fail loudly on a query error, naming the read but never echoing a credential (§8).
 *
 * A public page that silently rendered an empty menu because the database was
 * unreachable would look like a content problem and be debugged as one. It is better
 * for the error boundary to show the designed error state.
 */
export function assertNoQueryError(what: string, error: PostgrestError | null): void {
  if (error === null) return
  throw new Error(`Could not read ${what} from the database: ${error.message}`)
}
