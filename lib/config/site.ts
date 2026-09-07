/**
 * Site URL resolution — technical plan §10d.
 *
 * This module is the ONLY place in the repository where an absolute site origin, or
 * the sub-path the site is deployed under, may be produced. Canonical URLs, the
 * sitemap, Open Graph URLs, JSON-LD `url`, `next.config.ts`'s `basePath` and every
 * static asset reference all resolve through here.
 *
 * `scripts/check-source-policy.mjs` fails CI if a domain literal appears anywhere else.
 *
 * ONE VARIABLE, WHEN ANYBODY SETS ONE. `SITE_URL` states the full public address of the
 * deployment — origin *and* sub-path — and everything else is derived from it:
 *
 *   SITE_URL=https://example.test            -> origin https://example.test, no base path
 *   SITE_URL=https://example.test/a-project/ -> origin https://example.test, base path /a-project
 *
 * The sub-path is what a GitHub Pages *project* site needs (`/<repository>/`), and a
 * custom domain later is the same variable with the path left off. Neither is a code
 * change — the static export bakes whatever this resolves to into the HTML it writes.
 *
 * A HOST THAT ALREADY KNOWS ITS OWN ADDRESS DOES NOT NEED THE VARIABLE. Netlify states
 * the address of every deploy in its own read-only variables, so a Netlify build sets
 * nothing and {@link netlifyAddress} reads what the platform already published. That is
 * the difference between the two deployments this repository can serve from: the GitHub
 * Pages workflow has to be *told* its address (`actions/configure-pages` reports it, and
 * the workflow hands it over as `SITE_URL`), and Netlify simply has one.
 *
 * Resolution order:
 *   1. SITE_URL                — explicit, set by whatever builds the site
 *   2. Netlify's own variables — on a Netlify builder, and nowhere else
 *   3. http://localhost:3000   — local development, and any build that sets nothing
 *
 * BUILD TIME ONLY. None of these is a `NEXT_PUBLIC_` variable, so they are readable
 * while the export is being rendered and not in the browser. Every caller here is a
 * Server Component, a metadata export or the config itself, which is the whole of the
 * site (`tests/unit/policy/public-javascript.test.ts` pins the five Client Components,
 * and none of them is one). A Client Component must not call into this module: it would
 * read `undefined` after hydration and disagree with the HTML it was given.
 */

const LOCAL_ORIGIN = 'http://localhost:3000'

/** An origin, and the sub-path the site is served under (`''` at the root of a host). */
type SiteAddress = {
  readonly origin: string
  readonly basePath: string
}

const LOCAL_ADDRESS: SiteAddress = { origin: LOCAL_ORIGIN, basePath: '' }

/**
 * A URL's path as a prefix: a leading slash, no trailing slash, and `''` for the root
 * — which is exactly the shape Next.js's `basePath` wants.
 */
function toBasePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' || trimmed === '/' ? '' : trimmed
}

/**
 * Accepts either a full URL (`https://example.test/a-project/`) or a bare host
 * (`example.test`), and returns its origin and base path. Returns `null` for anything
 * unusable, so the fallback is used instead.
 */
function toAddress(value: string | undefined): SiteAddress | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return { origin: url.origin, basePath: toBasePath(url.pathname) }
  } catch {
    return null
  }
}

/**
 * The address Netlify states about the deploy being built, or `undefined` anywhere else.
 *
 * Netlify sets a documented set of read-only variables on every build, two of which are
 * the address the deploy will answer on:
 *
 *   * `URL`              — the site's **main** address. A `<site>.netlify.app` subdomain
 *                          until a custom domain is assigned to the project, and the
 *                          custom domain itself afterwards, with no change here and no
 *                          change to the build.
 *   * `DEPLOY_PRIME_URL` — the address of *this* deploy, or of the group it belongs to:
 *                          `https://deploy-preview-7--<site>.netlify.app` for a pull
 *                          request, `https://<branch>--<site>.netlify.app` for a branch
 *                          deploy. On a production deploy it is the main address again.
 *
 * A production build prints `URL`, so the canonical URLs, the sitemap and the Open Graph
 * URLs name the address the public actually visits. Every other context prints its own
 * `DEPLOY_PRIME_URL`, so a Deploy Preview's absolute URLs point *at that preview* rather
 * than claiming to be production — which is what makes a preview safe to open, share and
 * click through.
 *
 * `NETLIFY` is the gate, and it is why `URL` — a name generic enough that some other
 * environment might set it for something else entirely — is never read outside a Netlify
 * builder. Netlify documents `NETLIFY` as always set on its own builds and nowhere else.
 *
 * NO SUB-PATH. A Netlify site is served at the root of its host, so both variables carry
 * an empty path, {@link getBasePath} resolves to `''`, and every link, asset and router
 * prefetch is written from the root. This is the difference from the GitHub Pages
 * *project* site, which is served under `/<repository>/`; nothing here decides that, the
 * address does.
 */
function netlifyAddress(): string | undefined {
  const netlify = process.env.NETLIFY
  if (netlify !== 'true' && netlify !== '1') return undefined

  const { URL: main, DEPLOY_PRIME_URL: deploy } = process.env
  const preferred = process.env.CONTEXT === 'production' ? [main, deploy] : [deploy, main]
  return preferred.find((value) => value?.trim())
}

/** The configured deployment address. */
function address(): SiteAddress {
  return toAddress(process.env.SITE_URL) ?? toAddress(netlifyAddress()) ?? LOCAL_ADDRESS
}

/**
 * The sub-path the site is served under — `/klingenberg-food` on a GitHub Pages
 * project site, `''` at the root of a host.
 *
 * `next.config.ts` reads this for `basePath`, which is what makes `next/link`, the
 * router's prefetches, `_next/` assets and the file-based metadata (`app/icon.svg`)
 * carry the prefix by themselves. {@link assetPath} is for the paths the framework
 * does not rewrite: a plain `<img src>` into `public/`.
 */
export function getBasePath(): string {
  return address().basePath
}

/** The absolute address of this site, including any sub-path, without a trailing slash. */
export function getSiteUrl(): string {
  const { origin, basePath } = address()
  return `${origin}${basePath}`
}

/**
 * A site-relative path as the browser must request it — the base path in front of a
 * path this repository writes as if the site were at the root of a host.
 *
 * `assetPath('/media/home-hero/960.webp')` -> `/klingenberg-food/media/home-hero/960.webp`
 */
export function assetPath(path: string): string {
  return `${getBasePath()}${path}`
}

/**
 * Build an absolute URL for a site-relative path — `absoluteUrl('/menu/')`.
 *
 * The caller supplies the path exactly as this repository writes it, with no base
 * path; the deployment's own sub-path is added here. `trailingSlash` is on, so every
 * page is a directory (`/menu/`); `lib/seo/sitemap.ts` is where that shape is stated
 * once, and this function does not add or remove one.
 */
export function absoluteUrl(path = '/'): string {
  const { origin } = address()
  return new URL(assetPath(path), `${origin}/`).toString()
}

/**
 * The absolute form of a path that **already carries the deployment's base path** — an
 * asset URL as `assetPath()` produced it, such as the ones `lib/images/public.ts` writes
 * into a `srcset`.
 *
 * The difference from {@link absoluteUrl} is which end of the path the caller holds.
 * `absoluteUrl('/menu/')` is given a path this repository writes as if the site were at
 * the root of a host, and adds the sub-path; this is given a path a browser can already
 * request, and only puts the origin in front of it. Prefixing twice
 * (`/klingenberg-food/klingenberg-food/media/…`) is exactly the bug this exists to
 * avoid.
 *
 * JSON-LD is the caller: unlike Next.js's metadata, which resolves a relative image URL
 * against `metadataBase` by itself, a `<script type="application/ld+json">` block is
 * plain text that has to state absolute URLs of its own.
 */
export function absoluteAssetUrl(assetUrlPath: string): string {
  const { origin } = address()
  return new URL(assetUrlPath, `${origin}/`).toString()
}

/** `URL` form of {@link getSiteUrl}, for `metadataBase`. */
export function getSiteUrlObject(): URL {
  return new URL(absoluteUrl('/'))
}
