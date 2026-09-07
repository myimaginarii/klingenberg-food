import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests — technical plan §9.
 *
 * Everything runs against the **static export**, served by `scripts/serve-static.mjs`
 * from `out/` — the same files, served the same way, as the deployed site. There is no
 * Next.js server in the loop, because the deployment does not have one either.
 *
 * Three projects, because the site makes three different promises:
 *
 *   * `desktop` — 1440 px, the width the approved frames 1g–1k are drawn at.
 *   * `mobile` — 375 px, the width 1l–1o are drawn at, and the one that carries the
 *     fullscreen menu and the persistent bottom bar.
 *   * `no-javascript` — the same site with scripting switched off. §7e (item 11) says
 *     the public site must fully work without it, so that is tested rather than hoped
 *     for.
 *
 * Nothing writes: the site is prerendered from tracked content, so every suite is a
 * reader and all three run in parallel with no ordering between them.
 *
 * `PLAYWRIGHT_BASE_URL` lets CI point the same suite at a deployed preview. Locally the
 * config builds the site and serves it itself.
 */
const PORT = 3100
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e/**/*.spec.ts', 'a11y/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    // Danish is the site's only language; the browser should ask for it.
    locale: 'da-DK',
    timezoneId: 'Europe/Copenhagen',
  },

  projects: [
    {
      name: 'desktop',
      testIgnore: ['e2e/no-javascript.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testIgnore: ['e2e/no-javascript.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'no-javascript',
      testMatch: 'e2e/no-javascript.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        javaScriptEnabled: false,
        // Reduced motion turns the site's smooth scrolling into an instant jump, which
        // is what makes a click on a control below the fold deterministic here. It is
        // also a mode the site genuinely supports (1aa), so this pass covers both.
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run build && node scripts/serve-static.mjs --port ${PORT}`,
        url: baseURL,
        /*
          The export bakes its own absolute addresses in — canonical URLs, `og:url`, the
          sitemap, the JSON-LD (`lib/config/site.ts`, §10d) — so the build has to be told
          where this run will serve it from. Without this the suite would test a site
          that believes it lives at :3000 while answering on :3100, and
          `tests/e2e/seo-metadata.spec.ts` would be asserting against a mismatch rather
          than against the deployment's behaviour. A CI run against a deployed preview
          sets `PLAYWRIGHT_BASE_URL` and has no webServer at all; that build was given
          its own address by whatever produced it.
        */
        env: { SITE_URL: baseURL },
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
})
