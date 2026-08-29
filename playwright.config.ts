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
 *   * `draft-publish` — the Kladde → Forhåndsvis → Offentliggør flow (§6), and
 *   * `menu-admin` — the same flow through Rediger menu (phase 5B).
 *
 * The last two write to the database, so they run **after** the three read-only
 * projects (`dependencies`) and their own tests run in order. They are also two
 * separate projects, one depending on the other, rather than two files in one: both
 * publish, and publishing expires cache tags, so a `draft-publish` assertion that the
 * menu's cached page was *not* expired would be a coin toss if a menu publish could run
 * beside it. Each suite restores the content it moves.
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
      testIgnore: [
        'e2e/no-javascript.spec.ts',
        'e2e/draft-publish.spec.ts',
        'e2e/menu-admin.spec.ts',
        'e2e/menu-sold-out.spec.ts',
        'e2e/menu-delete.spec.ts',
        'e2e/menu-reorder.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testIgnore: [
        'e2e/no-javascript.spec.ts',
        'e2e/draft-publish.spec.ts',
        'e2e/menu-admin.spec.ts',
        'e2e/menu-sold-out.spec.ts',
        'e2e/menu-delete.spec.ts',
        'e2e/menu-reorder.spec.ts',
      ],
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
    {
      name: 'menu-admin',
      testMatch: 'e2e/menu-admin.spec.ts',
      dependencies: ['draft-publish'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * The immediate Udsolgt path (phase 5C), at both widths the design is drawn at.
     *
     * It is run twice rather than once because 1r and 1y are two arrangements of the
     * same control, not one control at two sizes — on a phone the editor replaces the
     * list, so "flip the switch inside the panel" is a different journey there. The two
     * runs are chained rather than parallel for the same reason the other write suites
     * are: both change a live dish and expire the `menu` cache tag, and a guest
     * assertion about that dish would be a coin toss if the other run could act between
     * the write and the read. Each run leaves Thor available.
     */
    {
      name: 'menu-sold-out',
      testMatch: 'e2e/menu-sold-out.spec.ts',
      dependencies: ['menu-admin'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'menu-sold-out-mobile',
      testMatch: 'e2e/menu-sold-out.spec.ts',
      dependencies: ['menu-sold-out'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    /*
     * Slet ret (phase 5D), at both widths, and chained after the sold-out runs for the
     * same reason those two are chained to each other: it deletes a dish the other
     * suites read, and it expires the `menu` cache tag while doing it. A guest assertion
     * about Odin would be a coin toss if another run could act between the write and the
     * read. Each run leaves every dish present and every draft as it found it.
     */
    {
      name: 'menu-delete',
      testMatch: 'e2e/menu-delete.spec.ts',
      dependencies: ['menu-sold-out-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'menu-delete-mobile',
      testMatch: 'e2e/menu-delete.spec.ts',
      dependencies: ['menu-delete'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    /*
     * Reordering (phase 5E), at both widths, and chained after the deletion runs for the
     * reason every write suite is chained: it publishes, publishing expires the `menu`
     * cache tag, and a guest assertion about the order of the burgers would be a coin
     * toss if another run could act between the write and the read.
     *
     * Two widths rather than one, because 1r and 1y arrange the same three controls
     * differently — on the phone the strip sits at the foot of the card with its words
     * showing, on the desktop it sits at the left of the row with the words carried for
     * a screen reader. The suite also drags with a pointer at 375 px, which is what a
     * finger produces once mouse-to-touch translation is out of the picture, and holds
     * the touch path itself to the same server round-trip. Each run leaves the section
     * in the seeded order, published, with nothing pending.
     */
    {
      name: 'menu-reorder',
      testMatch: 'e2e/menu-reorder.spec.ts',
      dependencies: ['menu-delete-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'menu-reorder-mobile',
      testMatch: 'e2e/menu-reorder.spec.ts',
      dependencies: ['menu-reorder'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        hasTouch: true,
      },
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
