import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  adminOrder,
  dishRow,
  dragDishOnto,
  dragPointsFor,
  MENU_ADMIN_PATH,
  moveButton,
  openDish,
  openSection,
  pressMove,
  publicOrder,
  publishMenu,
  reorderForm,
  reorderHandle,
  reorderStatus,
  saveDish,
  waitForOrder,
} from './support/menu-admin'

/**
 * Reordering the menu — technical plan §4, §6, §7e item 2; design 1r / 1y.
 *
 * The one promise this suite exists for: **a reorder is a draft.** Everything else here
 * is in service of proving that a dish can be dragged, tapped, keyed or Flyt-op'd into a
 * new position without a single guest seeing anything change until somebody presses
 * Offentliggør — and that when they do, it is phase 4's publish that runs, not a
 * reorder-shaped path beside it.
 *
 * The worked example is the phase brief's own, and it is followed from both sides at
 * once: the staff member's screen, and a genuinely separate browser context that has
 * never signed in.
 *
 *     public   Odin · Frigg · Ragnar        (before, and while the draft exists)
 *     admin    Odin · Ragnar · Frigg        (after the move)
 *     preview  Odin · Ragnar · Frigg
 *     public   Odin · Ragnar · Frigg        (after Offentliggør, and only then)
 *
 * It runs in order and shares one signed-in page, because it is one story. Every
 * scenario puts back what it moved, so an interrupted run leaves the next one unaffected
 * and the database ends where the seed left it.
 */

test.describe.configure({ mode: 'serial' })

const BURGERS = 'Burgere'
const SECTION = 'menu-burgere'

/** The five seeded burgers, in the order the seed publishes them. */
const SEEDED = ['Odin', 'Frigg', 'Ragnar', 'Thor', 'Glade Gris'] as const

/** The same five after Ragnar has been moved above Frigg. */
const MOVED = ['Odin', 'Ragnar', 'Frigg', 'Thor', 'Glade Gris'] as const

/** A visitor: a browser that has never signed in and holds no cookie. */
async function visit(browser: Browser, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(path)

  return { context, page }
}

/** The order a guest sees on `/menu` right now. */
async function guestOrder(browser: Browser): Promise<string[]> {
  const { context, page } = await visit(browser, '/menu')
  const order = await publicOrder(page, SECTION, SEEDED)
  await context.close()

  return order
}

let staffPage: Page

test.beforeAll(async ({ browser }) => {
  // An explicit context, as in the deletion suite: `@axe-core/playwright` refuses a page
  // that was opened straight from the browser.
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
})

test.afterAll(async () => {
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// The controls themselves
// ---------------------------------------------------------------------------

test('the section starts in the seeded order, publicly and in the administration', async ({
  browser,
}) => {
  await openSection(staffPage, BURGERS)

  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
  expect(await guestOrder(browser)).toEqual([...SEEDED])
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('every row carries a named handle and two move buttons, ended at the ends', async () => {
  await openSection(staffPage, BURGERS)

  for (const dish of SEEDED) {
    await expect(reorderForm(staffPage, dish)).toHaveCount(1)
    await expect(reorderHandle(staffPage, dish)).toHaveCount(1)
  }

  // The handle's name carries the dish *and* where it currently sits, which is what
  // makes five identical glyphs tellable apart without seeing the list.
  await expect(reorderHandle(staffPage, 'Ragnar')).toHaveAccessibleName(
    'Flyt Ragnar — plads 3 af 5. Brug pil op og pil ned.',
  )

  // Nothing above the first row and nothing below the last.
  await expect(moveButton(staffPage, 'Odin', 'op')).toBeDisabled()
  await expect(moveButton(staffPage, 'Odin', 'ned')).toBeEnabled()
  await expect(moveButton(staffPage, 'Glade Gris', 'ned')).toBeDisabled()
  await expect(moveButton(staffPage, 'Glade Gris', 'op')).toBeEnabled()
})

test('a section with nothing to reorder offers no reorder controls', async () => {
  // Tapas holds one entry, so there is no order to change. Three controls that say "you
  // may move this" and then cannot would be three controls too many.
  await openSection(staffPage, 'Tapas')

  await expect(staffPage.getByRole('form', { name: /^Flyt / })).toHaveCount(0)
  await expect(staffPage.getByText('Flyt op')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// The worked example, from both sides
// ---------------------------------------------------------------------------

test('Flyt op moves the dish in the administration and announces where it landed', async () => {
  await openSection(staffPage, BURGERS)
  await pressMove(staffPage, 'Ragnar', 'op')

  expect(await adminOrder(staffPage)).toEqual([...MOVED])
  await expect(reorderStatus(staffPage)).toHaveText('Ragnar flyttet til plads 2 af 5.')
})

test('both moved rows say a new order is waiting, and say it in the Kladde tone', async () => {
  for (const dish of ['Ragnar', 'Frigg']) {
    await expect(dishRow(staffPage, dish)).toContainText('Kladde')
    await expect(dishRow(staffPage, dish)).toContainText(
      'Ny rækkefølge afventer offentliggørelse',
    )
  }

  // Odin did not move, so nothing about it is pending.
  await expect(dishRow(staffPage, 'Odin')).not.toContainText('Kladde')

  // And the screen says out loud that this is not live yet.
  await expect(staffPage.getByRole('status').first()).toContainText(
    'Hjemmesiden viser stadig den gamle rækkefølge',
  )
})

test('the public menu is still in the old order — a reorder publishes nothing', async ({
  browser,
}) => {
  expect(await guestOrder(browser)).toEqual([...SEEDED])
})

test('the move is listed as a pending change, per dish, on the dashboard', async () => {
  await staffPage.goto('/admin')

  const pending = staffPage.getByRole('form', { name: 'Ændringer der venter' })
  await expect(pending.getByRole('checkbox', { name: /Ragnar/ })).toHaveCount(1)
  await expect(pending.getByRole('checkbox', { name: /Frigg/ })).toHaveCount(1)
})

test('Forhåndsvis shows the new order before anybody has published it', async () => {
  await staffPage.goto('/api/preview/start?maal=menu')
  await expect(staffPage).toHaveURL(/\/menu$/)
  await expect(staffPage.getByText('Forhåndsvisning — ikke live')).toBeVisible()

  expect(await publicOrder(staffPage, SECTION, SEEDED)).toEqual([...MOVED])

  await staffPage.goto('/api/preview/stop')
})

test('Offentliggør puts the new order live, through phase 4 and nothing else', async ({
  browser,
}) => {
  await publishMenu(staffPage)
  await expect(staffPage.getByRole('status').first()).toContainText(
    'Menuen er opdateret på hjemmesiden',
  )

  expect(await guestOrder(browser)).toEqual([...MOVED])

  // Published means nothing is pending any more, and no row is in the Kladde tone.
  await openSection(staffPage, BURGERS)
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('and the section can be put back the same way', async ({ browser }) => {
  await pressMove(staffPage, 'Ragnar', 'ned')
  await publishMenu(staffPage)

  expect(await guestOrder(browser)).toEqual([...SEEDED])
})

// ---------------------------------------------------------------------------
// The three ways to move a row
// ---------------------------------------------------------------------------

/**
 * The mouse drag, at the width 1r is drawn at.
 *
 * Skipped in the 375 px run, and deliberately: a pointer drag is not what happens on a
 * phone. The touch gesture — which is a different code path, with a hold in front of it
 * — is asserted below, with real touch pointers.
 */
test('the handle can be dragged with a pointer, and lands where it was dropped', async ({
  hasTouch,
}) => {
  test.skip(hasTouch, 'the 375 px run drags with a finger instead')

  const dragged = ['Glade Gris', 'Odin', 'Frigg', 'Ragnar', 'Thor']

  await openSection(staffPage, BURGERS)
  await dragDishOnto(staffPage, 'Glade Gris', 'Odin', dragged)

  expect(await adminOrder(staffPage)).toEqual(dragged)
  await expect(reorderStatus(staffPage)).toHaveText('Glade Gris flyttet til plads 1 af 5.')
})

test('a drag back to the published position leaves no pending change behind', async ({
  hasTouch,
}) => {
  test.skip(hasTouch, 'the 375 px run drags with a finger instead')

  // The clearing rule: the dish is where it is published, so `sort_order` stops being a
  // draft field rather than sitting there claiming a change nobody will see.
  await dragDishOnto(staffPage, 'Glade Gris', 'Thor', SEEDED)

  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  await staffPage.goto('/admin')
  await expect(staffPage.getByRole('form', { name: 'Ændringer der venter' })).toHaveCount(0)
})

/**
 * A finger, not a mouse — design 1y: *"Hold på en række for at flytte den."*
 *
 * Playwright's `page.mouse` always produces `pointerType: 'mouse'`, whatever the context
 * says about touch, so a mouse drag would silently skip the one thing that makes the
 * touch path different: the hold. A finger has to rest on the handle before the row
 * comes loose, so that scrolling a long section never drags a dish by accident. Real
 * touch pointers are dispatched here through CDP, which is the only way to produce one.
 *
 * Both halves of the rule are asserted, because having only the first would let the hold
 * be deleted without anything failing.
 */
test('a finger holds the handle to drag a row — and a quick swipe moves nothing', async ({
  page,
  hasTouch,
}) => {
  test.skip(!hasTouch, 'the touch gesture is asserted in the 375 px run')

  await signIn(page, STAFF)
  await openSection(page, BURGERS)

  const cdp = await page.context().newCDPSession(page)

  // Upwards, so the handle — which sits at the foot of a tall card on a phone — and the
  // point it is aiming for are both on screen at once.
  const swipe = await dragPointsFor(page, 'Frigg', 'Odin')

  // 1. A swipe: down on the handle and away immediately. That is somebody scrolling.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [swipe.from] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [swipe.to] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

  await page.waitForTimeout(600)
  expect(await adminOrder(page)).toEqual([...SEEDED])
  await expect(page.getByText('Kladde', { exact: true })).toHaveCount(0)

  // 2. A hold, and then the same movement. That is somebody moving a dish.
  const drag = await dragPointsFor(page, 'Frigg', 'Odin')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drag.from] })
  await page.waitForTimeout(600)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [drag.to] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

  await waitForOrder(page, ['Frigg', 'Odin', 'Ragnar', 'Thor', 'Glade Gris'])

  expect(await adminOrder(page)).toEqual(['Frigg', 'Odin', 'Ragnar', 'Thor', 'Glade Gris'])
  await expect(reorderStatus(page)).toHaveText('Frigg flyttet til plads 1 af 5.')
  await expect(dishRow(page, 'Frigg')).toContainText('Kladde')

  // Put it back through the buttons, so the cleanup does not depend on the gesture.
  await pressMove(page, 'Frigg', 'ned')
  expect(await adminOrder(page)).toEqual([...SEEDED])
  await expect(page.getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('the keyboard alone completes a move, an announcement and a publish', async ({
  browser,
}) => {
  await openSection(staffPage, BURGERS)

  await reorderHandle(staffPage, 'Thor').focus()
  await staffPage.keyboard.press('ArrowUp')
  await waitForOrder(staffPage, ['Odin', 'Frigg', 'Thor', 'Ragnar', 'Glade Gris'])

  expect(await adminOrder(staffPage)).toEqual([
    'Odin',
    'Frigg',
    'Thor',
    'Ragnar',
    'Glade Gris',
  ])
  await expect(reorderStatus(staffPage)).toHaveText('Thor flyttet til plads 3 af 5.')

  // The keyboard is still on the handle it started from, now naming the new position —
  // so a second press continues the journey rather than restarting it.
  await expect(reorderHandle(staffPage, 'Thor')).toBeFocused()
  await expect(reorderHandle(staffPage, 'Thor')).toHaveAccessibleName(
    'Flyt Thor — plads 3 af 5. Brug pil op og pil ned.',
  )

  await staffPage.keyboard.press('ArrowDown')
  await waitForOrder(staffPage, SEEDED)
  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  // And once more, published this time, with no pointer anywhere in the journey.
  await reorderHandle(staffPage, 'Thor').focus()
  await staffPage.keyboard.press('ArrowUp')
  await waitForOrder(staffPage, ['Odin', 'Frigg', 'Thor', 'Ragnar', 'Glade Gris'])
  await publishMenu(staffPage)

  expect(await guestOrder(browser)).toEqual([
    'Odin',
    'Frigg',
    'Thor',
    'Ragnar',
    'Glade Gris',
  ])

  // Put it back, again without a pointer.
  await openSection(staffPage, BURGERS)
  await reorderHandle(staffPage, 'Thor').focus()
  await waitForOrder(staffPage, ['Odin', 'Frigg', 'Thor', 'Ragnar', 'Glade Gris'])
  await staffPage.keyboard.press('ArrowDown')
  await waitForOrder(staffPage, SEEDED)
  await publishMenu(staffPage)

  expect(await guestOrder(browser)).toEqual([...SEEDED])
})

test('the handle at the end of the list refuses to walk off it', async () => {
  await openSection(staffPage, BURGERS)

  await reorderHandle(staffPage, 'Odin').focus()
  await staffPage.keyboard.press('ArrowUp')

  // Nothing was submitted, so nothing moved and the keyboard has not gone anywhere.
  await expect(staffPage).toHaveURL(/sektion=burgere$/)
  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
  await expect(reorderHandle(staffPage, 'Odin')).toBeFocused()
})

// ---------------------------------------------------------------------------
// Somebody else's work
// ---------------------------------------------------------------------------

test('a colleague’s pending price survives a reorder of the same dish', async ({ browser }) => {
  const context = await browser.newContext()
  const otherPage = await context.newPage()
  await signIn(otherPage, OWNER)

  await openDish(otherPage, BURGERS, 'Ragnar')
  await saveDish(otherPage, { 'Pris (kr.)': '104' })

  // Now move it. The reorder merges into the existing draft rather than replacing it.
  await openSection(staffPage, BURGERS)
  await pressMove(staffPage, 'Ragnar', 'op')

  await openDish(staffPage, BURGERS, 'Ragnar')
  await expect(staffPage.getByRole('form', { name: 'Ret' }).getByLabel('Pris (kr.)')).toHaveValue(
    '104',
  )

  // Put both back: the price first, then the position.
  await saveDish(staffPage, { 'Pris (kr.)': '97' })
  await openSection(staffPage, BURGERS)
  await pressMove(staffPage, 'Ragnar', 'ned')

  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  await context.close()
})

test('a pending reorder survives a colleague saving a price on the same dish', async ({
  browser,
}) => {
  // The mirror of the test above, and the one that is easy to get wrong in the other
  // direction: the dish editor panel renders six fields and not a position, so saving it
  // must leave a pending move exactly where it was. It used to replace the whole draft,
  // which discarded the move silently and left half a new order waiting to publish.
  const context = await browser.newContext()
  const otherPage = await context.newPage()
  await signIn(otherPage, OWNER)

  await openSection(staffPage, BURGERS)
  await pressMove(staffPage, 'Ragnar', 'op')
  expect(await adminOrder(staffPage)).toEqual([...MOVED])

  // A colleague edits the same dish through the panel, twice: once changing the price,
  // and once putting it back — which is the case that clears a draft field.
  await openDish(otherPage, BURGERS, 'Ragnar')
  await saveDish(otherPage, { 'Pris (kr.)': '104' })
  await openDish(otherPage, BURGERS, 'Ragnar')
  await saveDish(otherPage, { 'Pris (kr.)': '97' })

  // The move is still pending, on both dishes it touched.
  await openSection(staffPage, BURGERS)
  expect(await adminOrder(staffPage)).toEqual([...MOVED])
  await expect(dishRow(staffPage, 'Ragnar')).toContainText('Kladde')
  await expect(dishRow(staffPage, 'Frigg')).toContainText('Kladde')

  // Put it back.
  await pressMove(staffPage, 'Ragnar', 'ned')
  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  await context.close()
})

test('a second staff member starting from the same order is refused, not overwritten', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const otherPage = await context.newPage()
  await signIn(otherPage, OWNER)

  // Both people load the list. Both are looking at Odin · Frigg · Ragnar · Thor · Glade Gris.
  await openSection(staffPage, BURGERS)
  await openSection(otherPage, BURGERS)

  // A moves Ragnar up, and that goes through.
  await pressMove(staffPage, 'Ragnar', 'op')
  expect(await adminOrder(staffPage)).toEqual([...MOVED])

  // B, still on the old screen, tries to move Thor. The list B acted on no longer
  // exists, so the move is refused rather than applied to a different list.
  await moveButton(otherPage, 'Thor', 'op').click()
  await otherPage.waitForURL(/\/admin\/menu\?.*status=conflict/)
  await expect(otherPage.getByRole('status').first()).toContainText('Nogen andre har rettet dette')

  // A's order stands, and B's move did not happen.
  await openSection(staffPage, BURGERS)
  expect(await adminOrder(staffPage)).toEqual([...MOVED])
  await expect(dishRow(staffPage, 'Thor')).not.toContainText('Kladde')

  // Reloading gives B the current list, and the same move then works.
  await openSection(otherPage, BURGERS)
  await pressMove(otherPage, 'Thor', 'op')
  expect(await adminOrder(otherPage)).toEqual(['Odin', 'Ragnar', 'Thor', 'Frigg', 'Glade Gris'])

  // Put the section back where the seed left it, and publish nothing.
  await pressMove(otherPage, 'Thor', 'ned')
  await openSection(otherPage, BURGERS)
  await pressMove(otherPage, 'Ragnar', 'ned')

  expect(await adminOrder(otherPage)).toEqual([...SEEDED])
  await expect(otherPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  await context.close()
})

// ---------------------------------------------------------------------------
// Forged and over-reaching requests (§8)
// ---------------------------------------------------------------------------

test('an anonymous visitor cannot reach the reorder action', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(MENU_ADMIN_PATH)
  await expect(page).toHaveURL(/\/admin\/login/)

  const response = await page.request.post(MENU_ADMIN_PATH, {
    headers: { 'Next-Action': 'forged', 'Content-Type': 'text/plain;charset=UTF-8' },
    data: '[]',
    maxRedirects: 0,
  })
  expect(response.status(), 'a forged Server Action POST is not carried out').not.toBe(200)

  await context.close()
})

test('a destination outside the section is refused rather than clamped to its end', async () => {
  await openSection(staffPage, BURGERS)

  await staffPage.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>('form[aria-label="Flyt Odin"]')
    if (form === null) throw new Error('no reorder form')

    const submit = [...form.querySelectorAll('button')].find(
      (button) => button.type === 'submit' && !button.disabled,
    )
    if (submit === undefined) throw new Error('no submit button')

    submit.value = '40'
    submit.click()
  })

  await staffPage.waitForURL(/\/admin\/menu\?.*status=ugyldig/)

  await openSection(staffPage, BURGERS)
  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('a reorder form cannot be extended past sort_order', async () => {
  // The negative promise, tried rather than assumed: the form is rewritten to carry a
  // price, a name, a category, a sold-out date, a deletion and a raw draft alongside the
  // destination. `readReorderForm` reads four named fields, and the write that follows
  // is `saveEntityDraft` with a single value in it.
  await openSection(staffPage, BURGERS)

  await staffPage.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>('form[aria-label="Flyt Ragnar"]')
    if (form === null) throw new Error('no reorder form')

    for (const [name, value] of Object.entries({
      navn: 'Forfalsket navn',
      pris: '1',
      price_ore: '1',
      beskrivelse: 'Forfalsket beskrivelse',
      sektion_id: '00000000-0000-4000-8000-000000000000',
      category_id: '00000000-0000-4000-8000-000000000000',
      sort_order: '99',
      draft: '{"price_ore":1}',
      udsolgt: '1',
      slettet: '1',
      sold_out_on: '2030-01-01',
    })) {
      const field = document.createElement('input')
      field.type = 'hidden'
      field.name = name
      field.value = value
      form.append(field)
    }

    const up = [...form.querySelectorAll('button')].find(
      (button) => button.type === 'submit' && !button.disabled && !button.hidden,
    )
    up?.click()
  })

  await staffPage.waitForURL(/\/admin\/menu\?.*(flyttet=|status=)/)

  // The move happened, because that is what the form was for. Nothing else did.
  await openDish(staffPage, BURGERS, 'Ragnar')
  const form = staffPage.getByRole('form', { name: 'Ret' })
  await expect(form.getByLabel('Navn')).toHaveValue('Ragnar')
  await expect(form.getByLabel('Pris (kr.)')).toHaveValue('97')
  await expect(form.getByLabel('Beskrivelse')).not.toHaveValue('Forfalsket beskrivelse')
  await expect(staffPage.getByRole('form', { name: 'Tilgængelighed' })).toContainText(
    'Tilgængelig',
  )

  // The dish is still in Burgere, and still in the list at all.
  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, 'Ragnar')).toHaveCount(1)

  // Put it back.
  await pressMove(staffPage, 'Ragnar', 'ned')
  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('a hand-built fingerprint that names no real order is refused', async () => {
  await openSection(staffPage, BURGERS)

  await staffPage.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>('form[aria-label="Flyt Odin"]')
    if (form === null) throw new Error('no reorder form')

    const baseline = form.querySelector<HTMLInputElement>('input[name="grundlag"]')
    if (baseline === null) throw new Error('no fingerprint field')

    baseline.value = 'deadbeefdeadbeef'
    form.querySelector<HTMLButtonElement>('button[type="submit"]:not([disabled])')?.click()
  })

  await staffPage.waitForURL(/\/admin\/menu\?.*status=conflict/)
  await expect(staffPage.getByRole('status').first()).toContainText('Nogen andre har rettet dette')

  await openSection(staffPage, BURGERS)
  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
})

// ---------------------------------------------------------------------------
// Without JavaScript (§7e item 11)
// ---------------------------------------------------------------------------

test('Flyt op and Flyt ned work with JavaScript switched off, and the drag handle is absent', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await signIn(page, STAFF)

  await openSection(page, BURGERS)

  // The handle is drawn — a Client Component is still rendered by the server — but it is
  // disabled and out of the accessibility tree, because a focusable control that cannot
  // do anything is worse than no control. So there is nothing here to find by role, and
  // nothing to tab to.
  await expect(reorderHandle(page, 'Ragnar')).toHaveCount(0)
  await expect(page.locator('form[aria-label="Flyt Ragnar"] button[disabled][aria-hidden]')).toHaveCount(
    1,
  )

  // The buttons are ordinary form submits, so they are the whole feature here.
  await pressMove(page, 'Ragnar', 'op')
  expect(await adminOrder(page)).toEqual([...MOVED])

  await expect(page.getByRole('status').first()).toContainText(
    'Hjemmesiden viser stadig den gamle rækkefølge',
  )
  await expect(dishRow(page, 'Ragnar')).toContainText('Kladde')

  // The announcement is server-rendered, so it is on the screen with no client
  // component to compose it.
  await expect(reorderStatus(page)).toHaveText('Ragnar flyttet til plads 2 af 5.')

  await pressMove(page, 'Ragnar', 'ned')
  expect(await adminOrder(page)).toEqual([...SEEDED])
  await expect(page.getByText('Kladde', { exact: true })).toHaveCount(0)

  await context.close()
})

// ---------------------------------------------------------------------------
// Accessibility (§11 of the phase brief)
// ---------------------------------------------------------------------------

test('every reorder control is at least 44 px and names the dish it moves', async () => {
  await openSection(staffPage, BURGERS)

  const controls = [
    reorderHandle(staffPage, 'Frigg'),
    moveButton(staffPage, 'Frigg', 'op'),
    moveButton(staffPage, 'Frigg', 'ned'),
  ]

  for (const control of controls) {
    const box = await control.boundingBox()
    expect(box, 'the control is on screen').not.toBeNull()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    await expect(control).toHaveAccessibleName(/Frigg/)
  }
})

test('the handle takes keyboard focus and shows the 3 px ring', async () => {
  await openSection(staffPage, BURGERS)

  // Reached with the Tab key, not with `.focus()`. The design's ring is on
  // `:focus-visible` (1aa), which a browser grants to a keyboard arrival and withholds
  // from a programmatic one — so focusing directly would prove nothing about what a
  // keyboard user actually sees. Stepping away and back is a real keyboard arrival.
  await reorderHandle(staffPage, 'Frigg').focus()
  await staffPage.keyboard.press('Shift+Tab')
  await staffPage.keyboard.press('Tab')

  await expect(reorderHandle(staffPage, 'Frigg')).toBeFocused()

  const ring = await reorderHandle(staffPage, 'Frigg').evaluate((node) => {
    const style = window.getComputedStyle(node)
    return {
      visible: node.matches(':focus-visible'),
      width: style.outlineWidth,
      style: style.outlineStyle,
    }
  })

  expect(ring.visible, 'the handle is focused the way a keyboard focuses it').toBe(true)
  expect(ring.style).not.toBe('none')
  expect(Number.parseFloat(ring.width)).toBeGreaterThanOrEqual(3)
})

test('the live region is polite, and no ARIA drag-and-drop attribute is used', async () => {
  await openSection(staffPage, BURGERS)

  await expect(reorderStatus(staffPage)).toHaveAttribute('aria-live', 'polite')

  // `aria-grabbed` and `aria-dropeffect` are deprecated and were never implemented
  // usefully; a control that claimed them would be telling a screen reader something
  // untrue about how this works.
  const misleading = await staffPage.locator('[aria-grabbed], [aria-dropeffect]').count()
  expect(misleading, 'no deprecated ARIA drag-and-drop attributes').toBe(0)
})

test('the reordered screen has no accessibility violations', async () => {
  await openSection(staffPage, BURGERS)
  await pressMove(staffPage, 'Ragnar', 'op')

  const results = await new AxeBuilder({ page: staffPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([])

  await openSection(staffPage, BURGERS)
  await pressMove(staffPage, 'Ragnar', 'ned')
})

// ---------------------------------------------------------------------------
// Leaving the seed as it was found
// ---------------------------------------------------------------------------

test('the section is back in its seeded order, live, with nothing pending', async ({
  browser,
}) => {
  await openSection(staffPage, BURGERS)

  expect(await adminOrder(staffPage)).toEqual([...SEEDED])
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
  expect(await guestOrder(browser)).toEqual([...SEEDED])

  await staffPage.goto('/admin')
  await expect(staffPage.getByRole('form', { name: 'Ændringer der venter' })).toHaveCount(0)
})
