/**
 * Site URL resolution — technical plan §10d.
 *
 * This module is the ONLY place in the repository where an absolute site origin may be
 * produced. Canonical URLs, the sitemap, Open Graph URLs and JSON-LD `url` all resolve
 * through here.
 *
 * `scripts/check-source-policy.mjs` fails CI if a domain literal appears anywhere else.
 *
 * The restaurant's final domain is deliberately not known yet. Choosing it later is a
 * build-time configuration change (set `SITE_URL`), never a code change — the static
 * export bakes whatever this resolves to into the absolute URLs it prints.
 *
 * Resolution order:
 *   1. SITE_URL                — explicit, set by whatever builds the site
 *   2. http://localhost:3000   — local development, and any build that sets nothing
 */

const LOCAL_ORIGIN = 'http://localhost:3000'

/**
 * Accepts either a full URL (`https://example.test`) or a bare host (`example.test`),
 * and returns a normalised origin with no trailing slash. Returns `null` for anything
 * unusable, so the fallback is used instead.
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
  return toOrigin(process.env.SITE_URL) ?? LOCAL_ORIGIN
}

/**
 * Build an absolute URL for a site-relative path — `absoluteUrl('/menu/')`.
 *
 * The caller supplies the path exactly as the site serves it. `trailingSlash` is on,
 * so every page is a directory (`/menu/`); `lib/seo/sitemap.ts` is where that shape is
 * stated once, and this function does not add or remove one.
 */
export function absoluteUrl(path = '/'): string {
  return new URL(path, `${getSiteUrl()}/`).toString()
}

/** `URL` form of {@link getSiteUrl}, for `metadataBase`. */
export function getSiteUrlObject(): URL {
  return new URL(getSiteUrl())
}
