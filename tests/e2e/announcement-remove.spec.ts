import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  ANNOUNCEMENT_ADMIN_PATH,
  announcementForm,
  copenhagenDate,
  formActionId,
  formFields,
  guestAnnouncement,
  openAnnouncementAdmin,
  pendingBand,
  pressRemoveNow,
  pressUndo,
  pressVisibilitySwitch,
  previewHomepage,
  publishAnnouncement,
  removeNowButton,
  publishButton,
  saveAnnouncement,
  stateBanner,
  undoButton,
  undoStrip,
  visibilityCard,
  visibilitySwitchDirection,
  visibilityUnavailableCard,
} from './support/announcement-admin'

/**
 * "Vis besked" off and "Fjern beskeden nu" — design 1ad; phase 7B, technical plan §6, §7c.
 *
 * The promise this suite exists for: **a wrong message can be stopped with one press, the
 * hjemmeside changes at once, and there is about ten seconds in which to put it back.**
 *
 *     admin    a published, live message                       (this suite publishes it)
 *     public   the bar
 *     admin    "Fjern beskeden nu"                             — one press, no publish
 *     public   nothing, immediately
 *     admin    "Beskeden er fjernet fra hjemmesiden." + Fortryd
 *     public   the same bar again                              (after Fortryd)
 *
 * 1ad separates the two halves of this screen in its own words — *"Skrive eller ændre →
 * tre trin"* against *"Fjerne → ét tryk"* — and the assertions below are that separation
 * made checkable: the removal writes no draft, publishes no draft, and leaves a pending
 * draft byte-identical on the way past it.
 *
 * It runs in order and shares one signed-in page, because it is one story. Both
 * Playwright projects run it, which gives 1440 px and 375 px.
 *
 * WHAT THIS SUITE LEAVES BEHIND
 *
 * The same state `announcement.spec.ts` leaves and starts from: **published and expired,
 * with nothing pending**, so a guest reads nothing and Offentliggør is greyed out. The
 * last scenario produces it honestly rather than by tidying up — it is the expiry-inside-
 * the-Fortryd-window case, which ends with an expired message that the undo refused to
 * restore.
 *
 * **Every date is computed from today.** A suite that hard-coded one would pass this month
 * and fail the next.
 */

test.describe.configure({ mode: 'serial' })

const MESSAGE = 'Vi lukker kl. 18 i dag — tak for i dag'
const DRAFTED = 'Lukket onsdag — privat arrangement'

const EXPIRY_DATE = copenhagenDate(1)
const EXPIRY_TIME = '20:00'

/**
 * A public address that is **rendered on every request**, for the reason
 * `announcement.spec.ts` gives: the six ordinary pages are statically generated and
 * revalidate every five minutes (§7a), so only a dynamic address proves that a removal
 * reached the hjemmeside *at once*.
 */
const ALWAYS_FRESH_PATH = '/en-side-der-ikke-findes'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

let staffPage: Page

/**
 * Wait for a guest to be given the bar again.
 *
 * **The two directions of this operation are asserted differently, on purpose.**
 *
 * A bar *going* is the safety-critical direction — 1ad: *"En forkert besked skal kunne
 * stoppes med det samme"* — so every removal in this file is read **single-shot**: the
 * guest's very next request must already have no bar, and a poll there would hide
 * precisely the defect that matters.
 *
 * A bar *coming back* is the convenience direction, and reading it single-shot measures
 * the cache rather than the phase. `updateTag` expires the entry when the transaction
 * commits, but the refreshed entry is written by the request that finds it stale, and a
 * request arriving inside that window is served the entry as it stood. That is the same
 * reason the setup scenario at the top of this file polls, and it says so there in its
 * own words. What is asserted is that the **same published message** comes back without
 * a publish — not how many milliseconds the local cache handler takes.
 */
async function expectGuestShows(browser: Browser, message: string): Promise<void> {
  await expect
    .poll(async () => (await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).message ?? '', {
      intervals: [100, 250, 500, 1_000],
      message: 'the published announcement is on the hjemmeside again',
      timeout: 15_000,
    })
    .toContain(message)
}

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/**
 * Publish the live message these scenarios act on, from **whatever** state the row is in.
 *
 * Two publishes, and the first one is the point. Offentliggør is what sets `is_visible`
 * (§0f), and it only runs when there is a draft to publish — a save that changes nothing
 * writes no draft (§4), so publishing after it is a no-op. That is fine from the state
 * `announcement.spec.ts` leaves (expired, so the expiry is always a real change) and not
 * fine from the state an *interrupted* run of this file leaves: the same message, already
 * switched off, with a future expiry. A setup that could not reach "published and
 * visible" from that state would fail on the row it had itself produced.
 *
 * So the first publish carries a message no row can already hold, which guarantees a
 * draft and therefore guarantees `is_visible`; the second one puts the suite's own
 * message live on top of it.
 */
async function publishLiveAnnouncement(page: Page, message = MESSAGE): Promise<void> {
  await openAnnouncementAdmin(page)

  for (const text of [`Opsætning ${Date.now()}`, message]) {
    await saveAnnouncement(page, {
      message: text,
      link: 'Intet link',
      address: '',
      linkLabel: '',
      expiryChip: 'Vælg selv',
      date: EXPIRY_DATE,
      time: EXPIRY_TIME,
    })
    await publishAnnouncement(page)
  }

  await expect(pendingBand(page)).toHaveCount(0)
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
// 1–2. A live announcement, and the controls 1ad draws for taking it down
// ---------------------------------------------------------------------------

test('a published announcement is on the hjemmeside', async ({ browser }) => {
  await publishLiveAnnouncement(staffPage)

  /*
   * Polled, and deliberately the only guest assertion in this file that is. This scenario
   * establishes the *starting state*; it is not the claim. The claim — that a removal
   * reaches the hjemmeside **at once** — is asserted single-shot further down, where it
   * belongs. Setting the state takes two publishes in quick succession (see
   * `publishLiveAnnouncement`), and holding the setup to the same instant-visibility bar
   * as the operation under test would be testing the cache rather than the phase.
   */
  await expect
    .poll(async () => (await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).message ?? '', {
      intervals: [250, 500, 1_000, 2_000],
      message: 'the published announcement reaches the public site',
      timeout: 15_000,
    })
    .toContain(MESSAGE)

  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)

  expect(guest.present).toBe(true)
  // §12: the public visitor still receives no cookies. Phase 7B adds none.
  expect(guest.cookies).toBe(0)
})

test('the editor now draws both of 1ad’s immediate controls', async () => {
  await openAnnouncementAdmin(staffPage)

  await expect(visibilityCard(staffPage)).toBeVisible()
  await expect(removeNowButton(staffPage)).toBeVisible()

  // 1ad's own helper line, and the state said in words rather than by the switch's colour.
  await expect(visibilityCard(staffPage)).toContainText(/Slå fra, og/)
  await expect(stateBanner(staffPage)).toContainText('Fjern beskeden nu')
})

test('both controls are two entrances to one operation', async () => {
  await openAnnouncementAdmin(staffPage)

  const fromSwitch = await formFields(visibilityCard(staffPage))
  const fromButton = await formFields(removeNowButton(staffPage))

  // Same names, same requested state, same version token — so there is one business
  // operation behind two drawings of it, not two implementations to keep in step.
  expect(fromSwitch).toEqual(fromButton)
  expect(Object.keys(fromSwitch).sort()).toEqual(['version', 'vis'])
  expect(fromSwitch.vis, 'both ask for the off direction').toBe('0')

  // And they dispatch to the same Server Action, by its own identifier.
  const switchAction = await formActionId(visibilityCard(staffPage))
  expect(switchAction, 'the switch posts to a Server Action').not.toBeNull()
  expect(await formActionId(removeNowButton(staffPage))).toBe(switchAction)
})

test('neither control carries a message, a link, an expiry, a source or a replacement', async () => {
  await openAnnouncementAdmin(staffPage)

  for (const fields of [
    await formFields(visibilityCard(staffPage)),
    await formFields(removeNowButton(staffPage)),
  ]) {
    for (const forbidden of [
      'besked',
      'message',
      'link',
      'adresse',
      'linktekst',
      'udloeb',
      'udloeb_dato',
      'expires_at',
      'source',
      'previous',
      'replaced_at',
      'draft',
      'entity',
      'id',
    ]) {
      expect(Object.keys(fields), `no field is called ${forbidden}`).not.toContain(forbidden)
    }
  }
})

test('the screen with the removal controls has no accessibility violations', async () => {
  await openAnnouncementAdmin(staffPage)

  expect(await violations(staffPage)).toEqual([])
})

test('every removal control is at least 44 px, at this width', async () => {
  await openAnnouncementAdmin(staffPage)

  for (const control of [
    visibilityCard(staffPage).getByRole('button'),
    removeNowButton(staffPage),
  ]) {
    const box = await control.boundingBox()
    expect(box?.height ?? 0, '1aa: tryk-mål mindst 44 × 44 px').toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  }
})

test('the removal controls take a visible focus ring from the keyboard', async () => {
  await openAnnouncementAdmin(staffPage)

  const ring = await removeNowButton(staffPage).evaluate((element) => {
    ;(element as HTMLElement).focus()
    const style = getComputedStyle(element)

    return {
      visible: element.matches(':focus-visible'),
      width: style.outlineWidth,
      style: style.outlineStyle,
    }
  })

  expect(ring.visible, 'a keyboard arrival is :focus-visible').toBe(true)
  expect(parseFloat(ring.width), '1aa: a 3 px focus ring').toBeGreaterThanOrEqual(3)
  expect(ring.style).not.toBe('none')
})

test('the screen does not scroll sideways with the removal controls on it', async () => {
  await openAnnouncementAdmin(staffPage)

  const overflow = await staffPage.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow).toBe(false)
})

test('nor at 768, where the removal card’s row switches to side by side', async () => {
  // 1aa's middle breakpoint, which neither Playwright project runs at: it is where the
  // "Vis besked" card's helper sentence swaps to the desktop wording and where the
  // "Fjern beskeden nu" row stops stacking. A button that could not shrink would push the
  // sentence past the gutter here rather than wrap it — the defect phase 6's completion
  // pass found twice, on two other controls, at exactly this width.
  const projectViewport = staffPage.viewportSize()

  await staffPage.setViewportSize({ width: 768, height: 1024 })
  await openAnnouncementAdmin(staffPage)

  const overflow = await staffPage.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow, 'the removal controls fit 768 px').toBe(false)

  for (const control of [
    visibilityCard(staffPage).getByRole('button'),
    removeNowButton(staffPage),
  ]) {
    const box = await control.boundingBox()
    expect(box?.height ?? 0, 'no control is under 44 px at 768 either').toBeGreaterThanOrEqual(44)
    // A control label that wrapped would make the button taller than the row it sits in.
    expect(box?.height ?? 0, 'and no control label wraps at 768').toBeLessThan(72)
  }

  if (projectViewport !== null) await staffPage.setViewportSize(projectViewport)
})

// ---------------------------------------------------------------------------
// 3–8. "Fjern beskeden nu" → immediate removal → Fortryd → the same bar back
// ---------------------------------------------------------------------------

test('"Fjern beskeden nu" takes the bar off the hjemmeside at once', async ({ browser }) => {
  await openAnnouncementAdmin(staffPage)
  await pressRemoveNow(staffPage)

  // Immediately, with no publish in between: the guest's next request already has no bar.
  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)

  expect(guest.present).toBe(false)
  // 1ac: "Bjælken er ikke skjult med et tomt felt: den findes ikke i siden."
  expect(guest.height).toBe(0)
  expect(guest.headerTop).toBe(0)
})

test('it created no draft, and the screen says what is true', async () => {
  // §6: the immediate path never travels through a draft. Nothing is pending afterwards,
  // so nothing is waiting to be published and the Kladde band is absent.
  await expect(pendingBand(staffPage)).toHaveCount(0)

  await expect(stateBanner(staffPage)).toContainText('slået fra')

  // There is no longer a bar to remove, so the footer control is gone — 1ac's rule for
  // the bar applied to the control that takes it down.
  await expect(removeNowButton(staffPage)).toHaveCount(0)

  // The switch stays, in its off position, because the published message is still
  // current and may be shown again as it stands (§0h). It asks for the on direction now.
  await expect(visibilityCard(staffPage)).toBeVisible()
  expect(await visibilitySwitchDirection(staffPage)).toBe('on')
  await expect(visibilityCard(staffPage)).toContainText('Slå til, og den vises igen straks')

  // And the banner names the way back without claiming a publish is needed for it.
  await expect(stateBanner(staffPage)).toContainText('Skal den samme besked frem igen')
  await expect(stateBanner(staffPage)).toContainText('offentliggør ikke en kladde')
})

test('a green undo strip reports it, politely and without taking focus', async () => {
  const strip = undoStrip(staffPage)

  await expect(strip).toBeVisible()
  await expect(strip).toContainText('Beskeden er fjernet fra hjemmesiden.')

  // 1aa: "De stjæler aldrig tastaturfokus."
  expect(await staffPage.evaluate(() => document.activeElement?.tagName ?? null)).toBe('BODY')

  // role="status" is polite by definition — asserted through the role the strip is found by.
  await expect(strip).toHaveAttribute('role', 'status')

  const box = await undoButton(staffPage).boundingBox()
  expect(box?.height ?? 0, 'Fortryd is a 44 px target').toBeGreaterThanOrEqual(44)
})

test('the undo strip asks for visibility and for nothing else', async () => {
  const fields = await formFields(undoButton(staffPage))

  expect(Object.keys(fields).sort()).toEqual(['version', 'vis'])
  expect(fields.vis, 'Fortryd asks for the bar back').toBe('1')
})

test('the removal and its Fortryd are real form posts, so they work without JavaScript', async () => {
  /*
   * §9's rule for the undo strip: *"still usable without JavaScript"*, and 1aa's for the
   * strip itself: the timer is an enhancement, never the mechanism.
   *
   * **This reads the server's HTML, not the hydrated DOM**, and the difference is the
   * whole assertion. A visitor with scripting off never hydrates; what they get is the
   * document as it left the server, and there every Server Action form is an ordinary
   * `method="POST"` with the framework's dispatch id in a hidden field. React later
   * rewrites the attributes of a form that sits inside a client boundary — the Fortryd
   * form is inside `AutoDismiss` — so reading `form.method` from the live page would
   * measure hydration and report `get`, which says nothing about the person this rule is
   * for.
   *
   * So the page is fetched with the same session and parsed as text. Every form on it
   * must post: the "Vis besked" switch, "Fjern beskeden nu", the editor's Gem, the bar's
   * Offentliggør and the Fortryd.
   */
  const version = await staffPage.locator('input[name="version"]').first().inputValue()

  const response = await staffPage.request.get(
    `${ANNOUNCEMENT_ADMIN_PATH}?fortryd_version=${encodeURIComponent(version)}&fortryd_vis=1`,
  )
  expect(response.ok()).toBe(true)

  const forms = [...(await response.text()).matchAll(/<form[^>]*>/g)].map((match) => match[0])

  // The bar's Offentliggør, the editor's Gem and the Fortryd, at the very least — and the
  // two removal controls whenever there is a bar to remove.
  expect(forms.length, 'the screen is made of forms').toBeGreaterThanOrEqual(3)

  for (const form of forms) {
    expect(form, 'every form on this screen posts').toContain('method="POST"')
    expect(form, 'and none of them is script-only').not.toContain('javascript:')
  }
})

test('the screen showing the undo strip has no accessibility violations', async () => {
  expect(await violations(staffPage)).toEqual([])
})

test('Fortryd puts the same bar back', async ({ browser }) => {
  await pressUndo(staffPage)

  await expectGuestShows(browser, MESSAGE)

  // The same published announcement, not a new one: still nothing pending, and the
  // switch reads as showing again — so a press would now take it *down* (§0h).
  await expect(pendingBand(staffPage)).toHaveCount(0)
  expect(await visibilitySwitchDirection(staffPage)).toBe('off')
  await expect(removeNowButton(staffPage)).toBeVisible()
})

// ---------------------------------------------------------------------------
// 9. The other entrance — 1ad's "Vis besked" switch
// ---------------------------------------------------------------------------

test('turning "Vis besked" off does exactly the same thing', async ({ browser }) => {
  await openAnnouncementAdmin(staffPage)
  await pressVisibilitySwitch(staffPage)

  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present).toBe(false)

  await expect(undoStrip(staffPage)).toContainText('Beskeden er fjernet fra hjemmesiden.')
  await expect(pendingBand(staffPage)).toHaveCount(0)

  await pressUndo(staffPage)
  await expectGuestShows(browser, MESSAGE)
})

// ---------------------------------------------------------------------------
// 9b. The way back once the Fortryd is gone — "Vis besked" on (§0h)
// ---------------------------------------------------------------------------

test('the same published message comes back once the Fortryd has gone', async ({
  browser,
}) => {
  /*
   * The behaviour phase 7's completion pass added, and the one §0g reading A recorded as
   * a limitation: after the ten seconds, putting the same message back used to mean
   * editing it and pressing Offentliggør. It no longer does — the switch itself moves the
   * visibility of the **already published** announcement in both directions.
   *
   * The Fortryd is allowed to disappear on its own here rather than being navigated away
   * from, because "the offer has gone" is the precondition this scenario is about.
   */
  await openAnnouncementAdmin(staffPage)
  await pressVisibilitySwitch(staffPage)

  await expect(undoStrip(staffPage)).toBeVisible()
  // 1aa: ten seconds, because the message carries Fortryd. It is not the boundary of
  // anything — it is simply gone, and the announcement is still hidden.
  await expect(undoStrip(staffPage)).toHaveCount(0, { timeout: 20_000 })

  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present).toBe(false)

  // The switch is still there, now asking for the on direction.
  expect(await visibilitySwitchDirection(staffPage)).toBe('on')
  await expect(removeNowButton(staffPage)).toHaveCount(0)

  await pressVisibilitySwitch(staffPage)

  // And it is the same published announcement — not a republished one.
  await expectGuestShows(browser, MESSAGE)

  // No publish happened: nothing was pending before and nothing is pending after, and
  // the strip reports a restore rather than an Offentliggør.
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(undoStrip(staffPage)).toContainText('Beskeden vises igen på hjemmesiden.')

  // And the screen is back in its showing state, with both removal controls on it.
  expect(await visibilitySwitchDirection(staffPage)).toBe('off')
  await expect(removeNowButton(staffPage)).toBeVisible()
})

test('the re-show is the same two fields, and it is axe-clean', async () => {
  await openAnnouncementAdmin(staffPage)
  await pressVisibilitySwitch(staffPage)
  await openAnnouncementAdmin(staffPage)

  const fields = await formFields(visibilityCard(staffPage))
  expect(Object.keys(fields).sort()).toEqual(['version', 'vis'])
  expect(fields.vis, 'the off switch asks for the bar back').toBe('1')

  // No content of any kind travels with a re-show: that is what makes "showing the bar
  // again cannot publish a draft" a property of the form rather than of a check.
  for (const forbidden of [
    'besked',
    'message',
    'link',
    'adresse',
    'linktekst',
    'udloeb',
    'udloeb_dato',
    'expires_at',
    'source',
    'previous',
    'replaced_at',
    'draft',
    'entity',
    'id',
  ]) {
    expect(Object.keys(fields), `no field is called ${forbidden}`).not.toContain(forbidden)
  }

  const box = await visibilityCard(staffPage).getByRole('button').boundingBox()
  expect(box?.height ?? 0, '1aa: tryk-mål mindst 44 × 44 px').toBeGreaterThanOrEqual(44)

  expect(await violations(staffPage)).toEqual([])

  // Put the bar back for the scenarios after this one.
  await pressVisibilitySwitch(staffPage)
  expect(await visibilitySwitchDirection(staffPage)).toBe('off')
})

test('the whole removal and undo is operable from the keyboard alone', async ({ browser }) => {
  await openAnnouncementAdmin(staffPage)

  await removeNowButton(staffPage).focus()
  await staffPage.keyboard.press('Enter')

  await expect(undoStrip(staffPage)).toBeVisible()
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present).toBe(false)

  await undoButton(staffPage).focus()
  await staffPage.keyboard.press('Enter')

  /*
   * Polled on the switch's *direction* rather than on its presence. Since §0h the card is
   * on the screen in both states, so "the card is visible" no longer distinguishes a
   * restored bar from a removed one — and asserting it would resolve before the undo's
   * redirect had landed. `'off'` is the direction a press would move a bar that is
   * currently showing, which is the state this scenario is waiting for.
   */
  await expect
    .poll(() => visibilitySwitchDirection(staffPage), {
      message: 'the keyboard undo restores the bar',
    })
    .toBe('off')

  await expectGuestShows(browser, MESSAGE)
})

// ---------------------------------------------------------------------------
// 10. Draft integrity — the property the whole phase turns on
// ---------------------------------------------------------------------------

test('a pending draft survives a removal and its undo, byte for byte', async ({ browser }) => {
  await openAnnouncementAdmin(staffPage)

  // Somebody is halfway through writing the next message when the current one has to go.
  await saveAnnouncement(staffPage, { message: DRAFTED })
  await expect(pendingBand(staffPage)).toBeVisible()

  const draftedBefore = await announcementForm(staffPage).getByLabel('Besked').inputValue()
  expect(draftedBefore).toBe(DRAFTED)

  // The guest is still reading the *published* message — a draft changes nothing (§6).
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).message).toContain(MESSAGE)

  await pressRemoveNow(staffPage)

  // The bar is gone, the draft is not.
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present).toBe(false)
  await expect(pendingBand(staffPage)).toBeVisible()
  await expect(announcementForm(staffPage).getByLabel('Besked')).toHaveValue(DRAFTED)

  await pressUndo(staffPage)

  // The **published** message is back — never the draft, which is still waiting.
  await expectGuestShows(browser, MESSAGE)
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).message).not.toContain(DRAFTED)

  await expect(pendingBand(staffPage)).toBeVisible()
  await expect(announcementForm(staffPage).getByLabel('Besked')).toHaveValue(DRAFTED)

  // Put the draft back where the next scenario expects it: writing the published values
  // again makes the delta empty, which is what clears a draft (§4).
  await saveAnnouncement(staffPage, { message: MESSAGE })
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

test('a manual re-show restores the published message and leaves the draft pending', async ({
  browser,
}) => {
  /*
   * The scenario the whole distinction turns on (§0h): **A is published, B is a pending
   * draft, the bar is switched off and then switched back on.** What must come back is A.
   * B must still be waiting, still previewable, and still reachable only by Offentliggør.
   *
   * If the switch could publish, this is where it would show.
   */
  await openAnnouncementAdmin(staffPage)

  // B, as a draft, on top of the published A.
  await saveAnnouncement(staffPage, { message: DRAFTED })
  await expect(pendingBand(staffPage)).toBeVisible()
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).message).toContain(MESSAGE)

  await pressVisibilitySwitch(staffPage)
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present).toBe(false)

  // The offer is dropped the way a reload drops it (§6), so the press below is the
  // ordinary manual one rather than the Fortryd.
  await openAnnouncementAdmin(staffPage)
  await expect(undoStrip(staffPage)).toHaveCount(0)
  expect(await visibilitySwitchDirection(staffPage)).toBe('on')

  await pressVisibilitySwitch(staffPage)

  // A is back. B is not public and never was.
  await expectGuestShows(browser, MESSAGE)
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).message).not.toContain(DRAFTED)

  // B is still pending, still in the fields, still the thing Forhåndsvis shows.
  await expect(pendingBand(staffPage)).toBeVisible()
  await expect(announcementForm(staffPage).getByLabel('Besked')).toHaveValue(DRAFTED)

  const previewed = await previewHomepage(staffPage)
  expect(previewed.message, 'Forhåndsvis still shows the pending draft').toContain(DRAFTED)

  // And Offentliggør is the only thing that makes B public — which it then does.
  await openAnnouncementAdmin(staffPage)
  await publishAnnouncement(staffPage)
  await expectGuestShows(browser, DRAFTED)

  // Restore the state the scenarios after this one start from: A published and showing,
  // with nothing pending.
  await saveAnnouncement(staffPage, { message: MESSAGE })
  await publishAnnouncement(staffPage)
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expectGuestShows(browser, MESSAGE)
})

// ---------------------------------------------------------------------------
// 11–13. Permissions, concurrency and forged requests (§5, §8)
// ---------------------------------------------------------------------------

test('an Owner may remove and restore the announcement too', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, OWNER)

  await openAnnouncementAdmin(page)
  await pressRemoveNow(page)

  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present).toBe(false)

  await pressUndo(page)
  await expectGuestShows(browser, MESSAGE)

  await context.close()
})

test('an anonymous visitor cannot remove the announcement', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(ANNOUNCEMENT_ADMIN_PATH)
  await expect(page).toHaveURL(/\/admin\/login/)

  // A forged Server Action POST, and a plain form POST carrying the immediate path's own
  // field names. Neither is honoured: the action calls requireStaff() for itself.
  const forgedAction = await page.request.post(ANNOUNCEMENT_ADMIN_PATH, {
    headers: { 'Next-Action': 'forged', 'Content-Type': 'text/plain;charset=UTF-8' },
    data: '[]',
    maxRedirects: 0,
  })
  expect(forgedAction.status()).not.toBe(200)

  await page.request.post(ANNOUNCEMENT_ADMIN_PATH, {
    form: { vis: '0', version: new Date().toISOString() },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0,
    failOnStatusCode: false,
  })

  // The bar is exactly where it was.
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).message).toContain(MESSAGE)

  await context.close()
})

test('a colleague’s change makes a stale removal a conflict, not an overwrite', async ({
  browser,
}) => {
  // The staff member opens the screen, so their forms carry this version of the row.
  await openAnnouncementAdmin(staffPage)

  // A colleague edits it meanwhile, which moves the row on.
  const context = await browser.newContext()
  const colleague = await context.newPage()
  await signIn(colleague, OWNER)
  await openAnnouncementAdmin(colleague)
  await saveAnnouncement(colleague, { message: DRAFTED })

  // The stale press is refused (§6, §7e item 2). Nothing was overwritten.
  await pressRemoveNow(staffPage)

  await expect(staffPage.getByText('Nogen andre har rettet dette')).toBeVisible()
  await expect(undoStrip(staffPage)).toHaveCount(0)

  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).message).toContain(MESSAGE)

  // Clear the colleague's draft again, so the next scenario starts clean.
  await openAnnouncementAdmin(colleague)
  await saveAnnouncement(colleague, { message: MESSAGE })
  await expect(pendingBand(colleague)).toHaveCount(0)

  await context.close()
})

// ---------------------------------------------------------------------------
// 14. The expiry passing inside the Fortryd window — and the state this suite leaves
// ---------------------------------------------------------------------------

test('an expiry that passes before Fortryd is refused, not reported as a restore', async ({
  browser,
}) => {
  /*
   * The one scenario in this file that waits for **real** time. Fortryd is offered for
   * about ten seconds and an expiry can pass inside them; restoring `is_visible` on an
   * expired row would put `true` into a column the anonymous policy goes on filtering
   * out, and the screen would report a bar put back that no guest can read.
   *
   * 90 seconds rather than 60, because the time field is `HH:MM` and the instant it names
   * is truncated to the whole minute: 90 seconds ahead leaves between 30 and 90 seconds,
   * long enough that the publish cannot be refused as already-past and short enough to
   * wait for. The same arithmetic `announcement.spec.ts` uses for the same reason.
   */
  test.setTimeout(240_000)

  await openAnnouncementAdmin(staffPage)

  const soon = new Date(Date.now() + 90_000)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(soon)

  await saveAnnouncement(staffPage, {
    message: MESSAGE,
    expiryChip: 'Vælg selv',
    date: copenhagenDate(0),
    time,
  })
  await publishAnnouncement(staffPage)
  await expect(pendingBand(staffPage)).toHaveCount(0)

  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present).toBe(true)

  await pressRemoveNow(staffPage)
  expect((await guestAnnouncement(browser, ALWAYS_FRESH_PATH)).present).toBe(false)

  // The offer is on screen. Now let the message expire underneath it.
  await expect(undoStrip(staffPage)).toBeVisible()

  /*
   * The signal that the expiry has passed, read from the screen rather than from a clock:
   * with nothing pending, Offentliggør is decided by the published row alone, so it is
   * available while the message is still current and greyed out — with 1ad's own
   * explanation — the moment it is not.
   *
   * The state banner is deliberately *not* the signal. A removed message is reported as
   * "slået fra" whether or not it has also expired, which is the right sentence for a
   * person and the wrong one for this poll.
   */
  await expect
    .poll(
      async () => {
        await openAnnouncementAdmin(staffPage)
        return publishButton(staffPage).isDisabled()
      },
      {
        intervals: [5_000],
        message: 'the message expires while the screen is open',
        timeout: 180_000,
      },
    )
    .toBe(true)

  /*
   * The switch offers no press at all now: `isAnnouncementRestorable` is false, so the
   * screen states the reason instead of drawing a press `set_announcement_visible()`
   * would refuse with `not_showable` (§0h). An expired message needs a **new expiry**,
   * and an expiry is content, so the way past it is the three steps.
   */
  await expect(visibilityCard(staffPage)).toHaveCount(0)
  await expect(visibilityUnavailableCard(staffPage)).toBeVisible()
  await expect(visibilityUnavailableCard(staffPage)).toContainText('Beskeden er udløbet')
  await expect(visibilityUnavailableCard(staffPage)).toContainText('Offentliggør')
  expect(await violations(staffPage)).toEqual([])

  /*
   * The strip is gone from this reload, which is exactly §6's rule — "if the browser
   * navigates away inside the 10 seconds the undo is lost". So the refusal is provoked
   * the way a stale tab would provoke it: by pressing an on-direction write the server no
   * longer has a reason to honour. The timeout is not the boundary; the rule is, and the
   * same refusal answers a forged "Vis besked" press from a stale screen.
   */
  const expiredVersion = await staffPage.locator('input[name="version"]').first().inputValue()

  await staffPage.goto(
    `${ANNOUNCEMENT_ADMIN_PATH}?fortryd_version=${encodeURIComponent(
      expiredVersion,
    )}&fortryd_vis=1`,
  )

  await expect(undoStrip(staffPage)).toBeVisible()
  await pressUndo(staffPage)

  await expect(staffPage.getByText('Beskeden er udløbet, så den kunne ikke vises igen')).toBeVisible()

  // Nothing came back. An expired message is not made publicly eligible by asking for it.
  const guest = await guestAnnouncement(browser, ALWAYS_FRESH_PATH)
  expect(guest.present).toBe(false)
  expect(guest.height).toBe(0)
  expect(guest.headerTop).toBe(0)

  // And this is the state the next run starts from: published, expired, switched off,
  // nothing pending — so Offentliggør is greyed out and a guest reads nothing.
  await openAnnouncementAdmin(staffPage)
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(publishButton(staffPage)).toBeDisabled()
  await expect(stateBanner(staffPage)).toBeVisible()
})
