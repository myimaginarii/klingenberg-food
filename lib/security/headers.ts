/**
 * The production HTTP security-header policy — technical plan §8, §15 (phase 13B),
 * §0ai.
 *
 * One pure function builds the whole set, `next.config.ts` attaches it to every
 * response, and `tests/unit/security/headers.test.ts` pins each directive. Nothing
 * here reads a request: the policy is the same for a guest and for the
 * administration, because both must resist framing, MIME sniffing and injected
 * scripts, and neither needs a capability the other must be denied. Draft Mode is a
 * cookie, not an origin, and is unaffected.
 *
 * EVERY DIRECTIVE HAS A MEASURED REASON (brief §24, §31–§34)
 *
 * The production HTML was inspected before anything was written (§0ai records the
 * numbers): every page carries a couple of dozen inline `<script>` elements — the
 * React Server Components payload the framework streams into the document — and
 * **no** inline `<style>` and **no** `style=""` attribute. Fonts are self-hosted by
 * `next/font`; images come from this origin and from the Supabase Storage origin;
 * the one browser request that leaves the page is the uploader's PUT to a signed
 * Storage URL; the directions link and the Facebook page are links, not resources.
 *
 * The one resource this origin does embed from elsewhere is the Google Maps frame
 * that replaced the static map image (§7g, phase 14B3): `frame-src` therefore names
 * `https://www.google.com` — nothing else changes, because the iframe is a separate
 * browsing context with Google's own policy, not a resource this page's `img-src` or
 * `connect-src` needs to widen.
 *
 * So the script policy is `'self' 'unsafe-inline'`, and the reason is the caching
 * architecture, not convenience: a nonce needs a fresh value per response, which
 * needs dynamic rendering, which would turn the public site's five-minute
 * `s-maxage=300` pages into per-request renders and break the §6/§7a promises the
 * `expireTime` configuration exists to keep. The framework's own guide states the
 * trade-off in the same words. What `'unsafe-inline'` costs is the CSP's protection
 * against an injected inline script — and this site has no HTML injection surface to
 * protect: no `dangerouslySetInnerHTML`, no HTML parsing, structured news bodies, and
 * every string rendered by React (§8). The header remains a strong second layer for
 * everything else: no script from any other origin, no `eval`, no object, no frame,
 * no form posting elsewhere, no `<base>` hijack.
 *
 * `'unsafe-eval'` is a development-only concession: React uses `eval` there to
 * rebuild server error stacks in the browser, and not in production (the framework
 * documents this; the unit test pins that production never carries it).
 *
 * `upgrade-insecure-requests` is deliberately absent. Production is HTTPS end to end
 * (Vercel, Supabase) and HSTS covers the rest; locally the site runs over plain
 * HTTP against a plain-HTTP Supabase, and the directive would rewrite those image
 * URLs to `https:` and break every photograph in development.
 */

export type SecurityHeaderInput = {
  /** A production build (`next build`): no development-only concessions, HSTS on. */
  readonly production: boolean
  /** The Supabase origin, for the public derivatives and the uploader's PUT. */
  readonly supabaseOrigin: string | null
}

export type ResponseHeader = { readonly key: string; readonly value: string }

/** Two years, the value HSTS preload lists require — without `preload` itself (brief §26). */
export const HSTS_MAX_AGE_SECONDS = 63_072_000

/**
 * Browser capabilities the restaurant site never uses, switched off for every
 * origin including our own. The photograph uploader is a file input, which the
 * operating system's picker serves — including a phone's camera — without the
 * `camera` permission, so nothing here touches it (verified in the phone stories).
 */
export const DISABLED_PERMISSIONS = [
  'camera',
  'microphone',
  'geolocation',
  'payment',
  'usb',
  'browsing-topics',
] as const

export function contentSecurityPolicy(input: SecurityHeaderInput): string {
  const supabase = input.supabaseOrigin === null ? [] : [input.supabaseOrigin]

  const directives: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'unsafe-inline'", ...(input.production ? [] : ["'unsafe-eval'"])]],
    ['style-src', ["'self'", ...(input.production ? [] : ["'unsafe-inline'"])]],
    ['img-src', ["'self'", ...supabase]],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", ...supabase]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['frame-src', ["'self'", 'https://www.google.com']],
  ]

  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ')
}

export function permissionsPolicy(): string {
  return DISABLED_PERMISSIONS.map((feature) => `${feature}=()`).join(', ')
}

/**
 * The full set, in the order they are sent.
 *
 * `X-Frame-Options: DENY` duplicates `frame-ancestors 'none'` for the browsers that
 * predate it; the two agree and can only be changed together.
 *
 * HSTS is sent by production builds only. A browser ignores it over plain HTTP, so
 * the local `next start` on port 3100 is unaffected, and the tests can still assert
 * it against the built site. `includeSubDomains` is left off until the domain and
 * its subdomains are decided at launch (§13 item D), and `preload` is not offered:
 * submitting to the preload list is a one-way decision for the owner, not for a
 * phase.
 */
export function securityHeaders(input: SecurityHeaderInput): ResponseHeader[] {
  const headers: ResponseHeader[] = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(input) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: permissionsPolicy() },
    { key: 'X-Frame-Options', value: 'DENY' },
  ]

  if (input.production) {
    headers.push({ key: 'Strict-Transport-Security', value: `max-age=${HSTS_MAX_AGE_SECONDS}` })
  }

  return headers
}
