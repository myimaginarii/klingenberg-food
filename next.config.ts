import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * The site is a static export.
   *
   * `next build` writes every public page, the designed 404 and the sitemap as plain
   * files under `out/`, rendered from the tracked content in `content/site/`. There is
   * no server behind the site, no database, no route handler and no Server Action —
   * `out/` is the whole deployable artefact, and any static host serves it.
   *
   * This was conditional on a `STATIC_EXPORT` flag while the retired administration was
   * still in the tree: its route handlers, Server Actions and cookie-reading pages are
   * exactly what the framework refuses to export. They are gone, so the export is the
   * only build there is.
   */
  output: 'export',
  /**
   * Each page is a directory with an `index.html` (`/menu/`), which is what a static
   * host serves for a folder and what every link, canonical URL and sitemap entry
   * renders as (`lib/seo/sitemap.ts`).
   */
  trailingSlash: true,
  reactStrictMode: true,
  // The framework version is not a secret, but it is also not useful to advertise.
  poweredByHeader: false,
  // Fail the production build on a type error rather than shipping it.
  // (Next 16 no longer runs ESLint during `next build`; CI runs `npm run lint`.)
  typescript: { ignoreBuildErrors: false },
  /**
   * Response headers are the host's to send.
   *
   * `headers()` is a server feature and does nothing in an export, so the security
   * headers this application used to attach here (§8) now belong to whatever serves
   * `out/`. They are stated in the deployment's own configuration rather than pretended
   * at here — a `headers()` block in a static build would be a policy that never
   * reaches a browser.
   */
}

export default nextConfig
