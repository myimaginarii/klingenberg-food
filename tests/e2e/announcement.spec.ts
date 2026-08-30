import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { announcementExpiryInstant } from '@/lib/announcements/expiry-editor'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  ANNOUNCEMENT_ADMIN_PATH,
  announcementForm,
  copenhagenDate,
  guestAnnouncement,
  openAnnouncementAdmin,
  openAnnouncementAdminFromDashboard,
  pendingBand,
  previewHomepage,
  publishAnnouncement,
  publishButton,
  saveAnnouncement,
  stateBanner,
} from './support/announcement-admin'

/**
 * Besked på hjemmesiden — design 1ad (the editor), 1ac (the bar and its rules);
 * phase 7A, technical plan §6, §7a, §7c, §8.
 *
 * The promise this suite exists for: **the message is edited as a draft, a guest sees
 * nothing until somebody presses Offentliggør, and the expiry then removes the bar on its
 * own — including while the visitor is already sitting on the page.**
 *
 *     public   no bar at all, and no space where one would be   (the seed)
 *     admin    "Ændrede åbningstider søndag · 17:00–19:00"      (after Gem)
 *     public   still nothing                                    (still)
 *     preview  the bar, above the navigation
 *     public   the bar                                          (after Offentliggør)
 *     public   nothing again                                    (after the expiry passes)
 *
 * It runs in order and shares one signed-in page, because it is one story.
 *
 * WHAT THIS SUITE LEAVES BEHIND, AND WHY IT IS NOT THE SEEDED ROW
 *
 * Phase 7A has **no way to take a message down by hand**: "Vis besked" off and "Fjern
 * beskeden nu" are §6's immediate path and belong to phase 7B, and a publish with a blank
 * message is refused by design (1ac — the bar *is* a message). So the last scenario leaves
 * the announcement **published and expired**: a guest reads nothing, exactly as they do
 * from the seed, and nothing is pending. Every assertion here holds from either starting
 * point, so a second run needs no database reset.
 *
 * **Every date is computed from today** (`copenhagenDate`). A suite that hard-coded a
 * September date would pass in September and fail in October.
 */

test.describe.configure({ mode: 'serial' })

const MESSAGE = 'Ændrede åbningstider søndag · 17:00–19:00'
const REVISED = 'Lukket mandag 21.09 — privat arrangement'

/**
 * The expiry every guard scenario shares, and the instant it names.
 *
 * Tomorrow evening, so **real** time never reaches it during a run and the server keeps
 * rendering the bar throughout. What the guard tests move is the *browser's* clock
 * (`page.clock`), which is the controlled clock §9 asks for — and computing the instant
 * with the application's own Copenhagen conversion is what lets a test say "twenty
 * seconds before it expires" exactly rather than approximately.
 */
const EXPIRY_DATE = copenhagenDate(1)
const EXPIRY_TIME = '20:00'
const EXPIRY_INSTANT = announcementExpiryInstant(EXPIRY_DATE, EXPIRY_TIME)

/** A browser clock set twenty seconds before the bar is due to go. */
const JUST_BEFORE_EXPIRY = new Date(EXPIRY_INSTANT.getTime() - 20_000)

/**
 * A public address that is **rendered on every request**.
 *
 * The six ordinary pages are statically generated and revalidate every five minutes
 * (§7a), so a page built before an expiry passed keeps its bar until the cache catches up
 * — the documented ≤5-minute staleness the client guard exists to cover in the meantime.
 * Asserting the *server's own* filter therefore needs an address whose HTML is built when
 * it is asked for: the catch-all 404 renders inside the same `(site)` layout, with the
 * same header and the same announcement region, and is dynamic by construction.
 */
const ALWAYS_FRESH_PATH = '/en-side-der-ikke-findes'

/** WCAG 2.2 A and AA, the same bar every other screen is held to. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

let staffPage: Page

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

test.beforeAll(async ({ browser }) => {
  // An explicit context, as in the other write suites: `@axe-core/playwright` refuses a
  // page that was opened straight from the browser.
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
})

test.afterAll(async () => {
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// Nothing to publish — the state the seed leaves, and the state this suite leaves
// ---------------------------------------------------------------------------

test('the dashboard leads to the editor', async () => {
  await openAnnouncementAdminFromDashboard(staffPage)

  await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText(
    'Besked på hjemmesiden',
  )
})

test('Offentliggør is greyed out, and says why, when there is nothing to publish', async () => {
  await openAnnouncementAdmin(staffPage)

  // 1ad: "Offentliggør er nedtonet, indtil feltet er gyldigt." A disabled control with no
  // reason beside it is a dead end, so the reason is a real element the button points at.
  await expect(publishButton(staffPage)).toBeDisabled()

  const describedBy = await publishButton(staffPage).getAttribute('aria-describedby')
  expect(describedBy, 'the disabled button names the element that explains it').not.toBeNull()
  await expect(staffPage.locator(`#${describedBy}`)).toContainText('Offentliggør er slået fra')

  await expect(pendingBand(staffPage)).toHaveCount(0)
})

test('the public site carries no bar, and reserves no space for one', async ({ browser }) => {
  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)

  // 1ac: "Bjælken er ikke skjult med et tomt felt: den findes ikke i siden."
  expect(guest.present).toBe(false)
  expect(guest.height).toBe(0)
  expect(guest.headerTop).toBe(0)

  // §12: a public visitor receives zero cookies, and phase 7A adds none.
  expect(guest.cookies).toBe(0)
})

test('the editor with nothing pending has no accessibility violations', async () => {
  await openAnnouncementAdmin(staffPage)

  expect(await violations(staffPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// Normal content: Kladde → Forhåndsvis → Offentliggør (§6)
// ---------------------------------------------------------------------------

test('saving writes a draft and leaves the public site exactly as it was', async ({
  browser,
}) => {
  await openAnnouncementAdmin(staffPage)

  await saveAnnouncement(staffPage, {
    message: MESSAGE,
    link: 'Intet link',
    linkLabel: '',
    expiryChip: 'Vælg selv',
    date: EXPIRY_DATE,
    time: EXPIRY_TIME,
  })

  await expect(staffPage.getByRole('status').first()).toContainText('gemt som kladde')
  await expect(pendingBand(staffPage)).toBeVisible()

  /*
   * The band names **what actually changed** (§4: a draft holds only the changed fields),
   * so it names the expiry here and not necessarily the message: on a second run of this
   * suite the live message is already `MESSAGE`, left behind and expired by the run
   * before, and setting a field to what it already says is not a pending change. The
   * expiry always moves — from nothing on a seeded row, or from the expired one — so it is
   * the field this scenario can assert. That the band names the *message* when the message
   * changes is asserted below, where it does.
   */
  await expect(pendingBand(staffPage)).toContainText('udløbstidspunktet')

  // The bar's own badge says Kladde rather than the published state, because what is on
  // screen is not what a guest can see.
  await expect(staffPage.getByRole('banner')).toContainText('Kladde')

  /*
   * The state banner still describes the **published** row, and the published row is not
   * on the hjemmeside: on a seeded database there is no message at all, and on a second
   * run of this suite there is one that has already expired. Either way it does not say
   * the message is showing — which is the property this scenario is about, and the one
   * that does not depend on which of the two the row happens to be in.
   */
  await expect(stateBanner(staffPage)).not.toContainText('vises øverst på hjemmesiden')

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)
  expect(guest.present).toBe(false)
})

test('the editor shows what the bar will look like, without publishing anything', async () => {
  // 1ad's "SÅDAN SER DEN UD" panel renders the real bar component, so the editor and the
  // hjemmeside cannot draw two different bars.
  await openAnnouncementAdmin(staffPage)

  await expect(staffPage.getByRole('img', { name: 'Sådan ser den ud' })).toContainText(
    MESSAGE,
  )
})

test('a populated draft has no accessibility violations', async () => {
  await openAnnouncementAdmin(staffPage)

  expect(await violations(staffPage)).toEqual([])
})

test('Forhåndsvis shows the draft bar in its real place, above the navigation', async () => {
  await openAnnouncementAdmin(staffPage)

  const preview = await previewHomepage(staffPage)

  expect(preview.present).toBe(true)
  expect(preview.message).toContain(MESSAGE)
  // 1ac: the bar is above the header and pushes it down rather than covering it.
  expect(preview.headerTop).toBeGreaterThan(0)
})

test('Offentliggør puts the bar on every public page', async ({ browser }) => {
  await openAnnouncementAdmin(staffPage)
  await publishAnnouncement(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText('nu på hjemmesiden')
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(stateBanner(staffPage)).toContainText('vises øverst på hjemmesiden')
  await expect(staffPage.getByRole('banner')).toContainText('Vises nu')

  // Sitewide: it is a layout concern, so it is on the Forside and on the menu alike.
  for (const path of ['/', '/menu', '/om-os', '/find-os']) {
    const guest = await guestAnnouncement(browser, path)

    expect(guest.present, `the bar is on ${path}`).toBe(true)
    expect(guest.message).toContain(MESSAGE)
    expect(guest.headerTop, `the header is pushed down on ${path}`).toBeGreaterThan(0)
    expect(guest.cookies, `${path} still sets no cookie`).toBe(0)
  }
})

test('an unlinked bar is plain text — no empty button and no arrow', async ({ browser }) => {
  const guest = await guestAnnouncement(browser)

  expect(guest.linkHref).toBeNull()
  expect(guest.message).not.toContain('›')
})

test('the published bar has no accessibility violations', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])

  await context.close()
})

test('the bar announces itself politely, and offers a guest no way to dismiss it', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')

  // 1ac's "Skærmlæser" note, word for word.
  const region = page.getByRole('region', { name: 'Besked fra restauranten' })
  await expect(region).toHaveAttribute('aria-live', 'polite')

  // No dismiss control anywhere in it, and no dialog: it is in the page's flow (1ac).
  await expect(region.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await context.close()
})

test('the bar does not take focus when the page loads', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')

  expect(await page.evaluate(() => document.activeElement?.tagName ?? null)).toBe('BODY')

  // The first Tab still reaches the skip link, exactly as it did before the bar existed.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Spring til indhold' })).toBeFocused()

  await context.close()
})

// ---------------------------------------------------------------------------
// Editing a published announcement (§6)
// ---------------------------------------------------------------------------

test('editing a live message is a draft: the guest keeps reading the old one', async ({
  browser,
}) => {
  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, { message: REVISED })

  await expect(pendingBand(staffPage)).toBeVisible()
  // The message is the only field this save changes, so it is the only one the band names.
  await expect(pendingBand(staffPage)).toContainText('beskeden')
  await expect(pendingBand(staffPage)).not.toContainText('udløbstidspunktet')

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)
  expect(guest.message).toContain(MESSAGE)
  expect(guest.message).not.toContain(REVISED)
})

test('Forhåndsvis shows the new message while the site still shows the old', async ({
  browser,
}) => {
  await openAnnouncementAdmin(staffPage)

  const preview = await previewHomepage(staffPage)
  expect(preview.message).toContain(REVISED)

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)
  expect(guest.message).toContain(MESSAGE)
})

test('publishing replaces what the guest reads', async ({ browser }) => {
  await openAnnouncementAdmin(staffPage)
  await publishAnnouncement(staffPage)

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)
  expect(guest.message).toContain(REVISED)
})

// ---------------------------------------------------------------------------
// The optional link (§8)
// ---------------------------------------------------------------------------

test('an internal page link points at one of our own routes', async ({ browser }) => {
  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, { link: 'Find os', linkLabel: 'Se tider' })
  await publishAnnouncement(staffPage)

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)

  expect(guest.linkHref).toBe('/find-os')
  expect(guest.linkText).toBe('Se tider')
})

test('the linked bar is a 44 px target and has no accessibility violations', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(ALWAYS_FRESH_PATH)

  const link = page.getByRole('region', { name: 'Besked fra restauranten' }).getByRole('link')
  const box = await link.boundingBox()

  // 1aa: "Tryk-mål mindst 44 × 44 px", which 1ac's 41 px desktop bar does not reach on
  // its own. The link carries the height; an unlinked bar has no target and keeps 41.
  expect(box?.height ?? 0, 'the announcement link is at least 44 px tall').toBeGreaterThanOrEqual(
    44,
  )

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])

  await context.close()
})

test('an https address is accepted and rendered with rel="noopener noreferrer"', async ({
  browser,
}) => {
  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, {
    link: 'Anden adresse (https://…)',
    address: 'https://www.facebook.com/carlnielsencafeen',
    linkLabel: 'Se opslaget',
  })
  await publishAnnouncement(staffPage)

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(ALWAYS_FRESH_PATH)

  const link = page.getByRole('region', { name: 'Besked fra restauranten' }).getByRole('link')

  await expect(link).toHaveAttribute('href', 'https://www.facebook.com/carlnielsencafeen')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  // §8 asks for the `rel`, not for a new tab.
  expect(await link.getAttribute('target')).toBeNull()

  await context.close()
})

test('a javascript: address is refused, on the field a person would fix', async () => {
  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, {
    link: 'Anden adresse (https://…)',
    address: 'javascript:alert(1)',
    linkLabel: 'Se opslaget',
  })

  await expect(
    announcementForm(staffPage).getByText('Adressen skal begynde med https://'),
  ).toBeVisible()
})

test('an http address is refused too', async () => {
  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, {
    link: 'Anden adresse (https://…)',
    address: 'http://usikker.test/side',
    linkLabel: 'Se opslaget',
  })

  await expect(
    announcementForm(staffPage).getByText('Adressen skal begynde med https://'),
  ).toBeVisible()
})

test('a refusal changes nothing a guest can see', async ({ browser }) => {
  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)

  expect(guest.linkHref).toBe('https://www.facebook.com/carlnielsencafeen')
})

test('the editor with a validation error has no accessibility violations', async () => {
  // Reached by a real refusal, so the message on screen is one the server wrote.
  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, { message: '   ' })

  await expect(announcementForm(staffPage).getByText('Skriv beskeden')).toBeVisible()
  expect(await violations(staffPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// The expiry (§7a, §7c) — the reason phase 7A has a client component at all
// ---------------------------------------------------------------------------

test('an expiry in the past is refused with 1ad’s own sentence', async () => {
  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, {
    expiryChip: 'Vælg selv',
    date: copenhagenDate(-1),
    time: '20:00',
  })

  await expect(
    announcementForm(staffPage).getByText('Vælg et tidspunkt ude i fremtiden'),
  ).toBeVisible()
})

test('a suggestion chip fills the expiry from the published opening hours', async () => {
  await openAnnouncementAdmin(staffPage)

  // The chip's own words carry a weekday and a time computed from the published hours, so
  // it is named by the shape of its label rather than by a literal.
  const chip = announcementForm(staffPage).getByRole('radio', { name: /^Når vi lukker/ })
  await expect(chip).toHaveCount(1)

  await saveAnnouncement(staffPage, { expiryChip: /^Når vi lukker/ })

  // The chip stays chosen because the stored instant is still the one it names — the row
  // holds a time, and the choice is recomputed from it.
  await expect(
    announcementForm(staffPage).getByRole('radio', { name: /^Når vi lukker/ }),
  ).toBeChecked()

  // And the two fields now hold that instant as a Copenhagen wall clock.
  await expect(announcementForm(staffPage).getByLabel('Klokkeslæt')).not.toHaveValue('')
})

test('a linked message with tomorrow’s expiry goes live, for the scenarios that follow', async ({
  browser,
}) => {
  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, {
    message: MESSAGE,
    link: 'Find os',
    address: '',
    linkLabel: 'Se tider',
    expiryChip: 'Vælg selv',
    date: EXPIRY_DATE,
    time: EXPIRY_TIME,
  })
  await publishAnnouncement(staffPage)

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)
  expect(guest.present).toBe(true)
  expect(guest.linkHref).toBe('/find-os')
})

test('the bar disappears when its expiry passes, with no reload and no request', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  // Installed before navigation, so the page's own timers are the ones being controlled.
  await page.clock.install({ time: JUST_BEFORE_EXPIRY })
  await page.goto(ALWAYS_FRESH_PATH)

  const region = page.getByRole('region', { name: 'Besked fra restauranten' })
  await expect(region).toContainText(MESSAGE)

  const origin = new URL(page.url()).origin
  const requests: { url: string; kind: string }[] = []
  let navigations = 0

  page.on('request', (request) => requests.push({ url: request.url(), kind: request.resourceType() }))
  page.on('framenavigated', () => (navigations += 1))

  // Past the expiry. The guard's own timer fires; nothing else happens.
  await page.clock.fastForward(30_000)

  // §7c: the region stays mounted, and only its content is removed, so a screen reader is
  // not interrupted by a disappearance.
  await expect(region).toHaveCount(1)
  await expect(region).not.toContainText(MESSAGE)
  await expect(region.getByRole('link')).toHaveCount(0)

  // "Without a reload": the bar went without the page being fetched again.
  expect(navigations, 'the page did not navigate').toBe(0)
  expect(
    requests.filter((request) => request.kind === 'document'),
    'no document was requested',
  ).toEqual([])

  /*
   * §7c: "no `fetch`, no Supabase client, no realtime subscription, no polling", asserted
   * against the request log exactly as §9 asks.
   *
   * The log is not empty, and what is in it is worth naming rather than filtering away:
   * Next.js prefetches the header's and footer's `<Link>`s, and those requests carry its
   * own `_rsc` marker and address the site's own public routes. They existed before this
   * phase and have nothing to do with the announcement — releasing the fake clock is
   * simply what lets the router's pending prefetches run. Everything *else* must be
   * nothing, and nothing at all may leave this origin.
   */
  const notAPrefetch = requests.filter((request) => !request.url.includes('_rsc='))
  expect(notAPrefetch, 'the expiry guard made no request of its own').toEqual([])

  expect(
    requests.filter((request) => !request.url.startsWith(origin)),
    'nothing left the site’s own origin — no Supabase, no third party',
  ).toEqual([])

  // §12, again: still nothing stored on the visitor's device.
  expect((await context.cookies()).length).toBe(0)
  expect(
    await page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 })

  await context.close()
})

test('a page restored from the background re-checks on pageshow', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.clock.install({ time: JUST_BEFORE_EXPIRY })
  await page.goto(ALWAYS_FRESH_PATH)

  const region = page.getByRole('region', { name: 'Besked fra restauranten' })
  await expect(region).toContainText(MESSAGE)

  // The bfcache case §7c names: the device was asleep, the clock moved on, and the
  // pending timer did not fire. `setSystemTime` moves the clock without running timers,
  // which is exactly that situation.
  await page.clock.setSystemTime(new Date(EXPIRY_INSTANT.getTime() + 3 * 3_600_000))
  await expect(region).toContainText(MESSAGE)

  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))

  await expect(region).not.toContainText(MESSAGE)

  await context.close()
})

test('and on visibilitychange', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.clock.install({ time: JUST_BEFORE_EXPIRY })
  await page.goto(ALWAYS_FRESH_PATH)

  const region = page.getByRole('region', { name: 'Besked fra restauranten' })
  await expect(region).toContainText(MESSAGE)

  await page.clock.setSystemTime(new Date(EXPIRY_INSTANT.getTime() + 3 * 3_600_000))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

  await expect(region).not.toContainText(MESSAGE)

  await context.close()
})

test('the expiry passing while the link has focus does not throw', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.clock.install({ time: JUST_BEFORE_EXPIRY })
  await page.goto(ALWAYS_FRESH_PATH)

  const link = page.getByRole('region', { name: 'Besked fra restauranten' }).getByRole('link')
  await link.focus()
  await expect(link).toBeFocused()

  await page.clock.fastForward(30_000)

  await expect(link).toHaveCount(0)
  expect(errors, 'removing the focused link threw nothing').toEqual([])

  // Focus lands on the body — lost, but never *moved* to another control, which is what
  // 1ac forbids. The next Tab therefore starts from the top of the page, where the bar was.
  expect(await page.evaluate(() => document.activeElement?.tagName ?? null)).toBe('BODY')

  await context.close()
})

// ---------------------------------------------------------------------------
// Permissions and forged requests (§5, §8)
// ---------------------------------------------------------------------------

test('an Owner may edit and publish the announcement too', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, OWNER)

  await openAnnouncementAdmin(page)
  await saveAnnouncement(page, { message: 'Beskeden er skrevet af ejeren' })
  await publishAnnouncement(page)

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)
  expect(guest.message).toContain('Beskeden er skrevet af ejeren')

  await context.close()
})

test('an anonymous visitor cannot reach the editor or its actions', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(ANNOUNCEMENT_ADMIN_PATH)
  await expect(page).toHaveURL(/\/admin\/login/)

  // And a direct POST to the screen's Server Action is refused too: the action calls
  // requireStaff() itself, so the route being unreachable is not what protects it.
  const forged = await page.request.post(ANNOUNCEMENT_ADMIN_PATH, {
    headers: { 'Next-Action': 'forged', 'Content-Type': 'text/plain;charset=UTF-8' },
    data: '[]',
    maxRedirects: 0,
  })

  expect(forged.status(), 'a forged Server Action POST is not carried out').not.toBe(200)

  // A plain form POST carrying content — including a javascript: address and a foreign
  // entity name — is refused before it reaches a rule.
  const posted = await page.request.post(ANNOUNCEMENT_ADMIN_PATH, {
    form: {
      besked: 'Indsat af en fremmed',
      link: 'adresse',
      adresse: 'javascript:alert(1)',
      entity: 'page:home',
      is_visible: 'false',
      version: new Date().toISOString(),
    },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0,
    failOnStatusCode: false,
  })

  expect(posted.status()).toBeGreaterThanOrEqual(300)

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)
  expect(guest.message).not.toContain('Indsat af en fremmed')

  await context.close()
})

test('a signed-in POST that names an entity or a row of its own is not honoured', async () => {
  // The editor's forms have no field for an entity, an id, `is_visible` or `source`, so a
  // submission carrying them is not stripped — it simply has nowhere to go. What the save
  // writes is decided by the server from the registry (§8).
  await openAnnouncementAdmin(staffPage)

  const version = await staffPage.locator('input[name="version"]').first().inputValue()

  await staffPage.request.post(ANNOUNCEMENT_ADMIN_PATH, {
    form: {
      entity: 'page:home',
      entityId: '00000000-0000-4000-8000-000000000000',
      is_visible: 'false',
      source: 'opening_hours',
      besked: 'Smuglet indhold',
      version,
    },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0,
    failOnStatusCode: false,
  })

  /*
   * The status is deliberately not asserted. A plain POST to a page address is not a
   * Server Action invocation at all — Next.js has no action to dispatch, so it renders
   * the page and answers 200, which is neither a success nor a refusal. **What was
   * written** is the assertion that matters, and the answer is nothing: the row's version
   * token has not moved, so no draft, no live column and no other entity was touched.
   */
  await openAnnouncementAdmin(staffPage)

  expect(
    await staffPage.locator('input[name="version"]').first().inputValue(),
    'the row did not move, so nothing was written',
  ).toBe(version)

  await expect(announcementForm(staffPage).getByLabel('Besked')).not.toHaveValue(
    'Smuglet indhold',
  )
})

// ---------------------------------------------------------------------------
// Keyboard and layout
// ---------------------------------------------------------------------------

test('the whole editor is reachable and operable from the keyboard', async () => {
  await openAnnouncementAdmin(staffPage)

  const reached: string[] = []

  for (let step = 0; step < 40; step += 1) {
    await staffPage.keyboard.press('Tab')

    const focused = await staffPage.evaluate(() => {
      const node = document.activeElement as HTMLElement | null
      if (node === null) return null

      const name = node.getAttribute('name') ?? ''
      const text = (node.innerText ?? '').trim().slice(0, 30)

      return `${node.tagName.toLowerCase()}|${name}|${text}`
    })

    if (focused !== null) reached.push(focused)
  }

  // Every control the screen offers is in the tab order, without a single tabindex.
  for (const field of ['|besked|', '|link|', '|linktekst|', '|adresse|', '|udloeb|', '|udloeb_dato|']) {
    expect(
      reached.some((entry) => entry.includes(field)),
      `${field} is in the tab order`,
    ).toBe(true)
  }
})

test('the editor does not make the screen scroll sideways', async () => {
  await openAnnouncementAdmin(staffPage)

  const overflow = await staffPage.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow, 'the editor fits its viewport').toBe(false)
})

test('the longest allowed message with a link fits 768 px without overflowing', async ({
  browser,
}) => {
  // 1ac: "Beskeden ombrydes frit — den bliver aldrig klippet af med '…'". 90 characters is
  // the most the column and the counter allow, and 768 px is where the bar switches to
  // 1ac's centred single-row desktop arrangement — the width at which a row that could not
  // shrink would push the message past the gutter instead of wrapping it.
  const longest = 'Ændrede åbningstider hele ugen — vi lukker kl. 19 onsdag, torsdag og fredag i denne uge.'
  expect(longest.length).toBeLessThanOrEqual(90)

  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, {
    message: longest,
    link: 'Find os',
    linkLabel: 'Se tider',
  })
  await publishAnnouncement(staffPage)

  for (const width of [375, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    await page.goto(ALWAYS_FRESH_PATH)

    const region = page.getByRole('region', { name: 'Besked fra restauranten' })
    await expect(region).toContainText(longest)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflow, `the bar fits ${width} px`).toBe(false)

    // The bar grows for the wrapped text rather than clipping it, and the link keeps its
    // target at every width.
    const box = await region.boundingBox()
    expect(box?.height ?? 0, `the bar has real height at ${width} px`).toBeGreaterThan(0)

    const link = region.getByRole('link')
    const linkBox = await link.boundingBox()
    expect(linkBox?.height ?? 0, `the link is 44 px at ${width} px`).toBeGreaterThanOrEqual(44)

    await context.close()
  }
})

test('the public bar does not make the page scroll sideways either', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(ALWAYS_FRESH_PATH)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow).toBe(false)

  await context.close()
})

// ---------------------------------------------------------------------------
// The server's own filter, and the state this suite leaves behind
// ---------------------------------------------------------------------------

test('a page rendered after the expiry carries no bar, and that is where this ends', async ({
  browser,
}) => {
  /*
   * The one scenario in this file that waits for **real** time, because it asserts the
   * *server's* filter rather than the browser's: a page built after the expiry must not
   * contain the bar at all, with no JavaScript involved in that decision. The default
   * 30-second budget is not enough for a wait measured in minutes.
   */
  test.setTimeout(240_000)

  await openAnnouncementAdmin(staffPage)

  /*
   * The nearest thing to the seed that phase 7A can produce: a published message whose
   * expiry is a minute or so away. Taking one down by hand is 1ad's "Fjern beskeden nu",
   * which is the immediate path and belongs to phase 7B — see this file's header.
   *
   * 90 seconds rather than 60, because the time field is `HH:MM` and the instant it names
   * is therefore truncated to the whole minute: 90 seconds ahead leaves a margin of
   * between 30 and 90 seconds, which is long enough that the publish cannot be refused as
   * already-past and short enough to wait for.
   */
  const soon = new Date(Date.now() + 90_000)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(soon)

  await saveAnnouncement(staffPage, {
    message: MESSAGE,
    link: 'Intet link',
    address: '',
    linkLabel: '',
    expiryChip: 'Vælg selv',
    date: copenhagenDate(0),
    time,
  })
  await publishAnnouncement(staffPage)

  await expect(pendingBand(staffPage)).toHaveCount(0)
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present).toBe(true)

  await expect
    .poll(async () => (await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present, {
      intervals: [5_000],
      message: 'a freshly rendered page stops carrying the expired announcement',
      timeout: 180_000,
    })
    .toBe(false)

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)
  expect(guest.height).toBe(0)
  expect(guest.headerTop).toBe(0)

  // And the editor still loads, still says what the hjemmeside shows, and still refuses to
  // publish an expired message — which is where the next run of this suite starts.
  await openAnnouncementAdmin(staffPage)
  await expect(stateBanner(staffPage)).toContainText('udløb')
  await expect(publishButton(staffPage)).toBeDisabled()
})
