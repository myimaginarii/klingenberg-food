/**
 * Site URL resolution — technical plan §10d.
 *
 * This module is the ONLY place in the repository where an absolute site origin may
 * be produced. Canonical URLs, the sitemap, robots.txt, Open Graph URLs, JSON-LD `url`
 * and `serverActions.allowedOrigins` all resolve through here.
 *
 * `scripts/check-source-policy.mjs` fails CI if a domain literal appears anywhere else.
 *
 * The restaurant's final domain is deliberately not known yet. Choosing it later is a
 * configuration change (set `SITE_URL`), never a code change.
 *
 * Resolution order:
 *   1. SITE_URL                        — explicit, wins everywhere once set
 *   2. VERCEL_PROJECT_PRODUCTION_URL   — the project's production host, on any Vercel env
 *   3. VERCEL_URL                      — this specific deployment (preview builds)
 *   4. http://localhost:3000           — local development
 */

const LOCAL_ORIGIN = 'http://localhost:3000'

/**
 * Accepts either a full URL (`https://example.test`) or a bare host as Vercel supplies
 * it (`example.test`), and returns a normalised origin with no trailing slash.
 * Returns `null` for anything unusable so the next candidate is tried.
 */
function toOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url.origin
  } catch {
    return null
  }
}

/** The absolute origin of this site, without a trailing slash. */
export function getSiteUrl(): string {
  return (
    toOrigin(process.env.SITE_URL) ??
    toOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    toOrigin(process.env.VERCEL_URL) ??
    LOCAL_ORIGIN
  )
}

/** Build an absolute URL for a site-relative path. `absoluteUrl('/menu')`. */
export function absoluteUrl(path = '/'): string {
  return new URL(path, `${getSiteUrl()}/`).toString()
}

/** `URL` form of {@link getSiteUrl}, for `metadataBase`. */
export function getSiteUrlObject(): URL {
  return new URL(getSiteUrl())
}

/**
 * Hosts permitted to invoke Server Actions (technical plan §8 — CSRF).
 *
 * Next.js already trusts the host the request arrived on; this adds the production
 * host so an action initiated from a preview deployment against the production
 * origin is not rejected. Deduplicated, and never a literal.
 */
export function getServerActionAllowedOrigins(): string[] {
  const origins = [
    getSiteUrl(),
    toOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    toOrigin(process.env.VERCEL_URL),
  ]

  const hosts = origins
    .filter((origin): origin is string => origin !== null)
    .map((origin) => new URL(origin).host)

  return [...new Set(hosts)]
}

/** True when running against the local development origin. */
export function isLocalSiteUrl(): boolean {
  return getSiteUrl() === LOCAL_ORIGIN
}

/**
 * True when this process is a deployment on Vercel — production or preview.
 *
 * The one deployment signal the repository recognises. Vercel sets `VERCEL=1` on
 * every build and function it runs; a local `next build && next start` never has
 * it, whatever `NODE_ENV` says. The sign-in throttle believes the platform's address
 * headers only here (`lib/rate-limit/subject.ts`), and for the same reason requires
 * its secret only here (`lib/env/server.ts`): this is where client-derived subjects
 * exist at all.
 */
export function isVercelDeployment(): boolean {
  return process.env.VERCEL === '1'
}
