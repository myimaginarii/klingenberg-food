import type { NextConfig } from 'next'

import { PUBLIC_REVALIDATE_SECONDS } from './lib/cache/tags'
import { getServerActionAllowedOrigins } from './lib/config/site'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The framework version is not a secret, but it is also not useful to advertise.
  poweredByHeader: false,
  // Fail the production build on a type error rather than shipping it.
  // (Next 16 no longer runs ESLint during `next build`; CI runs `npm run lint`.)
  typescript: { ignoreBuildErrors: false },
  /**
   * When a cached public page **expires** — technical plan §6, §7a.
   *
   * Without this, Next.js pairs the route's five-minute `revalidate` with its default
   * `expireTime` of one year, and a cached page therefore has two ages: it goes *stale*
   * after five minutes and does not *expire* for a year. Everything between those two
   * points is stale-while-revalidate, and stale-while-revalidate means "answer with the
   * copy you have, then fetch a new one" — which breaks both promises this application
   * makes about its public pages:
   *
   *   * **§6 — publishing shows on the next request.** The origin keeps that promise:
   *     `updateTag()` expires the tags, and the next request for an affected page is a
   *     cache miss that renders fresh (measured: with the `/menu` entry deliberately
   *     aged past five minutes, the first guest request after Offentliggør is a MISS
   *     carrying the new price). But the origin cannot expire a cached copy held by
   *     somebody else, and `stale-while-revalidate=31535700` is this site telling every
   *     shared cache and CDN in front of it that a page up to a **year** old may be
   *     served while a fresh one is fetched behind it. Through such a cache the first
   *     request after a publish gets the old page and the second gets the new one —
   *     the publish contract, broken by the header rather than by the invalidation.
   *   * **§7a — nothing a guest reads is more than five minutes out of date.** Next's
   *     own response cache honours the same figure, so a page nobody has asked for in an
   *     hour is served to the next visitor as it was rendered an hour ago (measured:
   *     `x-nextjs-cache: STALE` on an entry 310 s old). The open/closed badge, the
   *     Udsolgt reset and the Månedens burger window are all computed at render time, so
   *     that visitor reads an hour-old answer to a question about *now*.
   *
   * Setting `expireTime` to the same five minutes removes the second age. A cached page
   * is fresh for five minutes and expired after them: Next.js re-renders before
   * answering rather than after, and the `Cache-Control` it sends is a plain
   * `s-maxage=300` that authorises no shared cache to serve anything older. Caching is
   * unchanged for the five minutes it is meant to cover, and no route becomes dynamic.
   *
   * The cost is one blocking render for the first visitor after a quiet five minutes,
   * which is the price of the two promises above and is what §7a already describes.
   */
  expireTime: PUBLIC_REVALIDATE_SECONDS,
  experimental: {
    serverActions: {
      // Derived from lib/config/site.ts — never a hard-coded domain (technical plan §8, §10d).
      allowedOrigins: getServerActionAllowedOrigins(),
    },
  },
}

export default nextConfig
