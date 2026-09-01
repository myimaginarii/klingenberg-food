import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  clearMonthlyFields,
  copenhagenDate,
  expiredDialog,
  guestBurger,
  homepageToggle,
  isSoldOut,
  monthlyForm,
  monthlyVersion,
  openMonthlyAdmin,
  openMonthlyAdminFromMenu,
  pendingBand,
  pressAndSettle,
  pressPublish,
  pressUndo,
  previewHomepage,
  previewMenu,
  publishExpiredMonthly,
  publishMonthly,
  saveMonthly,
  setHomepageChecked,
  setShowOnHomepage,
  stateBanner,
  toggleAvailability,
  undoStrip,
  MONTHLY_ADMIN_PATH,
} from './support/monthly-admin'

/**
 * Månedens burger — design 1ah (the editor), 1h/1m and the Forside section (every public
 * state); phase 6B, technical plan §6, §7b, §7d, §7e item 3.
 *
 * The promise this suite exists for: **the burger is edited as a draft, and a guest sees
 * nothing until somebody presses Offentliggør** — with exactly one exception, which 1ah
 * draws as a switch and labels as immediate — **and the date window then decides whether
 * an already-published burger is currently shown**.
 *
 *     public   no forside section, "ikke oplyst endnu" on the menu   (the seed)
 *     admin    Efterårsburgeren                                      (after Gem)
 *     public   still nothing                                         (still)
 *     preview  Efterårsburgeren
 *     public   Efterårsburgeren                                      (after Offentliggør)
 *
 * It runs in order and shares one signed-in page, because it is one story. The last
 * scenario puts the empty singleton back and publishes it, so an interrupted run leaves
 * the next one unaffected and the database ends where the seed left it — 1ab lists
 * Månedens burger among the things the restaurant has not supplied, and nothing here may
 * leave an invented burger behind.
 *
 * **Every date is computed from today** (`copenhagenDate`). A suite that hard-coded
 * September would pass in September and fail in October, which is the one way a
 * date-window test can be worse than no test at all.
 */

test.describe.configure({ mode: 'serial' })

const BURGER = {
  name: 'Efterårsburgeren',
  description: 'Bøf, bacon, syltede løg og rygeostcreme.',
  price: '129',
} as const

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
// The empty state — the seeded reality (§7d, phase 6B)
// ---------------------------------------------------------------------------

test('the menu screen leads to the editor, from the section a guest meets it in', async () => {
  await openMonthlyAdminFromMenu(staffPage)

  expect(staffPage.url()).toContain(MONTHLY_ADMIN_PATH)
  await expect(
    staffPage.getByRole('heading', { level: 1, name: 'Månedens burger' }),
  ).toBeVisible()
  // Back to where they came from, as the frame's "‹ Rediger menu" promises.
  await expect(staffPage.getByRole('link', { name: 'Rediger menu' })).toBeVisible()
})

test('the editor works against an unconfigured singleton, with no placeholder row', async () => {
  await openMonthlyAdmin(staffPage)

  // 1ah's own fields, and no others. The photo slot exists since 10C-1 as its own
  // sibling control — a link that opens the picker, never a field of this form —
  // and with nothing selected no image field is submitted by anything.
  for (const label of ['Navn', 'Beskrivelse', 'Pris (kr.)', 'Startdato', 'Slutdato']) {
    await expect(monthlyForm(staffPage).getByLabel(label, { exact: true })).toBeVisible()
  }
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toBeVisible()
  const fieldNames = await staffPage
    .locator('main input, main select, main textarea')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('name')))
  expect(fieldNames).not.toContain('billede')
  expect(fieldNames).not.toContain('image_id')

  // Every field is empty, and nothing had to be seeded to make that true.
  for (const label of ['Navn', 'Beskrivelse', 'Pris (kr.)', 'Startdato', 'Slutdato']) {
    await expect(monthlyForm(staffPage).getByLabel(label, { exact: true })).toHaveValue('')
  }

  await expect(stateBanner(staffPage)).toContainText('Ikke udfyldt')
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

test('the empty editor has no accessibility violations', async () => {
  await openMonthlyAdmin(staffPage)

  expect(await violations(staffPage)).toEqual([])
})

test('the forside says nothing about a burger nobody has written', async ({ browser }) => {
  const guest = await guestBurger(browser)

  expect(guest.homepageHeading).toBeNull()
  // The menu keeps its own approved empty card (1h). The two rules are different, and
  // this is where the difference is visible.
  expect(guest.menuCard).toContain('ikke oplyst endnu')
  expect(guest.featuredCount).toBe(3)
})

// ---------------------------------------------------------------------------
// The withdrawn 1ah wording — §7e item 3
// ---------------------------------------------------------------------------

test('the forside toggle explains its own section, and never a slot in Tre fra menuen', async () => {
  await openMonthlyAdmin(staffPage)

  const help = monthlyForm(staffPage).getByText(/Vises som sit eget afsnit på forsiden/)
  await expect(help).toBeVisible()

  // The rule that was withdrawn on 29 August 2026. If this string ever reappears
  // anywhere on the screen, the old slot-3 behaviour has come back with it.
  await expect(staffPage.getByText(/Optager en af de tre pladser/)).toHaveCount(0)
  await expect(staffPage.getByText(/Tre fra menuen/)).toHaveCount(1)
})

// ---------------------------------------------------------------------------
// Normal content: Kladde → Forhåndsvis → Offentliggør (§6)
// ---------------------------------------------------------------------------

test('saving writes a draft and leaves both public pages exactly as they were', async ({
  browser,
}) => {
  await openMonthlyAdmin(staffPage)

  await setHomepageChecked(staffPage, true)
  await saveMonthly(staffPage, {
    Navn: BURGER.name,
    Beskrivelse: BURGER.description,
    'Pris (kr.)': BURGER.price,
    Startdato: copenhagenDate(-1),
    Slutdato: copenhagenDate(30),
  })

  await expect(staffPage.getByRole('status').first()).toContainText('gemt som kladde')
  await expect(pendingBand(staffPage)).toBeVisible()
  await expect(pendingBand(staffPage)).toContainText('navn')

  // The card carries the Kladde badge, and the bar's own badge says Kladde rather than
  // the published state — because what is on screen is not what a guest can see.
  await expect(staffPage.getByRole('banner')).toContainText('Kladde')

  // The state banner still describes the PUBLISHED row, which is still nothing.
  await expect(stateBanner(staffPage)).toContainText('Ikke udfyldt')

  const guest = await guestBurger(browser)
  expect(guest.homepageHeading).toBeNull()
  expect(guest.menuCard).toContain('ikke oplyst endnu')
})

test('a populated draft has no accessibility violations', async () => {
  await openMonthlyAdmin(staffPage)

  expect(await violations(staffPage)).toEqual([])
})

test('Forhåndsvis shows the draft on both pages it will appear on', async () => {
  await openMonthlyAdmin(staffPage)

  expect(await previewHomepage(staffPage)).toContain(BURGER.name)
  expect(await previewMenu(staffPage)).toContain(BURGER.name)
})

test('Offentliggør puts it on the menu and in the forside’s own section', async ({
  browser,
}) => {
  await publishMonthly(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText('opdateret på hjemmesiden')
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(stateBanner(staffPage)).toContainText('Vises nu')

  const guest = await guestBurger(browser)
  expect(guest.homepageHeading).toBe(BURGER.name)
  expect(guest.menuCard).toContain(BURGER.name)
  expect(guest.menuCard).toContain('129 kr.')
  // The three featured dishes are still three. Publishing the burger displaced nothing.
  expect(guest.featuredCount).toBe(3)
})

// ---------------------------------------------------------------------------
// The homepage toggle is a normal draft field (§7d, §7e item 3)
// ---------------------------------------------------------------------------

test('turning "Vis på forsiden" off is a draft: the forside is unchanged until publish', async ({
  browser,
}) => {
  await openMonthlyAdmin(staffPage)
  await setShowOnHomepage(staffPage, false)

  await expect(pendingBand(staffPage)).toContainText('visning på forsiden')

  // Still published as it was, so the guest still has the section.
  const before = await guestBurger(browser)
  expect(before.homepageHeading).toBe(BURGER.name)

  // …and the preview already reflects the new setting.
  const preview = await previewHomepage(staffPage)
  expect(preview).not.toContain(BURGER.name)

  // The menu card is not gated by the toggle, and the preview proves the two rules are
  // separate rather than one.
  expect(await previewMenu(staffPage)).toContain(BURGER.name)
})

test('publishing the toggle removes the forside section and keeps the menu card', async ({
  browser,
}) => {
  await publishMonthly(staffPage)

  await expect(stateBanner(staffPage)).toContainText('slået fra')

  const guest = await guestBurger(browser)
  expect(guest.homepageHeading).toBeNull()
  expect(guest.menuCard).toContain(BURGER.name)
  expect(guest.featuredCount).toBe(3)
})

test('turning it back on restores the section, again only on publish', async ({ browser }) => {
  await openMonthlyAdmin(staffPage)
  await setShowOnHomepage(staffPage, true)

  expect((await guestBurger(browser)).homepageHeading).toBeNull()

  await publishMonthly(staffPage)

  const guest = await guestBurger(browser)
  expect(guest.homepageHeading).toBe(BURGER.name)
  expect(guest.featuredCount).toBe(3)
})

// ---------------------------------------------------------------------------
// Draft integrity (§4)
// ---------------------------------------------------------------------------

test('a pending price survives a change to the forside toggle, and the reverse', async () => {
  await openMonthlyAdmin(staffPage)

  await saveMonthly(staffPage, { 'Pris (kr.)': '139' })
  await expect(pendingBand(staffPage)).toContainText('pris')

  await setShowOnHomepage(staffPage, false)
  await expect(pendingBand(staffPage)).toContainText('pris')
  await expect(pendingBand(staffPage)).toContainText('visning på forsiden')

  // The other direction: a pending toggle survives a description edit.
  await saveMonthly(staffPage, { Beskrivelse: 'Ny beskrivelse til kladden.' })
  await expect(pendingBand(staffPage)).toContainText('visning på forsiden')
  await expect(pendingBand(staffPage)).toContainText('beskrivelse')

  // And putting everything back where it was clears the draft entirely, rather than
  // leaving a Kladde badge on a card with nothing waiting (§4).
  await setShowOnHomepage(staffPage, true)
  await saveMonthly(staffPage, {
    'Pris (kr.)': BURGER.price,
    Beskrivelse: BURGER.description,
  })
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

test('"Ryd felterne" empties the words and leaves the period and the toggle alone', async () => {
  await openMonthlyAdmin(staffPage)

  await clearMonthlyFields(staffPage)

  await expect(monthlyForm(staffPage).getByLabel('Navn', { exact: true })).toHaveValue('')
  await expect(monthlyForm(staffPage).getByLabel('Pris (kr.)', { exact: true })).toHaveValue('')
  await expect(monthlyForm(staffPage).getByLabel('Startdato', { exact: true })).toHaveValue(
    copenhagenDate(-1),
  )
  await expect(homepageToggle(staffPage)).toBeChecked()

  // It is a draft: the hjemmeside still has the burger.
  await expect(stateBanner(staffPage)).toContainText('Vises nu')

  // Put it back, so the rest of the suite has a burger to work with.
  await saveMonthly(staffPage, {
    Navn: BURGER.name,
    Beskrivelse: BURGER.description,
    'Pris (kr.)': BURGER.price,
  })
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// The immediate Udsolgt path (§6, §7b)
// ---------------------------------------------------------------------------

test('Udsolgt goes live at once, and the burger stays on both pages', async ({ browser }) => {
  await openMonthlyAdmin(staffPage)
  expect(await isSoldOut(staffPage)).toBe(false)

  await toggleAvailability(staffPage)

  expect(await isSoldOut(staffPage)).toBe(true)
  await expect(undoStrip(staffPage)).toContainText('markeret som udsolgt')
  // The immediate path writes no draft, so nothing is waiting to be published.
  await expect(pendingBand(staffPage)).toHaveCount(0)

  const guest = await guestBurger(browser)
  expect(guest.homepageHeading).toBe(BURGER.name)
  expect(guest.homepageSoldOut).toBe(true)
  // §7d: the ordering action is withdrawn rather than dimmed.
  expect(guest.homepageOrderCta).toBe(false)
  expect(guest.menuSoldOut).toBe(true)
  expect(guest.featuredCount).toBe(3)
})

test('the sold-out state has no accessibility violations, and the strip takes no focus', async () => {
  /*
   * 1aa: *"De stjæler aldrig tastaturfokus."* The strip is `role="status"`, so it is
   * announced politely and nothing in it is focused — the Fortryd button has to be
   * tabbed to like any other control, which is what stops a message that appears
   * under somebody's hands from swallowing their next keystroke.
   *
   * The assertion is "focus is not *inside* the strip" rather than "focus is still on
   * the switch": the action answers with a redirect, and a full navigation resets focus
   * to the document by the platform's own rules. That is the browser, not this strip.
   */
  await expect(undoStrip(staffPage)).toBeVisible()

  const focusInsideStrip = await undoStrip(staffPage).evaluate((node) =>
    node.contains(document.activeElement),
  )
  expect(focusInsideStrip).toBe(false)

  expect(await violations(staffPage)).toEqual([])
})

test('Fortryd is a second write that puts it back', async ({ browser }) => {
  await pressUndo(staffPage)

  expect(await isSoldOut(staffPage)).toBe(false)
  await expect(pendingBand(staffPage)).toHaveCount(0)

  const guest = await guestBurger(browser)
  expect(guest.homepageSoldOut).toBe(false)
  expect(guest.homepageOrderCta).toBe(true)
  expect(guest.menuSoldOut).toBe(false)
})

test('a stale version token is refused rather than overwriting a colleague', async () => {
  await openMonthlyAdmin(staffPage)

  // A second page saves, which moves `updated_at` under the first one's feet.
  const other = await staffPage.context().newPage()
  await other.goto(MONTHLY_ADMIN_PATH)
  await saveMonthly(other, { Beskrivelse: 'Rettet af en kollega.' })
  await other.close()

  // The first page is still holding the version it was rendered from.
  await pressAndSettle(staffPage, () =>
    monthlyForm(staffPage).getByRole('button', { name: 'Gem' }).click(),
  )

  await expect(staffPage.getByRole('status').first()).toContainText('Nogen andre har rettet dette')

  // Put the description back and clear the colleague's draft.
  await openMonthlyAdmin(staffPage)
  await saveMonthly(staffPage, { Beskrivelse: BURGER.description })
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Scheduling forward — §7d
// ---------------------------------------------------------------------------

test('a future start publishes, and the admin says exactly when it will appear', async ({
  browser,
}) => {
  await openMonthlyAdmin(staffPage)

  await saveMonthly(staffPage, {
    Startdato: copenhagenDate(20),
    Slutdato: copenhagenDate(50),
  })

  await publishMonthly(staffPage)

  // Not an error, and not a question: §7d calls this the intended workflow.
  await expect(staffPage.getByRole('status').first()).toContainText('den vises fra')
  await expect(stateBanner(staffPage)).toContainText('Offentliggjort — vises fra')

  // And it is genuinely not on the hjemmeside yet.
  const guest = await guestBurger(browser)
  expect(guest.homepageHeading).toBeNull()
  expect(guest.menuCard).toContain('ikke oplyst endnu')
  expect(guest.featuredCount).toBe(3)
})

test('the scheduled state has no accessibility violations', async () => {
  await openMonthlyAdmin(staffPage)

  expect(await violations(staffPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// An already-finished window — §7d's warning
// ---------------------------------------------------------------------------

test('publishing a window that is already over asks first, and publishes nothing yet', async () => {
  await openMonthlyAdmin(staffPage)

  await saveMonthly(staffPage, {
    Startdato: copenhagenDate(-30),
    Slutdato: copenhagenDate(-1),
  })

  await pressPublish(staffPage)

  await expect(expiredDialog(staffPage)).toBeVisible()
  await expect(expiredDialog(staffPage)).toHaveAccessibleName('Perioden er allerede forbi')
  // The safe choice is focused; the one that publishes anyway is not.
  await expect(expiredDialog(staffPage).getByRole('link', { name: 'Ret perioden' })).toBeFocused()

  // Nothing was published: the draft is still waiting.
  await expect(pendingBand(staffPage)).toBeVisible()
})

test('the expired warning has no accessibility violations', async () => {
  expect(await violations(staffPage)).toEqual([])
})

test('the warning does not change the dates it warns about', async () => {
  await openMonthlyAdmin(staffPage)

  await expect(monthlyForm(staffPage).getByLabel('Startdato', { exact: true })).toHaveValue(
    copenhagenDate(-30),
  )
  await expect(monthlyForm(staffPage).getByLabel('Slutdato', { exact: true })).toHaveValue(
    copenhagenDate(-1),
  )
})

test('confirming publishes it, and the public site correctly shows nothing', async ({
  browser,
}) => {
  await publishExpiredMonthly(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText('Perioden er allerede forbi')
  await expect(stateBanner(staffPage)).toContainText('Udløbet den')
  await expect(pendingBand(staffPage)).toHaveCount(0)

  const guest = await guestBurger(browser)
  expect(guest.homepageHeading).toBeNull()
  expect(guest.menuCard).toContain('ikke oplyst endnu')
  expect(guest.featuredCount).toBe(3)
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('an end date before the start date is refused, on the field a person would fix', async () => {
  await openMonthlyAdmin(staffPage)

  await saveMonthly(staffPage, {
    Startdato: copenhagenDate(10),
    Slutdato: copenhagenDate(1),
  })

  const end = monthlyForm(staffPage).getByLabel('Slutdato', { exact: true })
  await expect(end).toHaveAttribute('aria-invalid', 'true')

  const describedBy = (await end.getAttribute('aria-describedby')) ?? ''
  await expect(staffPage.locator(`#${describedBy.split(' ').pop() ?? ''}`)).toContainText(
    'samme dag som eller efter startdatoen',
  )

  // Nothing was written: the burger's published window still says what it said.
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Owner, and the anonymous refusal (§5)
// ---------------------------------------------------------------------------

test('an Owner may edit and publish it too', async ({ browser }) => {
  const context = await browser.newContext()
  const ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)

  await openMonthlyAdmin(ownerPage)
  // A current window as well as the text: the burger is left on the expired one by the
  // scenario above, and this test is about the Owner's permissions rather than about
  // §7d's confirmation, which has its own tests.
  await saveMonthly(ownerPage, {
    Beskrivelse: 'Rettet af ejeren.',
    Startdato: copenhagenDate(-1),
    Slutdato: copenhagenDate(10),
  })
  await expect(pendingBand(ownerPage)).toBeVisible()

  await publishMonthly(ownerPage)
  await expect(pendingBand(ownerPage)).toHaveCount(0)

  await context.close()
})

test('an anonymous visitor is sent to the login screen, not to the editor', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(MONTHLY_ADMIN_PATH)
  await expect(page).toHaveURL(/\/admin\/login/)
  await expect(page.getByRole('form', { name: 'Månedens burger' })).toHaveCount(0)

  await context.close()
})

// ---------------------------------------------------------------------------
// The width this screen is used at (1aa, §15 phase 12)
// ---------------------------------------------------------------------------

test('every control a person presses is at least 44 px', async () => {
  await openMonthlyAdmin(staffPage)

  const small = await staffPage
    .locator('main button, main a[href], main input[type="date"], main label:has(input)')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const box = node.getBoundingClientRect()
          return { name: node.textContent?.trim().slice(0, 24), h: box.height, w: box.width }
        })
        // A control the layout has not laid out is not a target anybody can mis-tap.
        .filter((box) => box.h > 0 && (box.h < 44 || box.w < 44)),
    )

  expect(small).toEqual([])
})

test('the editor does not make the screen scroll sideways', async () => {
  await openMonthlyAdmin(staffPage)

  const overflow = await staffPage.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
  }))

  expect(overflow.body).toBeLessThanOrEqual(overflow.client)
})

test('the whole flow is operable from the keyboard alone', async () => {
  await openMonthlyAdmin(staffPage)

  const name = monthlyForm(staffPage).getByLabel('Navn', { exact: true })
  await name.focus()
  await expect(name).toBeFocused()

  // The forside toggle is a real checkbox: Space flips it, and it is reachable by Tab.
  await homepageToggle(staffPage).focus()
  const before = await homepageToggle(staffPage).isChecked()
  await staffPage.keyboard.press('Space')
  await expect(homepageToggle(staffPage)).toBeChecked({ checked: !before })
  await staffPage.keyboard.press('Space')
  await expect(homepageToggle(staffPage)).toBeChecked({ checked: before })

  // Gem is reachable and submits from the keyboard.
  const save = monthlyForm(staffPage).getByRole('button', { name: 'Gem' })
  await save.focus()
  const version = await monthlyVersion(staffPage)
  await staffPage.keyboard.press('Enter')
  await expect.poll(async () => monthlyVersion(staffPage)).not.toBe(version)
})

// ---------------------------------------------------------------------------
// Leaving the seed as it was found
// ---------------------------------------------------------------------------

test('the singleton is empty again, published, with nothing pending', async ({ browser }) => {
  await openMonthlyAdmin(staffPage)

  await setHomepageChecked(staffPage, false)
  await saveMonthly(staffPage, {
    Navn: '',
    Beskrivelse: '',
    'Pris (kr.)': '',
    Startdato: '',
    Slutdato: '',
  })

  await publishMonthly(staffPage)

  await openMonthlyAdmin(staffPage)
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(stateBanner(staffPage)).toContainText('Ikke udfyldt')
  expect(await isSoldOut(staffPage)).toBe(false)

  const guest = await guestBurger(browser)
  expect(guest.homepageHeading).toBeNull()
  expect(guest.menuCard).toContain('ikke oplyst endnu')
  expect(guest.featuredCount).toBe(3)
})
