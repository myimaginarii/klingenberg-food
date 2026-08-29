import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests — technical plan §9.
 *
 * Everything runs against a **production build**, not the development server. The
 * public site's behaviour under `next build` is what a guest gets, and it is the only
 * build where the caching and revalidation described in §6 are real.
 *
 * Four projects, because the site makes four different promises:
 *
 *   * `desktop` — 1440 px, the width the approved frames 1g–1k are drawn at.
 *   * `mobile` — 375 px, the width 1l–1o are drawn at, and the one that carries the
 *     fullscreen menu and the persistent bottom bar.
 *   * `no-javascript` — the same site with scripting switched off. §7e (item 11) says
 *     the public site must fully work without it, so that is tested rather than hoped
 *     for.
 *   * `draft-publish` — the Kladde → Forhåndsvis → Offentliggør flow (§6). It is the
 *     only suite that writes to the database, so it runs **after** the three read-only
 *     projects (`dependencies`) and its own tests run in order. Nothing it changes can
 *     therefore be observed half-done by a spec that is reading the same page, and it
 *     restores the content it moves.
 *
 * `PLAYWRIGHT_BASE_URL` lets CI point the same suite at a deployed preview. Locally the
 * config builds and starts the site itself.
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
      testIgnore: ['e2e/no-javascript.spec.ts', 'e2e/draft-publish.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testIgnore: ['e2e/no-javascript.spec.ts', 'e2e/draft-publish.spec.ts'],
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
    {
      name: 'draft-publish',
      testMatch: 'e2e/draft-publish.spec.ts',
      dependencies: ['desktop', 'mobile', 'no-javascript'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
})
