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
        'e2e/opening-hours-override.spec.ts',
        'e2e/public-cache.spec.ts',
        /*
         * The generated-announcement workflow is a serial WRITE suite owned by its two
         * dedicated projects at the end of the chain — never by these two, which run
         * first, in parallel with each other, and are read-only by design.
         *
         * This entry is load-bearing in a way its neighbours are not, and it earned this
         * comment by failing: when 8C-3B replaced `announcement-replacement.spec.ts` with
         * this file, the stale ignore entry kept ignoring the deleted file and nothing
         * ignored the new one. Both generic projects then ran the whole workflow
         * concurrently — two module instances with identical date allocators racing one
         * announcement singleton — and the wreckage surfaced as unexplainable state in the
         * dedicated projects downstream. `npx playwright test --list` is the check: this
         * file must appear under exactly two projects, both named for it.
         */
        'e2e/opening-hours-announcement.spec.ts',
        // The news write suite (phase 9A) — owned by its two dedicated projects at the
        // end of the chain, for the same reason as its neighbour above. `--list` check:
        // the file appears under exactly `news-admin-mobile` and `news-admin`.
        'e2e/news-admin.spec.ts',
        // The image-library write suite (phase 10B) — owned by its two dedicated
        // projects at the end of the chain. `--list` check: the file appears under
        // exactly `image-library-mobile` and `image-library`.
        'e2e/image-library.spec.ts',
        // The editor image-selection suite (phase 10C-1) — owned by its two
        // dedicated projects at the end of the chain. `--list` check: the file
        // appears under exactly `editor-images-mobile` and `editor-images`.
        'e2e/editor-images.spec.ts',
        // The public image rendering suite (phase 10C-2) — owned by its two
        // dedicated projects at the very end of the chain. `--list` check: the
        // file appears under exactly `public-images-mobile` and `public-images`.
        'e2e/public-images.spec.ts',
        // The Forsiden administration suite (phase 11A) — owned by its two
        // dedicated projects at the very end of the chain. `--list` check: the
        // file appears under exactly `homepage-admin-mobile` and `homepage-admin`.
        'e2e/homepage-admin.spec.ts',
        // The two phase-11B write suites — owned by their dedicated pairs at the
        // very end of the chain. `--list` check: each file appears under exactly its
        // own two projects.
        'e2e/takeaway-admin.spec.ts',
        'e2e/contact-admin.spec.ts',
        // The user-administration suite (phase 11C) — creates and deletes a real
        // Auth identity, so it must never race itself. `--list` check: the file
        // appears under exactly `users-admin-mobile` and `users-admin`.
        'e2e/users-admin.spec.ts',
        // The phone-as-primary-device menu story (phase 12A) — a write suite owned
        // by its one dedicated project at the tail. `--list` check: the file
        // appears under exactly `menu-mobile`.
        'e2e/menu-mobile.spec.ts',
        // The phone-as-primary-device news story (phase 12B) — the same shape,
        // owned by `news-mobile` alone. `--list` check: the file appears under
        // exactly `news-mobile`.
        'e2e/news-mobile.spec.ts',
        // The dashboard-first phone story (phase 12C) — owned by `dashboard-mobile`
        // alone. `--list` check: the file appears under exactly `dashboard-mobile`.
        'e2e/dashboard-mobile.spec.ts',
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
        'e2e/opening-hours-override.spec.ts',
        'e2e/public-cache.spec.ts',
        // See the desktop project's entry for why these five must exist.
        'e2e/opening-hours-announcement.spec.ts',
        'e2e/news-admin.spec.ts',
        'e2e/image-library.spec.ts',
        'e2e/editor-images.spec.ts',
        'e2e/public-images.spec.ts',
        'e2e/homepage-admin.spec.ts',
        'e2e/takeaway-admin.spec.ts',
        'e2e/contact-admin.spec.ts',
        'e2e/users-admin.spec.ts',
        'e2e/menu-mobile.spec.ts',
        'e2e/news-mobile.spec.ts',
        'e2e/dashboard-mobile.spec.ts',
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
     * The one-off overrides (phase 8B), at both widths, chained after the weekly editor.
     *
     * Same reason every write suite is chained, twice over: it publishes, publishing an
     * override expires the `hours` tag, and that tag is on **every** public page — a
     * published override moves the open/closed badge everywhere. It also drives one dish's
     * Udsolgt control to prove §7b resolves against the *published* overrides, which is a
     * second reason not to let it run beside the menu suites. It runs after
     * `opening-hours-mobile` rather than beside it because both write the same two tables.
     *
     * Two widths, because 1t's lower card is two different arrangements rather than one at
     * two sizes: at 1440 the date, the chips and the two times share the card's width, and
     * at 375 they stack. The 44 px targets, the focus ring and the absence of sideways
     * scrolling are asserted inside the suite, so the phone run is a different assertion
     * rather than the same one at a smaller size.
     *
     * Each run removes every override it created and leaves Thor available.
     */
    {
      name: 'opening-hours-override',
      testMatch: 'e2e/opening-hours-override.spec.ts',
      dependencies: ['opening-hours-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'opening-hours-override-mobile',
      testMatch: 'e2e/opening-hours-override.spec.ts',
      dependencies: ['opening-hours-override'],
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
      dependencies: ['opening-hours-override-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * The generated opening-hours announcement — 1t's checkbox, 1ae's conflict sheet, both
     * of its branches, the ~10 s Fortryd and §7e item 6's removal (phase 8C-3B). The
     * **last** two projects of the run.
     *
     * Chained last for the reason phase 8C-1's harness suite was: it writes the
     * announcement, whose bar is in the shared public layout, so a guest assertion made by
     * any other suite would be a coin toss if this one could act between its own write and
     * its own read.
     *
     * **Two widths now**, where 8C-1 needed one. That suite asserted bytes served to a
     * guest and the state of a form, which are the same at every size; this one draws 1ae,
     * and 1ae is a sheet with a footer that stacks on a phone and a row on a desktop, a
     * focus trap, and a 375 px width the brief asks for by name. Mobile runs first and
     * hands its state to the desktop project, exactly as the override suites do.
     *
     * It starts from the state the announcement suites leave and leaves that same state
     * behind: published and expired, switched off, nothing pending, and no overrides.
     */
    {
      name: 'opening-hours-announcement-mobile',
      testMatch: 'e2e/opening-hours-announcement.spec.ts',
      dependencies: ['public-cache'],
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 780 } },
    },
    {
      name: 'opening-hours-announcement',
      testMatch: 'e2e/opening-hours-announcement.spec.ts',
      dependencies: ['opening-hours-announcement-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * The news administration (phase 9A), at both widths, and the new tail of the
     * chain. Chained for the reason every write suite is chained: it publishes,
     * publishing news expires the `news` tag, and that tag is on `/nyheder` and on the
     * Forside's teaser — pages other suites make guest assertions about. It runs after
     * the generated-announcement pair because that pair *starts from* the exact state
     * the announcement suites leave behind, while this suite only needs the seeded
     * articles, which it restores by deleting everything it creates.
     *
     * Two widths, because 1s and 1z are two arrangements rather than one at two sizes:
     * at 1440 the editor is 1s's wide card with the date and the category chips on one
     * row, at 375 it is 1z's stacked form. Mobile runs first and hands its state to
     * the desktop project, as the override and announcement suites do.
     */
    {
      name: 'news-admin-mobile',
      testMatch: 'e2e/news-admin.spec.ts',
      dependencies: ['opening-hours-announcement'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'news-admin',
      testMatch: 'e2e/news-admin.spec.ts',
      dependencies: ['news-admin-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * The image library (phase 10B), at both widths, and the new tail of the chain.
     * Chained for the reason every write suite is chained — it creates and deletes
     * database rows other suites could otherwise race — plus one of its own: it
     * writes and removes REAL storage objects, and its usage fixture points Thor at
     * an image, so running beside any menu suite would make "Thor is untouched" a
     * coin toss. It expires no cache tag (creating or deleting an unreferenced
     * image changes no public page until 10C), which is why it can run after the
     * cache suites without disturbing what they measured.
     *
     * Two widths, because 1w is drawn at desktop and the phone has no dedicated
     * frame: the mobile run asserts the established stacking rules — no sideways
     * scrolling, 44 px targets — as their own promises, not the desktop's at a
     * smaller size. Mobile runs first and hands its state (an empty library, Thor
     * unreferenced) to the desktop project, as the other write pairs do.
     */
    {
      name: 'image-library-mobile',
      testMatch: 'e2e/image-library.spec.ts',
      dependencies: ['news-admin'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'image-library',
      testMatch: 'e2e/image-library.spec.ts',
      dependencies: ['image-library-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * Editor image selection (phase 10C-1), at both widths, and the new tail of
     * the chain. It uploads real images, threads one draft selection through four
     * editors, publishes and detaches them again, and drives the library's
     * draft-aware delete and replacement — so it owns the library and every
     * image_id column while it runs, and follows the image-library pair for the
     * same reason that pair follows the news suite. Mobile runs first and hands
     * its state (an empty library, nothing referenced) to the desktop project.
     */
    {
      name: 'editor-images-mobile',
      testMatch: 'e2e/editor-images.spec.ts',
      dependencies: ['image-library'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'editor-images',
      testMatch: 'e2e/editor-images.spec.ts',
      dependencies: ['editor-images-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * Public image rendering and the cache coupling (phase 10C-2), at both widths,
     * and the new tail of the chain. It publishes a dish, the week, the burger and
     * an article with real photos, edits, replaces and deletes them in the library,
     * and asserts the FIRST guest request after each — so it expires the `menu`,
     * `weekly`, `monthly` and `news` tags and owns every image_id column while it
     * runs, and follows the editor-images pair for the same reason that pair
     * follows the library suite. Two widths because the frames draw different
     * slots (1:1 thumbnails on a phone, 4:3 / 3:2 columns from md) and `sizes` must
     * pick a different rung at each. Mobile runs first and hands its state (an
     * empty library, nothing referenced) to the desktop project.
     */
    {
      name: 'public-images-mobile',
      testMatch: 'e2e/public-images.spec.ts',
      dependencies: ['editor-images'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'public-images',
      testMatch: 'e2e/public-images.spec.ts',
      dependencies: ['public-images-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * The Forsiden administration (phase 11A), at both widths, and the new tail of
     * the chain. It publishes the Forside document, expires the `page:home` tag,
     * uploads, replaces and deletes real library images, and asserts the FIRST guest
     * request after each — so it owns the Forside, the library and the featured
     * dish ids while it runs, and follows the public-images pair for the same reason
     * that pair follows the editor-images pair. Two widths because 1u is drawn at
     * desktop and the phone is the primary admin device (§15): the mobile run asserts
     * the stacking rules — 44 px targets, no sideways scrolling — as its own
     * promises. Mobile runs first and hands its state (the seeded Forside, an empty
     * library) to the desktop project.
     */
    {
      name: 'homepage-admin-mobile',
      testMatch: 'e2e/homepage-admin.spec.ts',
      dependencies: ['public-images'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'homepage-admin',
      testMatch: 'e2e/homepage-admin.spec.ts',
      dependencies: ['homepage-admin-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * Mad ud af huset administration (phase 11B), at both widths, after the Forsiden
     * pair. It publishes the takeaway document and its switch — expiring the
     * `page:takeaway` tag, which the navigation read puts on every public page — uploads,
     * replaces and deletes real library images, and asserts the FIRST guest request
     * after each, so it owns the page, the library and every public page's navigation
     * while it runs. Two widths because 1aj is drawn at desktop and the phone is the
     * primary admin device (§15). Mobile runs first and hands its state (the seeded
     * page, visible, an empty library) to the desktop project.
     */
    {
      name: 'takeaway-admin-mobile',
      testMatch: 'e2e/takeaway-admin.spec.ts',
      dependencies: ['homepage-admin'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'takeaway-admin',
      testMatch: 'e2e/takeaway-admin.spec.ts',
      dependencies: ['takeaway-admin-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * Kontaktoplysninger (phase 11B), at both widths, and the new tail of the chain.
     * It publishes the contact facts — expiring the `contact` tag, which is on every
     * public page — and asserts the FIRST guest request on the header, the footer, the
     * bottom bar, Find os and Mad ud af huset's button, so it must not run beside any
     * suite that reads a phone number. Mobile runs first (the bottom bar's "Bestil"),
     * then desktop (the header's "Ring"); each run restores the seeded facts.
     */
    {
      name: 'contact-admin-mobile',
      testMatch: 'e2e/contact-admin.spec.ts',
      dependencies: ['takeaway-admin'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'contact-admin',
      testMatch: 'e2e/contact-admin.spec.ts',
      dependencies: ['contact-admin-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * User administration (phase 11C), at both widths, and the new tail of the
     * chain. It creates a real Auth identity through the Owner's screen, signs in
     * as that person in a second context, changes the role, deactivates and
     * reactivates — so it owns `profiles`, the Auth server's user set and the
     * seeded Owner's own row while it runs, and two runs of it must never overlap:
     * the invariant it exercises is "exactly one active owner", which a parallel
     * run would move underneath it. Mobile runs first (the stacked rows and the
     * dialog's footer), then desktop; each run deletes the identity it created and
     * restores the seeded pair exactly. It expires no public cache tag.
     */
    {
      name: 'users-admin-mobile',
      testMatch: 'e2e/users-admin.spec.ts',
      dependencies: ['contact-admin'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'users-admin',
      testMatch: 'e2e/users-admin.spec.ts',
      dependencies: ['users-admin-mobile'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * The menu on a phone as the primary device (phase 12A) — the tail of the chain.
     *
     * One width, and it is the phone's: the locked phase-5 suites already run every
     * menu operation at both widths, and this suite asserts what only a 375 px run can
     * — 1y's foot with the Fortryd and the pending band inside the viewport at the
     * moment they matter, no sideways scrolling with the longest content the schema
     * allows, dialogs that fit the screen with the safe way out first, the moved row in
     * view after a move, and 44 px targets throughout — with touch, because that is the
     * input the device has. Chained last for the reason every write suite is chained:
     * it publishes the menu and uploads and removes a real library image, so it owns
     * the `menu` tag and the library while it runs. It leaves the seed as it found it.
     */
    {
      name: 'menu-mobile',
      testMatch: 'e2e/menu-mobile.spec.ts',
      dependencies: ['users-admin'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        hasTouch: true,
      },
    },
    /*
     * The news on a phone as the primary device (phase 12B) — the new tail.
     *
     * The same shape as `menu-mobile`, for the same reasons: the locked phase-9 pair
     * runs every news operation at both widths, and this suite asserts what only a
     * 375 px run can — the pinned bar with the Kladde/Udgivet badge and the autosave
     * line in view at the end of a long article, B and Link one tap away there, the
     * link panel opening in view, no scroll after an autosave, the three confirmations
     * stacked with the safe way out first, the longest title and address wrapping, and
     * 44 px targets throughout — with touch. Chained last: it publishes an article
     * (the `news` tag) and uploads and removes a real library image. It leaves the seed
     * as it found it.
     */
    {
      name: 'news-mobile',
      testMatch: 'e2e/news-mobile.spec.ts',
      dependencies: ['menu-mobile'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        hasTouch: true,
      },
    },
    /*
     * The dashboard on a phone as the primary device (phase 12C) — the tail.
     *
     * The same shape as the two before it: a Staff member's day from 1x's landing
     * screen — the tiles in the first screen, LIGE NU from the locked systems, the
     * band publishing what the registry says is pending, and the four screens whose
     * Fortryd was measured above the viewport before 12C (Ugens ret, Månedens burger,
     * Åbningstider, Besked på hjemmesiden) now leaving it at the foot — plus the
     * Owner's tiles, the refused address, and the News bar's measurement gone on the
     * way back. Chained last: it publishes the two specials, an announcement and a
     * one-off change, and leaves the seed as the locked suites leave it.
     */
    {
      name: 'dashboard-mobile',
      testMatch: 'e2e/dashboard-mobile.spec.ts',
      dependencies: ['news-mobile'],
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
        /*
         * No environment of its own since phase 8C-3B.
         *
         * 8C-1 proved the first-guest-request promise through an unlinked, flag-gated
         * harness, because `updateTag()` is only reachable from a Server Action and 8C-1
         * was forbidden to add a replacement control. 8C-3B added the real one — 1t's
         * checkbox and 1ae's sheet on `/admin/aabningstider` — so the harness, its flag
         * and this line are gone, and the same scenarios are driven through the screen a
         * person actually uses.
         */
      },
})
