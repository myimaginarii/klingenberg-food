/**
 * Cache tags for the public site — technical plan §6.
 *
 * §6 names ten tags and this is the list, unchanged:
 *
 *     menu, weekly, monthly, news, announcement, hours, contact,
 *     page:home, page:takeaway, page:about
 *
 * Each one is attached to the cached read that produces it (`lib/content/*`), and a
 * page inherits the tags of every read it performs. Publishing expires the tags the
 * published entity affects, and the next request for any page that used one of them
 * re-renders. Nothing polls, and nothing on the public site knows that publishing
 * exists.
 *
 * WHICH CACHING MODEL, AND WHY
 *
 * Next.js 16 offers two. Cache Components (`cacheComponents: true` with `use cache`
 * and `cacheTag`) is the newer one and is not experimental — but enabling it is a
 * whole-application migration: it rejects the `export const revalidate` the public
 * layout uses for the five-minute safety net (§7a), and it fails the prerender on the
 * `new Date()` that the open/closed badge and the sold-out reset are computed from,
 * which would mean rebuilding the phase-3 public site around Suspense boundaries and
 * `connection()`. Phase 4 is not the place to rewrite phase 3.
 *
 * So the public reads stay on the model phase 3 already uses — route-segment
 * revalidation plus tagged data caching — which Next.js 16 documents as supported
 * alongside Cache Components ("Your existing fetch and unstable_cache caching keeps
 * working as a separate layer"). The Supabase reads are not `fetch` calls we control
 * the options of, so `unstable_cache` is the API that can tag them; its tags feed the
 * same invalidation machinery as `cacheTag`, which is why `updateTag()` below works
 * against them.
 *
 * Two properties of that choice are worth knowing:
 *
 *   * `unstable_cache` **bypasses itself in Draft Mode**. A preview therefore reads
 *     the database directly, and no draft can ever be written into a tagged entry.
 *     That is a guarantee of the API, not something this code arranges.
 *   * The tags a cached read collects become the tags of the page that rendered it,
 *     so expiring `menu` expires the menu page without anyone naming the route.
 *
 * Revisit when Cache Components migration is a phase of its own.
 */

export const CACHE_TAGS = {
  menu: 'menu',
  weekly: 'weekly',
  monthly: 'monthly',
  news: 'news',
  announcement: 'announcement',
  hours: 'hours',
  contact: 'contact',
  homePage: 'page:home',
  takeawayPage: 'page:takeaway',
  aboutPage: 'page:about',
} as const

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS]

/**
 * The five-minute safety net (§7a), as a number the cached reads can use.
 *
 * `app/(site)/layout.tsx` states the same interval as a route-segment `revalidate`,
 * which Next.js requires to be a literal, so the two cannot share one constant. They
 * are the same number for the same reason and are changed together.
 *
 * `next.config.ts` states it a third time, as `expireTime`, so that five minutes is
 * where a cached page **expires** rather than where it merely goes stale. The reasoning
 * is written out there; the short version is that anything longer is an invitation —
 * to Next.js's own response cache and to any shared cache in front of it — to answer a
 * request with a page older than five minutes, which is exactly what §6 and §7a promise
 * cannot happen.
 */
export const PUBLIC_REVALIDATE_SECONDS = 300
