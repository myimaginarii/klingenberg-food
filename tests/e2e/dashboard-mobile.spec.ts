import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  openAnnouncementAdmin,
  pendingBand as announcementPendingBand,
  pressRemoveNow,
  pressUndo as pressAnnouncementUndo,
  pressVisibilitySwitch,
  publishAnnouncement,
  saveAnnouncement,
  undoStrip as announcementUndoStrip,
  visibilityCard,
  visibilitySwitchDirection,
} from './support/announcement-admin'
import {
  announcementUndoStrip as hoursAnnouncementUndoStrip,
  pressAnnouncementUndo as pressHoursAnnouncementUndo,
  setAnnouncementWanted,
} from './support/hours-announcement'
import {
  fillOverride,
  firstNormallyClosedDay,
  openOverrideCard,
  overrideForm,
  pressAndSettle as pressOverride,
  removeAllOverrides,
  todayInCopenhagen,
} from './support/hours-override'
import {
  availabilityForm as monthlyAvailabilityForm,
  clearMonthlyFields,
  copenhagenDate,
  monthlyForm,
  pressAndSettle as pressMonthly,
  pressUndo as pressMonthlyUndo,
  publishMonthly,
  saveMonthly,
  undoStrip as monthlyUndoStrip,
} from './support/monthly-admin'
import {
  availabilityForm as weeklyAvailabilityForm,
  pendingBand as weeklyPendingBand,
  pressAndSettle as pressWeekly,
  pressUndo as pressWeeklyUndo,
  publishWeek,
  saveWeek,
  undoStrip as weeklyUndoStrip,
  weekForm,
} from './support/weekly-admin'

/**
 * The administration's dashboard on a phone as the **primary** device — technical plan
 * §15 (phase 12C), designs 1x / 1q, and the foot 1y draws for the screens the dashboard
 * leads to.
 *
 * The locked suites already prove that every editor *works* at 375 px and that the
 * dashboard publishes. This suite proves what only a phone-width walk from the landing
 * screen can: that a member of staff reaches every everyday destination from 1x's tiles
 * with the first ones inside the first screen, that the dashboard states what is true
 * right now from the locked systems, that the band publishes what the registry says is
 * pending, that an immediate action on Ugens ret, Månedens burger, Åbningstider and
 * Besked på hjemmesiden leaves its Fortryd inside the viewport at the moment it starts
 * (measured 115–1,694 px above it before 12C), that Owner-only tiles are the Owner's,
 * that long content wraps, and that the News editor's pinned-bar measurement leaves
 * nothing behind on the way back to the dashboard.
 *
 * One dedicated project (`dashboard-mobile`, 375 × 812 with touch) at the tail of the
 * chain: it publishes Ugens ret, Månedens burger, the announcement and a one-off change,
 * and leaves the seed as the locked suites leave it. Nothing in the locked suites was
 * changed to make room for it beyond the one vocabulary migration 12C records.
 */

test.describe.configure({ mode: 'serial' })

const VIEWPORT = { width: 375, height: 812 } as const

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** 1x's rows, in order, for a Staff member; the Owner's extras are asserted separately. */
const STAFF_TILES = [
  'Rediger menu',
  'Ugens ret',
  'Månedens burger',
  'Skriv en nyhed',
  'Åbningstider',
  'Billeder',
  'Om os',
  'Besked på hjemmesiden',
  'Mad ud af huset',
] as const

const OWNER_ONLY_TILES = ['Rediger forsiden', 'Kontaktoplysninger', 'Brugere'] as const

/** The longest message the announcement accepts — 90 characters, ending in one unbroken run. */
const LONG_MESSAGE = ('Ændrede åbningstider i weekenden på grund af et privat arrangement i hallen ' + 'x'.repeat(90)).slice(0, 90)

const MONTHLY = { name: 'Testburger 12C', description: 'Bøf, bacon og syltede løg.', price: '129' } as const

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/** True when the document is wider than the phone — the thing 1aa forbids. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement
    return root.scrollWidth > root.clientWidth + 1
  })
}

/** Whether a control is wholly inside the 375 × 812 viewport right now. */
async function insideViewport(locator: Locator): Promise<boolean> {
  const box = await locator.boundingBox()
  if (box === null) return false
  return box.y >= 0 && box.y + box.height <= VIEWPORT.height && box.x >= 0 && box.x + box.width <= VIEWPORT.width
}

/** Every visible control in `scope` is at least 44 × 44 px (1aa). */
async function expectTargets44(scope: Locator | Page, what: string): Promise<void> {
  // A checkbox is measured by the label that is its target, as the sr-only chips are.
  const controls = scope.locator('a[href], button:not([hidden]), select, label:has(> input[type=checkbox])')

  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue
    const box = await control.boundingBox()
    const name = ((await control.textContent()) ?? '').trim().slice(0, 30) || '(unnamed)'

    expect(box?.height ?? 0, `${what}: "${name}" is at least 44 px tall`).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0, `${what}: "${name}" is at least 44 px wide`).toBeGreaterThanOrEqual(44)
  }
}

/** The foot (1y) — `NoticeFoot`, sticky to the bottom of the phone screen. */
function foot(page: Page) {
  return page.locator('.admin-foot')
}

/** A strip's Fortryd is where the thumb is: inside the viewport, and a 44 px target. */
async function expectUndoInView(strip: Locator, what: string): Promise<void> {
  await expect(strip, what).toBeVisible()
  expect(await insideViewport(strip), `${what}: the strip is inside the viewport`).toBe(true)
  const undo = strip.getByRole('button', { name: /^Fortryd/ })
  expect(await insideViewport(undo), `${what}: Fortryd is inside the viewport`).toBe(true)
  const box = await undo.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
}

/** The foot never covers a control the browser scrolled into view above it. */
async function expectClearOfFoot(page: Page, control: Locator): Promise<void> {
  const footBox = await foot(page).boundingBox()
  const box = await control.boundingBox()
  if (footBox === null || box === null) return
  expect(box.y + box.height, 'the control ends above the foot').toBeLessThanOrEqual(footBox.y + 1)
}

function tile(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Administrationens områder' }).getByRole('link', { name, exact: true })
}

function backLink(page: Page) {
  return page.getByRole('banner').getByRole('link', { name: /Oversigt|Tilbage|Rediger menu|Nyheder/ })
}

function pendingForm(page: Page) {
  return page.getByRole('form', { name: 'Ændringer der venter' })
}

let staffPage: Page
let ownerPage: Page

test.beforeAll(async ({ browser }) => {
  staffPage = await (await browser.newContext({ viewport: VIEWPORT, hasTouch: true })).newPage()
  ownerPage = await (await browser.newContext({ viewport: VIEWPORT, hasTouch: true })).newPage()
  await signIn(staffPage, STAFF)
  await signIn(ownerPage, OWNER)
})

test.afterAll(async () => {
  await staffPage.context().close()
  await ownerPage.context().close()
})

// ---------------------------------------------------------------------------
// 1–3. The landing screen, as 1x draws it
// ---------------------------------------------------------------------------

test('a staff member lands on 1x: the bar, the question, today, the tiles in order, and no Owner door', async () => {
  await staffPage.goto('/admin')

  await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Hej — hvad vil du lave?')
  await expect(staffPage.getByText(/^(Mandag|Tirsdag|Onsdag|Torsdag|Fredag|Lørdag|Søndag) · (åbent \d{2}:\d{2}–\d{2}:\d{2}|lukket i dag)$/)).toBeVisible()
  await expect(staffPage.getByText('Logget ind som Lokal Medarbejder')).toBeVisible()

  const bar = staffPage.getByRole('banner')
  await expect(bar.getByRole('link', { name: 'Se hjemmesiden' })).toHaveAttribute('href', '/')
  expect(await insideViewport(bar.getByRole('button', { name: 'Log ud' }))).toBe(true)

  // 1x's rows, in 1x's order — each one link, named by its words.
  const links = staffPage.getByRole('navigation', { name: 'Administrationens områder' }).getByRole('link')
  await expect(links).toHaveCount(STAFF_TILES.length)
  for (const [index, name] of STAFF_TILES.entries()) {
    await expect(links.nth(index)).toHaveAccessibleName(name)
  }
  for (const name of OWNER_ONLY_TILES) {
    await expect(tile(staffPage, name)).toHaveCount(0)
  }
  await expect(tile(staffPage, 'Åbningstider')).toHaveAccessibleDescription('Ret tider for en dag')

  // The first screen holds the everyday tasks: the menu, both specials and the news.
  for (const name of STAFF_TILES.slice(0, 4)) {
    expect(await insideViewport(tile(staffPage, name)), `"${name}" is in the first screen`).toBe(true)
  }

  expect(await scrollsSideways(staffPage)).toBe(false)
  await expectTargets44(staffPage, 'the dashboard')
  expect(await violations(staffPage)).toEqual([])
})

test('LIGE NU says what is true from the locked systems, and nothing the frames did not draw', async () => {
  const region = staffPage.getByRole('region', { name: 'Lige nu' })
  await expect(region).toBeVisible()

  // 1x's three rows and no other; 1q's news row is in the markup for the wider screen only.
  const rows = region.locator('dt').filter({ visible: true })
  const values = region.locator('dd').filter({ visible: true })
  await expect(rows).toHaveText(['I dag', 'Retter på hjemmesiden', 'Markeret udsolgt'])
  await expect(values.nth(0)).toHaveText(/^(\d{2}:\d{2}–\d{2}:\d{2}|Lukket)$/)
  // The seed's published dishes, counted as the public menu counts them.
  expect(Number.parseInt(await values.nth(1).innerText(), 10)).toBeGreaterThan(0)
  await expect(values.nth(2)).toHaveText(/^\d+$/)

  // 1q's two extra cards are for the wider screen only.
  await expect(staffPage.getByText('Offentliggjorte nyheder')).toBeHidden()
  await expect(staffPage.getByText('Ret kun i dag')).toBeHidden()
})

test('the announcement card reads the published state, and "Rediger besked" is the one way to change it', async () => {
  const card = staffPage.getByRole('region', { name: 'Besked på hjemmesiden' })
  await expect(card).toBeVisible()
  await expect(card.getByText(/^(Vises nu|Slået fra|Udløbet|Ingen besked)$/)).toBeVisible()

  const edit = card.getByRole('link', { name: 'Rediger besked' })
  expect((await edit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  await edit.click()
  await expect(staffPage).toHaveURL(/\/admin\/besked$/)
  await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Besked på hjemmesiden')

  await backLink(staffPage).click()
  await expect(staffPage).toHaveURL(/\/admin$/)
})

// ---------------------------------------------------------------------------
// 4–7. Ugens ret from the tile: the strip, the Fortryd and the notice at the foot
// ---------------------------------------------------------------------------

test('Ugens ret from the tile: Udsolgt leaves its Fortryd in view, on both cards', async () => {
  await tile(staffPage, 'Ugens ret').click()
  await expect(staffPage).toHaveURL(/\/admin\/menu\/ugens-ret/)
  await expect(weekForm(staffPage)).toBeVisible()

  // The week's own card: press, and the strip is at the foot, where the thumb is.
  const weekSwitch = weeklyAvailabilityForm(staffPage, 'Ugens ret').getByRole('button')
  await weekSwitch.scrollIntoViewIfNeeded()
  await pressWeekly(staffPage, () => weekSwitch.click())
  await expectUndoInView(weeklyUndoStrip(staffPage), 'Ugens ret sold out')
  await expect(weeklyUndoStrip(staffPage)).toContainText(/udsolgt/i)
  expect(await violations(staffPage)).toEqual([])
  await pressWeeklyUndo(staffPage)
  await expectUndoInView(weeklyUndoStrip(staffPage), 'Ugens ret restored')
  await expect(weeklyAvailabilityForm(staffPage, 'Ugens ret').getByText('Tilgængelig', { exact: true })).toBeVisible()

  // The Saturday card, 1,700 px down the page: the same foot, the same distance from the thumb.
  const saturdaySwitch = weeklyAvailabilityForm(staffPage, 'Lørdagsmenuen').getByRole('button')
  await saturdaySwitch.scrollIntoViewIfNeeded()
  await pressWeekly(staffPage, () => saturdaySwitch.click())
  await expectUndoInView(weeklyUndoStrip(staffPage), 'Lørdagsmenuen sold out')
  await pressWeeklyUndo(staffPage)
  await expectUndoInView(weeklyUndoStrip(staffPage), 'Lørdagsmenuen restored')

  expect(await scrollsSideways(staffPage)).toBe(false)
  await expectTargets44(foot(staffPage), 'the foot')
})

test('a saved week says so at the foot, keeps its band in flow, and the refusal is in view too', async () => {
  // A price the hjemmeside does not already have, so the save is a draft whatever a
  // stopped earlier run left behind.
  const current = await weekForm(staffPage).getByLabel('Lille portion (kr.)', { exact: true }).inputValue()
  const price = current === '79' ? '81' : '79'
  await saveWeek(staffPage, { 'Lille portion (kr.)': price })

  const notice = staffPage.getByRole('status').filter({ hasText: 'gemt som kladde' })
  await expect(notice).toBeVisible()
  expect(await insideViewport(notice), 'the "gemt" notice is inside the viewport').toBe(true)
  await expect(foot(staffPage)).toBeVisible()
  // The band is a standing state and stays in flow above the cards (12A's editor rule).
  await expect(weeklyPendingBand(staffPage)).toHaveCount(1)
  expect(await scrollsSideways(staffPage)).toBe(false)
  expect(await violations(staffPage)).toEqual([])

  await saveWeek(staffPage, { 'Lille portion (kr.)': 'abc' })
  const refusal = staffPage.getByRole('status').filter({ hasText: 'Ret det, der er markeret' })
  expect(await insideViewport(refusal), 'the refusal is inside the viewport').toBe(true)
  await expect(weekForm(staffPage).getByLabel('Lille portion (kr.)', { exact: true })).toHaveAttribute('aria-invalid', 'true')

  await saveWeek(staffPage, { 'Lille portion (kr.)': price })
})

test('the dashboard band counts the registry, and its Offentliggør publishes it', async () => {
  await backLink(staffPage).click()
  await expect(staffPage).toHaveURL(/\/admin\/menu$/)
  await backLink(staffPage).click()
  await expect(staffPage).toHaveURL(/\/admin$/)

  const form = pendingForm(staffPage)
  await expect(form).toBeVisible()
  await expect(form.getByText('Én ændring er ikke offentliggjort')).toBeVisible()
  await expect(form.getByRole('checkbox', { name: /^Ugens ret/ })).toBeChecked()
  // The band's own Forhåndsvis, first in the form; the row keeps its own beneath.
  await expect(form.getByRole('link', { name: 'Forhåndsvis', exact: true }).first()).toHaveAttribute('href', '/api/preview/start?maal=menu')

  const publish = form.getByRole('button', { name: 'Offentliggør', exact: true })
  expect(await insideViewport(publish), 'Offentliggør is in the first screen').toBe(true)
  await expectTargets44(form, 'the band')
  expect(await violations(staffPage)).toEqual([])

  await publish.click()
  await staffPage.waitForURL(/\/admin\?published=1/)
  await expect(staffPage.getByRole('status').filter({ hasText: 'Én ændring er offentliggjort' })).toBeVisible()
  await expect(pendingForm(staffPage)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 8–9. Månedens burger from the tile
// ---------------------------------------------------------------------------

test('Månedens burger from the tile: the saved notice and the Fortryd are at the foot', async () => {
  await tile(staffPage, 'Månedens burger').click()
  await expect(staffPage).toHaveURL(/maanedens-burger/)
  await expect(monthlyForm(staffPage)).toBeVisible()

  await saveMonthly(staffPage, { Navn: MONTHLY.name, Beskrivelse: MONTHLY.description, 'Pris (kr.)': MONTHLY.price })
  const notice = staffPage.getByRole('status').filter({ hasText: 'gemt som kladde' })
  expect(await insideViewport(notice), 'the "gemt" notice is inside the viewport').toBe(true)

  const toggle = monthlyAvailabilityForm(staffPage).getByRole('button')
  await toggle.scrollIntoViewIfNeeded()
  await pressMonthly(staffPage, () => toggle.click())
  await expectUndoInView(monthlyUndoStrip(staffPage), 'Månedens burger sold out')
  expect(await violations(staffPage)).toEqual([])
  await pressMonthlyUndo(staffPage)
  await expectUndoInView(monthlyUndoStrip(staffPage), 'Månedens burger restored')

  // A refused save with the longest words: no sideways scrolling, the refusal in view.
  await saveMonthly(staffPage, { Navn: 'Burger med et navn der fylder mere end en linje på en telefon '.padEnd(120, 'y'), Slutdato: copenhagenDate(-2), Startdato: copenhagenDate(1) })
  expect(await insideViewport(staffPage.getByRole('status').filter({ hasText: 'Ret det, der er markeret' }))).toBe(true)
  expect(await scrollsSideways(staffPage)).toBe(false)

  await clearMonthlyFields(staffPage)
  await publishMonthly(staffPage)
  await expect(staffPage.getByRole('status').first()).toBeVisible()
})

// ---------------------------------------------------------------------------
// 10–11. Åbningstider and Besked på hjemmesiden — the two phase-7/8 feet
// ---------------------------------------------------------------------------

test('a one-off change with its generated message: the strip and its Fortryd are at the foot', async () => {
  await staffPage.goto('/admin')
  await tile(staffPage, 'Åbningstider').click()
  await expect(staffPage).toHaveURL(/aabningstider/)
  await removeAllOverrides(staffPage)
  await openOverrideCard(staffPage)

  await fillOverride(staffPage, { date: firstNormallyClosedDay(todayInCopenhagen()), kind: 'custom', from: '12:00', to: '14:00' })
  await setAnnouncementWanted(staffPage, true)
  const publish = overrideForm(staffPage).getByRole('button', { name: 'Gem og offentliggør' })
  await publish.scrollIntoViewIfNeeded()
  await pressOverride(staffPage, () => publish.click())

  await expectUndoInView(hoursAnnouncementUndoStrip(staffPage), 'the generated announcement')
  // The hours' own report stands in the same foot, above the strip, inside the viewport.
  const hoursNotice = foot(staffPage).getByRole('status').first()
  await expect(hoursNotice).not.toContainText('Fortryd')
  expect(await insideViewport(hoursNotice), 'the hours notice is inside the viewport').toBe(true)
  expect(await scrollsSideways(staffPage)).toBe(false)
  expect(await violations(staffPage)).toEqual([])

  await pressHoursAnnouncementUndo(staffPage)
  await expect(hoursAnnouncementUndoStrip(staffPage)).toHaveCount(0)
  await removeAllOverrides(staffPage)
})

test('the announcement editor: a long message wraps on the dashboard, and "Vis besked" leaves its Fortryd at the foot', async () => {
  await openAnnouncementAdmin(staffPage)
  await saveAnnouncement(staffPage, {
    message: LONG_MESSAGE,
    link: 'Intet link',
    linkLabel: '',
    expiryChip: 'Vælg selv',
    date: copenhagenDate(1),
    time: '20:00',
  })
  // A stopped earlier run may have published these very words already; then the save
  // is "uændret" (§4's delta rule) and there is nothing to publish.
  if ((await announcementPendingBand(staffPage).count()) > 0) {
    expect(await insideViewport(staffPage.getByRole('status').filter({ hasText: 'gemt som kladde' }))).toBe(true)
    await publishAnnouncement(staffPage)
  }
  // The suites before this one leave the bar switched off (§0h): a publish of new
  // content shows it, a publish of nothing does not — so switch it on the way 1ad
  // does, through the immediate path, and measure that strip too.
  if ((await visibilitySwitchDirection(staffPage)) === 'on') {
    await pressVisibilitySwitch(staffPage)
    await expectUndoInView(announcementUndoStrip(staffPage), 'the bar switched on')
  }

  // The dashboard reads the published row: "Vises nu", the words, no sideways scrolling.
  await staffPage.goto('/admin')
  const card = staffPage.getByRole('region', { name: 'Besked på hjemmesiden' })
  await expect(card.getByText('Vises nu', { exact: true })).toBeVisible()
  await expect(card).toContainText(LONG_MESSAGE)
  await expect(card).toContainText('Forsvinder af sig selv')
  expect(await scrollsSideways(staffPage)).toBe(false)
  expect(await violations(staffPage)).toEqual([])

  await card.getByRole('link', { name: 'Rediger besked' }).click()
  const switchCard = visibilityCard(staffPage)
  await switchCard.scrollIntoViewIfNeeded()
  await pressVisibilitySwitch(staffPage)
  await expectUndoInView(announcementUndoStrip(staffPage), 'the bar switched off')
  await expectClearOfFoot(staffPage, switchCard.getByRole('button'))
  await pressAnnouncementUndo(staffPage)
  await expectUndoInView(announcementUndoStrip(staffPage), 'the bar switched on again')

  // The state every announcement suite leaves: published, switched off, nothing pending.
  await pressRemoveNow(staffPage)
  await staffPage.goto('/admin')
  await expect(staffPage.getByRole('region', { name: 'Besked på hjemmesiden' }).getByText('Slået fra', { exact: true })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 12. The News editor's pinned bar leaves nothing behind
// ---------------------------------------------------------------------------

test('the News editor measures its bar, and the measurement is gone on the dashboard and the menu', async () => {
  const property = () =>
    staffPage.evaluate(() => document.documentElement.style.getPropertyValue('--admin-bar-height'))

  await tile(staffPage, 'Skriv en nyhed').click()
  await expect(staffPage).toHaveURL(/\/admin\/nyheder$/)
  await staffPage.getByRole('link', { name: '+ Ny nyhed' }).click()
  await expect(staffPage.getByRole('textbox', { name: 'Overskrift' })).toBeVisible()
  await expect.poll(property).toMatch(/^\d+(\.\d+)?px$/)

  await backLink(staffPage).click()
  await expect(staffPage).toHaveURL(/\/admin\/nyheder$/)
  await expect.poll(property).toBe('')
  await backLink(staffPage).click()
  await expect(staffPage).toHaveURL(/\/admin$/)
  expect(await property()).toBe('')
  await tile(staffPage, 'Rediger menu').click()
  await expect(staffPage).toHaveURL(/\/admin\/menu/)
  expect(await property()).toBe('')

  // And it measures again on the way back in.
  await staffPage.goto('/admin/nyheder')
  await staffPage.getByRole('link', { name: '+ Ny nyhed' }).click()
  await expect.poll(property).toMatch(/px$/)
})

// ---------------------------------------------------------------------------
// 13–14. The Owner
// ---------------------------------------------------------------------------

test('the Owner sees the Owner tiles too, in the same list, and Brugere leads where it says', async () => {
  await ownerPage.goto('/admin')
  await expect(ownerPage.getByText('Logget ind som Lokal Ejer')).toBeVisible()

  for (const name of [...STAFF_TILES, ...OWNER_ONLY_TILES]) {
    await expect(tile(ownerPage, name)).toBeVisible()
  }
  await expect(tile(ownerPage, 'Åbningstider')).toHaveAccessibleDescription('Ugens faste tider, og ret tider for en dag')
  expect(await scrollsSideways(ownerPage)).toBe(false)
  await expectTargets44(ownerPage, "the Owner's dashboard")
  expect(await violations(ownerPage)).toEqual([])

  await tile(ownerPage, 'Brugere').click()
  await expect(ownerPage).toHaveURL(/\/admin\/brugere$/)
  await expect(ownerPage.getByRole('heading', { level: 1 })).toHaveText('Brugere')
  await backLink(ownerPage).click()
  await expect(ownerPage).toHaveURL(/\/admin$/)
})

test('a hidden tile is not a permission: the address is refused for a staff member', async () => {
  await staffPage.goto('/admin/brugere')
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
  await staffPage.goto('/admin/forsiden')
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
})

// ---------------------------------------------------------------------------
// 15. The seed, restored
// ---------------------------------------------------------------------------

test('the seed is left as it was found', async () => {
  await staffPage.goto('/admin/menu/ugens-ret')
  await saveWeek(staffPage, { 'Lille portion (kr.)': '' })
  await publishWeek(staffPage)
  await expect(weeklyPendingBand(staffPage)).toHaveCount(0)

  await staffPage.goto('/admin')
  await expect(pendingForm(staffPage)).toHaveCount(0)
})
