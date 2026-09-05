import type { NextConfig } from 'next'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'

import { PUBLIC_REVALIDATE_SECONDS } from './lib/cache/tags'
import { getServerActionAllowedOrigins } from './lib/config/site'
import { securityHeaders } from './lib/security/headers'
import { assertLaunchMapProvenance } from './lib/site/map-launch-guard'
import { optionalSupabaseOrigin } from './lib/supabase/config'

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
  /**
   * The security-header policy — technical plan §8, phase 13B (§0ai).
   *
   * One set for every response, public and administration alike, built by
   * `lib/security/headers.ts` and pinned by its unit test. It is attached here rather
   * than in `proxy.ts` because the proxy runs on `/admin` only and a header policy
   * that skipped the public site would be no policy; and because this is a static
   * policy — no nonce, no per-request value — so the public pages keep their
   * five-minute `s-maxage` caching untouched. `Cache-Control` is not set here and is
   * not affected: `headers()` adds to a response, it does not replace what the route
   * decided (`tests/e2e/security-headers.spec.ts` asserts the two together).
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders({
          production: process.env.NODE_ENV === 'production',
          supabaseOrigin: optionalSupabaseOrigin(),
        }),
      },
    ]
  },
  experimental: {
    serverActions: {
      // Derived from lib/config/site.ts — never a hard-coded domain (technical plan §8, §10d).
      allowedOrigins: getServerActionAllowedOrigins(),
    },
  },
}

/**
 * The launch map guard — technical plan §7g, §13 item C; phase 14A.
 *
 * Once per production build, never at request time: a **Vercel production**
 * build (`VERCEL_ENV=production`) is refused while `public/map/` still holds the
 * placeholder or its provenance record is incomplete. A local `next build`, CI
 * and every Vercel preview build pass with the placeholder — the guard reads the
 * platform's own environment signal and adds no variable of its own
 * (`lib/site/map-launch-guard.ts`).
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) assertLaunchMapProvenance()
  return nextConfig
}
