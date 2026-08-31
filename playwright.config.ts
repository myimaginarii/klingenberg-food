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
        'e2e/menu-tapas.spec.ts',
        'e2e/weekly-special.spec.ts',
        'e2e/monthly-burger.spec.ts',
        'e2e/announcement.spec.ts',
        'e2e/announcement-remove.spec.ts',
        'e2e/opening-hours.spec.ts',
        'e2e/public-cache.spec.ts',
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
        'e2e/menu-tapas.spec.ts',
        'e2e/weekly-special.spec.ts',
        'e2e/monthly-burger.spec.ts',
        'e2e/announcement.spec.ts',
        'e2e/announcement-remove.spec.ts',
        'e2e/opening-hours.spec.ts',
        'e2e/public-cache.spec.ts',
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
    /*
     * The Tapas lists (phase 5F), at both widths, and chained after the reorder runs for
     * the reason every write suite is chained: it publishes, publishing expires the
     * `menu` cache tag, and a guest assertion about the tapas board would be a coin toss
     * if another run could act between the write and the read.
     *
     * Two widths rather than one, because the phone is the primary admin device (§15) and
     * the editor's promise there is specific: three distinguishable lists, 44 px controls
     * and no sideways scrolling. Those are asserted inside the suite, so the phone run is
     * a different assertion rather than the same one at a smaller size. Each run leaves
     * the seeded board published, with nothing pending.
     */
    {
      name: 'menu-tapas',
      testMatch: 'e2e/menu-tapas.spec.ts',
      dependencies: ['menu-reorder-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'menu-tapas-mobile',
      testMatch: 'e2e/menu-tapas.spec.ts',
      dependencies: ['menu-tapas'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    /*
     * Ugens ret and Lørdagsmenu (phase 6A), at both widths, and chained after the Tapas
     * runs for the reason every write suite is chained: it publishes, publishing expires
     * the `weekly` cache tag, and a guest assertion about the week would be a coin toss
     * if another run could act between the write and the read.
     *
     * Two widths rather than one, because 1ag's promise on a phone is specific: two long
     * forms that stay legible, seven serving-day boxes that stay 44 px and tappable, and
     * no sideways scrolling. Those are asserted inside the suite, so the phone run is a
     * different assertion rather than the same one at a smaller size. Each run leaves the
     * seeded week published, with nothing pending.
     */
    {
      name: 'weekly-special',
      testMatch: 'e2e/weekly-special.spec.ts',
      dependencies: ['menu-tapas-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'weekly-special-mobile',
      testMatch: 'e2e/weekly-special.spec.ts',
      dependencies: ['weekly-special'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    /*
     * Månedens burger (phase 6B), at both widths, and chained after the weekly runs for
     * the reason every write suite is chained: it publishes, publishing expires the
     * `monthly` cache tag, and the guest assertions read the Forside — the one page whose
     * content several of these suites can move at once. Running it beside another writer
     * would make "the forside section is absent" a coin toss.
     *
     * Two widths rather than one, because 1ah's promise on a phone is specific: a long
     * form that stays legible, two date fields that stay 44 px and tappable, and no
     * sideways scrolling. Each run leaves the singleton empty and published, which is
     * where the seed leaves it — 1ab lists Månedens burger as still outstanding.
     */
    {
      name: 'monthly-burger',
      testMatch: 'e2e/monthly-burger.spec.ts',
      dependencies: ['weekly-special-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'monthly-burger-mobile',
      testMatch: 'e2e/monthly-burger.spec.ts',
      dependencies: ['monthly-burger'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    /*
     * Besked pa hjemmesiden (phase 7A), at both widths, and chained after the monthly
     * runs for the reason every write suite is chained: it publishes, publishing expires
     * the `announcement` cache tag, and the bar is in the shared layout — so a guest
     * assertion made by any other suite would be a coin toss if this one could act
     * between its own write and its own read.
     *
     * Two widths rather than one, because 1ac draws two different bars: on the desktop
     * the link is a phrase after the message in a centred row, and on the phone the
     * message wraps, the link sits under it and the whole row is one 52 px target. Each
     * run leaves the announcement published and **expired** — a guest reads nothing,
     * exactly as they do from the seed — because taking a message down by hand is 1ad's
     * "Fjern beskeden nu", which is the immediate path and belongs to phase 7B.
     */
    {
      name: 'announcement',
      testMatch: 'e2e/announcement.spec.ts',
      dependencies: ['monthly-burger-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'announcement-mobile',
      testMatch: 'e2e/announcement.spec.ts',
      dependencies: ['announcement'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    /*
     * "Vis besked" off and "Fjern beskeden nu" (phase 7B), at both widths, and chained
     * after the 7A runs for the reason every write suite is chained: it publishes and it
     * removes, both expire the `announcement` cache tag, and the bar is in the shared
     * layout — so a guest assertion made by any other suite would be a coin toss if this
     * one could act between its own write and its own read. It also *starts* from the
     * state 7A leaves, and leaves that same state behind.
     *
     * Two widths rather than one, because 1ad draws the removal differently at each: the
     * desktop card puts "Fjern beskeden nu" in a footer row beside its explanation, and
     * the phone card stacks the button above it at full width. The 44 px targets, the
     * focus ring and the absence of sideways scrolling are asserted inside the suite, so
     * the phone run is a different assertion rather than the same one at a smaller size.
     */
    {
      name: 'announcement-remove',
      testMatch: 'e2e/announcement-remove.spec.ts',
      dependencies: ['announcement-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'announcement-remove-mobile',
      testMatch: 'e2e/announcement-remove.spec.ts',
      dependencies: ['announcement-remove'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    /*
     * The normal weekly opening hours (phase 8A), at both widths, and chained last for the
     * reason every write suite is chained: it publishes, publishing the hours expires the
     * `hours` tag, and that tag is on **every** public page — the schedule is in the footer,
     * in the header's open/closed badge, on the Forside's Besøg os panel and on Find os. So
     * a guest assertion made by any other suite would be a coin toss if this one could act
     * between its own write and its own read. It also drives one dish's Udsolgt control, to
     * prove §7b's reset resolves against the *published* schedule, which is a second reason
     * not to let it run beside the menu suites.
     *
     * Two widths rather than one, because 1t's row is two different arrangements rather than
     * one at two sizes: at 1440 the weekday, the switch and the two dropdowns share a line,
     * and at 375 the times drop to a line of their own at half width each. The 44 px targets,
     * the focus ring and the absence of sideways scrolling are asserted inside the suite, so
     * the phone run is a different assertion rather than the same one at a smaller size.
     *
     * Each run restores the seeded week and leaves Thor available.
     */
    {
      name: 'opening-hours',
      testMatch: 'e2e/opening-hours.spec.ts',
      dependencies: ['announcement-remove-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'opening-hours-mobile',
      testMatch: 'e2e/opening-hours.spec.ts',
      dependencies: ['opening-hours'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    /*
     * The public cache's own promise (§6, §7a), and the last thing to run.
     *
     * It publishes, so it is chained for the reason every write suite is chained. It is
     * chained *last* for a second reason: it deliberately lets a public page go past its
     * five-minute window and then publishes into that state, which is the one state in
     * which a cache is tempted to answer with the copy it already holds. Doing that while
     * another suite was making guest assertions would move the page underneath it.
     *
     * One width, because nothing here is about layout: the assertions are on the bytes
     * and the headers a guest is served, which are the same at every size.
     */
    {
      name: 'public-cache',
      testMatch: 'e2e/public-cache.spec.ts',
      dependencies: ['opening-hours-mobile'],
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
