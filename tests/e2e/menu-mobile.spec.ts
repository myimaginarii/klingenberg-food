import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  deleteImageNamed,
  jpegFixture,
  openImagesAdmin,
  staffRestClient,
  uploadViaUi,
} from './support/images-admin'
import {
  availabilityControl,
  confirmDelete,
  deleteDialog,
  dishForm,
  dishRow,
  ensureAvailability,
  MENU_ADMIN_PATH,
  moveButton,
  openDish,
  openSection,
  pressMove,
  publicDish,
  publishMenu,
  reorderStatus,
  saveDish,
  undoStrip,
} from './support/menu-admin'

/**
 * Rediger menu on a phone as the **primary** device — technical plan §15 (phase 12A),
 * design 1x / 1y.
 *
 * The locked phase-5 suites already prove that every menu operation *works* at
 * 375 px. This suite proves something narrower and more demanding: that a member of
 * staff standing at the counter can carry the whole workflow through on a phone
 * without a desktop — and that the screen keeps the promises 1y draws at the moments
 * that matter. So beside the story it asserts the phone-width facts that a desktop run
 * cannot: no sideways scrolling with the longest content the schema allows, the
 * ten-second Fortryd inside the viewport at the moment it starts, the pending band and
 * its Offentliggør reachable without scrolling, the moved row in view after a move,
 * dialogs that fit the screen with the safe way out first, every target at 44 px, and
 * the picker scrollable inside its own dialog.
 *
 * It is one dedicated project (`menu-mobile`, 375 × 812 with touch) at the tail of
 * the chain: it publishes the menu, uploads and deletes a real library image, and
 * leaves the seed as it found it. Nothing in the locked phase-5 suites was changed to
 * make room for it.
 */

test.describe.configure({ mode: 'serial' })

const VIEWPORT = { width: 375, height: 812 } as const

const BURGERS = 'Burgere'
const ODIN = 'Odin'
const THOR = 'Thor'
const GLADE_GRIS = 'Glade Gris'

const BASELINE_PRICE = '89'
const DRAFT_PRICE = '95,50'
const DRAFT_PRICE_PUBLIC = '95,50 kr.'

/** The dish this suite creates and removes again. A never-published draft. */
const TEMP_DISH = 'Testret 12A'

/**
 * The longest name the schema accepts (200 characters), deliberately ending in one
 * unbroken word: the one shape of valid content that can make a 343 px card scroll
 * sideways if the name is not allowed to break.
 */
const LONG_NAME = (
  'Nordisk burger med langtidsstegt okseculotte, karamelliserede løg, syltede agurker, sennepsmayonnaise og modnet cheddar ' +
  'x'.repeat(200)
).slice(0, 200)

/** 600 characters — the description's ceiling. */
const LONG_DESCRIPTION =
  'Serveres med håndskårne pommes frites, hjemmelavet aioli og en lille salat af sæsonens grøntsager. '
    .repeat(8)
    .slice(0, 600)

/** The highest price the schema allows, formatted: "9.999,99 kr." */
const MAX_PRICE = '9999,99'

const FIELD = {
  name: 'Navn',
  price: 'Pris (kr.)',
  category: 'Kategori',
  description: 'Beskrivelse',
} as const

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

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

/**
 * Wait for a control to come into view.
 *
 * For the one case where the screen *moves* after the server has answered: the
 * reorder handle's focus recovery scrolls the moved row into view, and the site's
 * `scroll-behavior: smooth` makes that a short animation rather than a jump.
 */
async function expectComesIntoView(locator: Locator, what: string): Promise<void> {
  await expect.poll(async () => insideViewport(locator), { message: what }).toBe(true)
}

/**
 * Every visible control in `scope` is at least 44 × 44 px (1aa).
 *
 * Labels are not targets — the four label chips are drawn by a `<label>` around an
 * `sr-only` checkbox, and it is the chip that is measured, not the 1 px input.
 */
async function expectTargets44(scope: Locator | Page, what: string): Promise<void> {
  const controls = scope.locator('a[href], button:not([hidden]), select, label:has(> input.sr-only)')

  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue
    const box = await control.boundingBox()
    const name = ((await control.textContent()) ?? '').trim().slice(0, 30) || '(unnamed)'

    expect(box?.height ?? 0, `${what}: "${name}" is at least 44 px tall`).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0, `${what}: "${name}" is at least 44 px wide`).toBeGreaterThanOrEqual(44)
  }
}

/** The pending band — 1y's foot on the phone. */
function pendingBand(page: Page) {
  return page.getByRole('status').filter({ hasText: 'ikke offentliggjort' }).first()
}

/** The bar's own publish control. */
function barPublish(page: Page) {
  return page.getByRole('banner').getByRole('button', { name: /^Offentliggør/ })
}

/** A guest's browser: never signed in, no cookie. */
async function guestMenu(page: Page) {
  const context = await page.context().browser()!.newContext({ viewport: VIEWPORT })
  const guest = await context.newPage()
  await guest.goto('/menu')
  return { context, guest }
}

let staffPage: Page
let rest: SupabaseClient

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true })
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
  rest = await staffRestClient()

  // The picker needs a library with something in it. Uploaded through the real screen.
  await openImagesAdmin(staffPage)
  await uploadViaUi(staffPage, {
    name: 'mobil-12a.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 60),
  })

  // A known baseline whatever the previous run left: no temporary dish, Odin's price
  // live, Thor available.
  await rest
    .from('dishes')
    .delete()
    .eq('is_new_draft', true)
    .or(`name.eq.${TEMP_DISH},name.like.${LONG_NAME.slice(0, 40)}%`)
  await openDish(staffPage, BURGERS, ODIN)
  await saveDish(staffPage, { [FIELD.price]: BASELINE_PRICE })
  await publishMenu(staffPage)
  await ensureAvailability(staffPage, BURGERS, THOR, false)
})

test.afterAll(async () => {
  // Best-effort restoration so the chain stays re-runnable after a failure: no
  // image in the library, no temporary dish, no draft on the two seeded dishes.
  // The order follows `editor-images.spec.ts`: the trusted delete door first, then
  // the draft columns — a live `image_id` cannot be nulled directly (§0w).
  try {
    const leftovers = await rest.from('images').select('id, updated_at')
    for (const row of (leftovers.data ?? []) as { id: string; updated_at: string }[]) {
      await rest.rpc('delete_image', {
        p_id: row.id,
        p_expected_updated_at: row.updated_at,
        p_confirmed: true,
      })
    }
    // By either of the two names the temporary dish carries during the run.
    await rest
      .from('dishes')
      .delete()
      .eq('is_new_draft', true)
      .or(`name.eq.${TEMP_DISH},name.like.${LONG_NAME.slice(0, 40)}%`)
    // Every dish draft, not only the two this suite edits by hand: a run that stops
    // between Flyt op and Flyt ned leaves a reorder draft on the whole section.
    await rest.from('dishes').update({ draft: null }).not('draft', 'is', null)
  } finally {
    await rest.auth.signOut()
    await staffPage.context().close()
  }
})

// ---------------------------------------------------------------------------
// 1–2. Into the menu, and around it
// ---------------------------------------------------------------------------

test('a staff member reaches Rediger menu from the dashboard, and the screen fits the phone', async () => {
  await staffPage.goto('/admin')
  await staffPage.getByRole('link', { name: 'Åbn menuen' }).click()

  await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Rediger menu')
  await expect(staffPage.getByRole('banner').getByRole('link', { name: /Tilbage/ })).toHaveAttribute('href', '/admin')
  expect(await scrollsSideways(staffPage), 'the list does not scroll sideways').toBe(false)

  // The bar's two actions are on screen without scrolling — Forhåndsvis and
  // Offentliggør are where 1y puts them, at the top, at 44 px.
  expect(await insideViewport(barPublish(staffPage))).toBe(true)
  expect(await insideViewport(staffPage.getByRole('banner').getByRole('link', { name: 'Forhåndsvis' }))).toBe(true)
  await expectTargets44(staffPage.getByRole('banner'), 'the bar')

  expect(await violations(staffPage)).toEqual([])
})

test('the section chips are one scrolling row (1y), and choosing one is announced', async () => {
  const nav = staffPage.getByRole('navigation', { name: 'Menuens sektioner' })
  const row = await nav.locator('ul').evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))

  // The chips overflow their own row, not the page.
  expect(row.scrollWidth).toBeGreaterThan(row.clientWidth)
  expect(await scrollsSideways(staffPage)).toBe(false)

  await openSection(staffPage, 'Dessert')
  await expect(
    staffPage.getByRole('navigation', { name: 'Menuens sektioner' }).getByRole('link', { name: /^Dessert/ }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(staffPage.getByRole('list', { name: 'Retter i Dessert' })).toBeVisible()
  await expectTargets44(nav, 'the chips')
})

// ---------------------------------------------------------------------------
// 3–5. A dish edit, end to end
// ---------------------------------------------------------------------------

test('opening a dish shows which dish and which section, with phone-ready fields', async () => {
  await openDish(staffPage, BURGERS, ODIN)

  const form = dishForm(staffPage)
  await expect(staffPage.getByRole('heading', { name: 'Ret', exact: true })).toBeVisible()
  await expect(form.getByLabel(FIELD.name)).toHaveValue(ODIN)
  await expect(form.getByLabel(FIELD.category)).toHaveValue(/./)
  await expect(form.getByLabel(FIELD.category).locator('option:checked')).toHaveText(BURGERS)

  // The list has stepped aside — on a phone the editor is the screen (1y).
  await expect(staffPage.getByRole('list', { name: /^Retter i / })).toBeHidden()

  // The price asks the phone for a number pad; nothing is smaller than a finger.
  await expect(form.getByLabel(FIELD.price)).toHaveAttribute('inputmode', 'decimal')
  await expectTargets44(staffPage.locator('main'), 'the editor')
  expect(await scrollsSideways(staffPage)).toBe(false)
  expect(await violations(staffPage)).toEqual([])
})

test('saving a price leaves the person on the list with the outcome and the pending band in view', async () => {
  await saveDish(staffPage, { [FIELD.price]: DRAFT_PRICE })

  await expect(staffPage.getByRole('status').first()).toContainText('gemt som kladde')
  expect(await insideViewport(staffPage.getByRole('status').first())).toBe(true)

  // 1y's band: pinned to the foot of the phone screen, its Offentliggør reachable
  // without scrolling, and the changed row marked in words.
  const band = pendingBand(staffPage)
  await expect(band).toContainText('Én ændring i menuen er ikke offentliggjort.')
  expect(await insideViewport(band.getByRole('button', { name: 'Offentliggør' }))).toBe(true)
  await expect(band.locator('..')).toHaveCSS('position', 'sticky')
  await expect(dishRow(staffPage, ODIN)).toContainText('Ny pris afventer offentliggørelse')
})

test('the band stays reachable at the bottom of a long section', async () => {
  await openSection(staffPage, BURGERS)
  await staffPage.getByRole('link', { name: /Tilføj ret til/ }).scrollIntoViewIfNeeded()

  expect(await insideViewport(pendingBand(staffPage).getByRole('button', { name: 'Offentliggør' }))).toBe(true)
  expect(await scrollsSideways(staffPage)).toBe(false)
})

// ---------------------------------------------------------------------------
// 6. The image picker, on the phone
// ---------------------------------------------------------------------------

test('the picker fits the phone, opens on the safe control, chooses, and hands focus back', async () => {
  await openDish(staffPage, BURGERS, THOR)
  await staffPage.getByRole('link', { name: 'Vælg billede' }).click()

  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect(await insideViewport(dialog)).toBe(true)
  await expect(dialog.getByRole('link', { name: 'Annuller' })).toBeFocused()

  // The dialog scrolls inside itself rather than growing past the screen.
  await expect(dialog.locator('> div')).toHaveCSS('overflow-y', 'auto')
  await expectTargets44(dialog, 'the picker')
  expect(await violations(staffPage)).toEqual([])

  // Esc is cancel, and the keyboard lands back on the control that opened it.
  await staffPage.keyboard.press('Escape')
  await staffPage.waitForURL(/#vaelg-billede$/)
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toBeFocused()

  await staffPage.getByRole('link', { name: 'Vælg billede' }).click()
  await staffPage.getByRole('dialog').getByRole('button', { name: /mobil-12a\.jpg/ }).click()
  await staffPage.waitForURL(/status=billede_gemt/)

  await expect(staffPage.getByRole('link', { name: /^Skift billede/ })).toBeVisible()
  await expect(staffPage.getByRole('button', { name: 'Fjern billede' })).toBeVisible()
  await expectTargets44(staffPage.locator('main'), 'the editor with a photo')

  await staffPage.getByRole('button', { name: 'Fjern billede' }).click()
  await staffPage.waitForURL(/status=billede_fjernet/)
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 7. Udsolgt — the Fortryd is on screen when its ten seconds start
// ---------------------------------------------------------------------------

test('marking a dish sold out from deep in the list keeps the Fortryd in view', async () => {
  await openSection(staffPage, BURGERS)
  const control = availabilityControl(staffPage, THOR, false)
  await control.scrollIntoViewIfNeeded()
  await control.click()
  await staffPage.waitForURL(/fortryd=/)

  const undo = undoStrip(staffPage).getByRole('button', { name: /^Fortryd/ })
  await expect(undo).toBeVisible()
  expect(await insideViewport(undo), 'the Fortryd is inside the viewport the moment it appears').toBe(true)

  // The state is in words on the row itself, with §7b's reset sentence.
  const row = dishRow(staffPage, THOR)
  await expect(row).toContainText('Udsolgt')
  await expect(row).toContainText('Nulstilles automatisk')
  expect(await scrollsSideways(staffPage)).toBe(false)

  await undo.click()
  await staffPage.waitForURL(/fortryd_udsolgt=1/)
  await expect(availabilityControl(staffPage, THOR, false)).toBeVisible()
})

test('marking a dish sold out from inside the editor keeps the Fortryd in view too', async () => {
  await openDish(staffPage, BURGERS, THOR)
  await staffPage.getByRole('form', { name: 'Tilgængelighed' }).getByRole('button').click()
  await staffPage.waitForURL(/fortryd=/)

  const undo = undoStrip(staffPage).getByRole('button', { name: /^Fortryd/ })
  expect(await insideViewport(undo)).toBe(true)
  await expect(staffPage.getByRole('form', { name: 'Tilgængelighed' })).toContainText('Udsolgt i dag')

  await undo.click()
  await staffPage.waitForURL(/fortryd_udsolgt=1/)
  await expect(staffPage.getByRole('form', { name: 'Tilgængelighed' })).toContainText('Tilgængelig')
})

// ---------------------------------------------------------------------------
// 8–10. Forhåndsvis, Offentliggør, and the first guest request
// ---------------------------------------------------------------------------

test('Forhåndsvis shows the draft price on the phone-sized public menu', async () => {
  await staffPage.goto(MENU_ADMIN_PATH)
  await staffPage.getByRole('banner').getByRole('link', { name: 'Forhåndsvis' }).click()

  await expect(staffPage.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()
  await expect(publicDish(staffPage, ODIN)).toContainText(DRAFT_PRICE_PUBLIC)
  expect(await scrollsSideways(staffPage)).toBe(false)

  await staffPage.goto('/api/preview/stop')
})

test('publishing from the foot puts the price live for the first guest request', async () => {
  await openSection(staffPage, BURGERS)
  await pendingBand(staffPage).getByRole('button', { name: 'Offentliggør' }).click()
  await staffPage.waitForURL(/status=/)

  await expect(staffPage.getByRole('status').first()).toContainText('Menuen er opdateret på hjemmesiden')
  await expect(pendingBand(staffPage)).toHaveCount(0)

  const { context, guest } = await guestMenu(staffPage)
  await expect(publicDish(guest, ODIN)).toContainText(DRAFT_PRICE_PUBLIC)
  expect(await context.cookies()).toEqual([])
  await context.close()
})

// ---------------------------------------------------------------------------
// 11. Reordering with a finger
// ---------------------------------------------------------------------------

test('Flyt op moves a row, keeps it in view, announces it, and greys out the boundary', async () => {
  await openSection(staffPage, BURGERS)
  const form = staffPage.getByRole('form', { name: `Flyt ${GLADE_GRIS}` })
  await form.scrollIntoViewIfNeeded()
  await expectTargets44(form, 'the reorder strip')

  await pressMove(staffPage, GLADE_GRIS, 'op')

  await expectComesIntoView(dishRow(staffPage, GLADE_GRIS), 'the moved row comes into view')
  await expect(reorderStatus(staffPage)).toHaveText(`${GLADE_GRIS} flyttet til plads 4 af 5.`)
  await expect(moveButton(staffPage, ODIN, 'op')).toBeDisabled()
  await expect(pendingBand(staffPage)).toContainText('ikke offentliggjort')

  await pressMove(staffPage, GLADE_GRIS, 'ned')
  await publishMenu(staffPage)
})

// ---------------------------------------------------------------------------
// 12–13. A temporary dish, the longest content, and an invalid edit
// ---------------------------------------------------------------------------

test('adding a dish from the dashed row lands it at the end of the section, pending', async () => {
  await openSection(staffPage, BURGERS)
  await staffPage.getByRole('link', { name: /Tilføj ret til/ }).click()

  const form = dishForm(staffPage, 'Ny ret')
  await expect(form).toBeVisible()
  await expect(form.getByLabel(FIELD.category).locator('option:checked')).toHaveText(BURGERS)
  expect(await violations(staffPage)).toEqual([])

  await saveDish(staffPage, { [FIELD.name]: TEMP_DISH, [FIELD.price]: '79' }, 'Ny ret')
  await expect(staffPage.getByRole('status').first()).toContainText('oprettet')

  const row = dishRow(staffPage, TEMP_DISH)
  await expect(row).toContainText('Ny ret — vises først på hjemmesiden')
  await expect(staffPage.getByRole('list', { name: /^Retter i / }).locator('> li').last()).toContainText(TEMP_DISH)

  const { context, guest } = await guestMenu(staffPage)
  await expect(guest.getByRole('heading', { name: TEMP_DISH })).toHaveCount(0)
  await context.close()
})

test('the longest content the schema allows wraps inside the card and never scrolls sideways', async () => {
  await openDish(staffPage, BURGERS, TEMP_DISH)
  await saveDish(staffPage, {
    [FIELD.name]: LONG_NAME,
    [FIELD.price]: MAX_PRICE,
    [FIELD.description]: LONG_DESCRIPTION,
  })

  expect(await scrollsSideways(staffPage), 'the list with a 200-character name').toBe(false)

  const row = dishRow(staffPage, LONG_NAME.slice(0, 24))
  await expect(row).toContainText('9.999,99 kr.')
  await expect(row).toContainText('Kladde')
  const box = await row.boundingBox()
  expect(box?.width ?? 0).toBeLessThanOrEqual(VIEWPORT.width)

  await openDish(staffPage, BURGERS, LONG_NAME.slice(0, 24))
  expect(await scrollsSideways(staffPage), 'the editor with the longest content').toBe(false)
  await expect(pendingBand(staffPage)).toBeVisible()

  await saveDish(staffPage, { [FIELD.name]: TEMP_DISH })
})

test('an invalid edit comes back with readable errors bound to their fields', async () => {
  await openDish(staffPage, BURGERS, TEMP_DISH)
  const form = dishForm(staffPage)

  await form.getByLabel(FIELD.price).fill('abc')
  await form.getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/fejl=/)

  const price = dishForm(staffPage).getByLabel(FIELD.price)
  await expect(price).toHaveAttribute('aria-invalid', 'true')
  await expect(price).toHaveValue('abc')
  await expect(staffPage.locator('#ret-pris-fejl')).toContainText('Prisen skal være et tal')
  expect(await insideViewport(staffPage.locator('#ret-pris-fejl'))).toBe(true)
  expect(await scrollsSideways(staffPage)).toBe(false)
  expect(await violations(staffPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// 14. Delete and restore
// ---------------------------------------------------------------------------

test('the deletion confirmation fits the phone, stacks the safe choice first, and hands focus back', async () => {
  await openDish(staffPage, BURGERS, TEMP_DISH)
  await staffPage.getByRole('link', { name: new RegExp(`^Slet ret — ${TEMP_DISH}$`) }).click()

  const dialog = deleteDialog(staffPage)
  await expect(dialog).toBeVisible()
  expect(await insideViewport(dialog)).toBe(true)
  await expect(dialog.getByRole('link', { name: 'Behold ret' })).toBeFocused()
  await expectTargets44(dialog, 'the confirmation')

  // Stacked: the safe choice above the destructive one, a clear gap between them.
  const keep = await dialog.getByRole('link', { name: 'Behold ret' }).boundingBox()
  const remove = await dialog.getByRole('button', { name: /^Slet ret/ }).boundingBox()
  expect(keep !== null && remove !== null && remove.y - (keep.y + keep.height) >= 8).toBe(true)
  expect(await violations(staffPage)).toEqual([])

  // A tap beside the sheet deletes nothing and closes nothing.
  await staffPage.mouse.click(8, 8)
  await expect(dialog).toBeVisible()

  await staffPage.keyboard.press('Escape')
  await staffPage.waitForURL(/#slet-ret$/)
  await expect(staffPage.getByRole('link', { name: new RegExp(`^Slet ret — ${TEMP_DISH}$`) })).toBeFocused()
})

test('deleting offers its Fortryd in view, and restoring brings the dish back', async () => {
  await staffPage.getByRole('link', { name: new RegExp(`^Slet ret — ${TEMP_DISH}$`) }).click()
  await confirmDelete(staffPage)

  const undo = undoStrip(staffPage).getByRole('button', { name: /^Fortryd/ })
  expect(await insideViewport(undo)).toBe(true)
  await expect(dishRow(staffPage, TEMP_DISH)).toHaveCount(0)

  await undo.click()
  await staffPage.waitForURL(/status=/)
  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, TEMP_DISH)).toBeVisible()

  // And away for good: a never-published draft leaves nothing behind.
  await openDish(staffPage, BURGERS, TEMP_DISH)
  await staffPage.getByRole('link', { name: new RegExp(`^Slet ret — ${TEMP_DISH}$`) }).click()
  await confirmDelete(staffPage)
  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, TEMP_DISH)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 15. The Owner, and the seed restored
// ---------------------------------------------------------------------------

test('the Owner meets the same phone screen and the same publish path', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true })
  const ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)

  await ownerPage.goto('/admin')
  await ownerPage.getByRole('link', { name: 'Åbn menuen' }).click()
  await expect(ownerPage.getByRole('heading', { level: 1 })).toHaveText('Rediger menu')
  expect(await insideViewport(barPublish(ownerPage))).toBe(true)
  expect(await scrollsSideways(ownerPage)).toBe(false)

  await openDish(ownerPage, BURGERS, ODIN)
  await saveDish(ownerPage, { [FIELD.price]: BASELINE_PRICE })
  expect(await insideViewport(pendingBand(ownerPage).getByRole('button', { name: 'Offentliggør' }))).toBe(true)
  await pendingBand(ownerPage).getByRole('button', { name: 'Offentliggør' }).click()
  await ownerPage.waitForURL(/status=/)
  await expect(pendingBand(ownerPage)).toHaveCount(0)

  await context.close()
})

test('the seed is back: the baseline price live, nothing pending, the library empty', async () => {
  const { context, guest } = await guestMenu(staffPage)
  await expect(publicDish(guest, ODIN)).toContainText(`${BASELINE_PRICE} kr.`)
  await context.close()

  await openSection(staffPage, BURGERS)
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(availabilityControl(staffPage, THOR, false)).toBeVisible()

  // The fixture image leaves through the library's own door.
  await openImagesAdmin(staffPage)
  await deleteImageNamed(staffPage, /mobil-12a\.jpg/)
})
