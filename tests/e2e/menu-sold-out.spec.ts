import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  availabilityControl,
  dishRow,
  ensureAvailability,
  isSoldOut,
  MENU_ADMIN_PATH,
  openDish,
  openSection,
  publicDish,
  toggleAvailability,
  undoStrip,
} from './support/menu-admin'

/**
 * Udsolgt i dag — technical plan §6, §7b, §9 (E2E 10); design 1r / 1y / 1aa.
 *
 * One promise, and it is the opposite of every other promise this administration makes:
 *
 *     **This change is live before the page has finished loading. No draft, no
 *     preview, no publish — and Fortryd is a second write, not a rollback.**
 *
 * So the suite is written from the guest's side as much as from the staff member's, and
 * the guest is a genuinely separate browser context that has never signed in. Between
 * the two it also asserts what *did not* happen: no pending change appeared, no Kladde
 * badge, nothing to publish.
 *
 * It runs in order and shares one signed-in page, because it is one story. Every test
 * that presses the control states the state it is pressing from, and every scenario
 * that ends somewhere other than "available" restores it — so an interrupted run leaves
 * the next one unaffected, and the database ends where the seed left it.
 */

test.describe.configure({ mode: 'serial' })

const BURGERS = 'Burgere'

/** The dish §7b's own worked examples are written about. */
const THOR = 'Thor'

/** The §7b sentence, as a shape. The exact weekday is pinned in the unit suite. */
const RESET_SENTENCE = /Nulstilles automatisk, når I åbner igen — \S+dag kl\. \d{2}:\d{2}/

/** A visitor: a browser that has never signed in and holds no cookie. */
async function visit(browser: Browser, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(path)

  return { context, page }
}

let staffPage: Page

/**
 * The address the immediate action redirected to, kept from one test to the next.
 *
 * The Fortryd offer lives in the query string rather than in server memory, so
 * returning to that address is how a later test gets the strip back after the ones
 * between it have navigated away. That is also worth asserting in its own right: the
 * undo is a plain authorized write, not a session-bound token.
 */
let undoUrl = ''

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  await ensureAvailability(staffPage, BURGERS, THOR, false)
})

test.afterAll(async () => {
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// E2E 10 — mark udsolgt → live at once → no draft → Fortryd → live again
// ---------------------------------------------------------------------------

test('the dish starts available in the administration and on the menu', async ({ browser }) => {
  await openSection(staffPage, BURGERS)
  await expect(availabilityControl(staffPage, THOR, false)).toBeVisible()

  const { context, page } = await visit(browser, '/menu')
  await expect(publicDish(page, THOR)).not.toContainText('Udsolgt i dag')
  await context.close()
})

test('a staff member marks it Udsolgt, and the administration says so at once', async () => {
  await openSection(staffPage, BURGERS)
  await toggleAvailability(staffPage, THOR, false)

  await expect(availabilityControl(staffPage, THOR, true)).toBeVisible()
  await expect(availabilityControl(staffPage, THOR, false)).toHaveCount(0)

  undoUrl = staffPage.url()
})

test('Fortryd is offered, does not steal focus, and is a large enough target', async () => {
  const strip = undoStrip(staffPage)
  await expect(strip).toContainText('«Thor» er nu markeret som udsolgt på hjemmesiden.')

  // 1aa: "De stjæler aldrig tastaturfokus." The strip is announced by role="status",
  // and focus is still where the navigation left it rather than inside the message.
  const focusedInStrip = await staffPage.evaluate(() => {
    const active = document.activeElement
    const status = document.querySelector('[role="status"]')
    return active !== null && status !== null && status.contains(active)
  })
  expect(focusedInStrip, 'the strip did not take focus').toBe(false)

  const box = await strip.getByRole('button', { name: /^Fortryd/ }).boundingBox()
  expect(box?.height ?? 0, 'Fortryd is at least 44 px tall').toBeGreaterThanOrEqual(44)
})

test('the row carries the computed reset sentence, with a real weekday and time', async () => {
  // The wording is §7b's; the weekday and the hour come from the current opening hours
  // through `resolveSoldOut`, so this asserts the shape rather than a fixed day — the
  // exact pair is pinned in the unit suite, where the clock can be held still.
  await expect(dishRow(staffPage, THOR)).toContainText(RESET_SENTENCE)
})

test('the change created no draft and nothing to publish', async () => {
  await openSection(staffPage, BURGERS)

  await expect(dishRow(staffPage, THOR).getByText('Kladde', { exact: true })).toHaveCount(0)
  await expect(staffPage.getByText('afventer offentliggørelse')).toHaveCount(0)
  await expect(staffPage.getByText('er ikke offentliggjort')).toHaveCount(0)

  // The dashboard lists the same `pending_changes` view the menu screen counts, and the
  // dish is not in it.
  await staffPage.goto('/admin')
  await expect(staffPage.getByText(`Ret: ${THOR}`)).toHaveCount(0)
})

test('a guest reloading /menu sees Udsolgt i dag — no publish was needed', async ({
  browser,
}) => {
  const { context, page } = await visit(browser, '/menu')

  await expect(publicDish(page, THOR)).toContainText('Udsolgt i dag')
  // Still no tracking of any kind on the public side (§12).
  expect(await context.cookies()).toEqual([])

  await context.close()
})

test('Fortryd returns the dish to Tilgængelig, and is itself an immediate change', async () => {
  // The offer is in the address, not in a session — so returning to it brings the strip
  // back, and the version token it carries is still the one that write produced.
  await staffPage.goto(undoUrl)

  await undoStrip(staffPage).getByRole('button', { name: /^Fortryd/ }).click()
  await staffPage.waitForURL(/\/admin\/menu\?/)

  await expect(availabilityControl(staffPage, THOR, false)).toBeVisible()
  await expect(dishRow(staffPage, THOR)).not.toContainText('Nulstilles automatisk')

  // The undo went live too, so it offers its own Fortryd — and still creates no draft.
  await expect(undoStrip(staffPage)).toContainText('«Thor» er nu tilgængelig på hjemmesiden.')
  await expect(dishRow(staffPage, THOR).getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('and the public menu is available again on the next request', async ({ browser }) => {
  const { context, page } = await visit(browser, '/menu')

  await expect(publicDish(page, THOR)).not.toContainText('Udsolgt i dag')

  await context.close()
})

// ---------------------------------------------------------------------------
// The editor panel — desktop 1r and the phone editor 1y
// ---------------------------------------------------------------------------

test('the editor panel carries the same control and the same helper text', async () => {
  await openDish(staffPage, BURGERS, THOR)

  const block = staffPage.getByRole('form', { name: 'Tilgængelighed' })
  await expect(block).toContainText('Tilgængelig')
  await expect(block).toContainText('Ændres straks på hjemmesiden')

  await block.getByRole('button').click()
  await staffPage.waitForURL(/\/admin\/menu\?/)

  // The panel stays open, because that is where the person was.
  await expect(staffPage.getByRole('form', { name: 'Ret' })).toBeVisible()

  const changed = staffPage.getByRole('form', { name: 'Tilgængelighed' })
  await expect(changed).toContainText('Udsolgt i dag')
  await expect(changed).toContainText(RESET_SENTENCE)

  // Nothing in the dish's own form moved: the availability control is a separate form
  // and cannot carry a field of the editor's with it.
  await expect(staffPage.getByRole('form', { name: 'Ret' }).getByLabel('Navn')).toHaveValue(THOR)
})

test('the availability control is not nested inside the draft editor’s form', async () => {
  // Two sibling forms, not one — which is what stops Gem from writing availability and
  // this control from writing a draft.
  const nested = await staffPage.getByRole('form', { name: 'Ret' }).locator('form').count()

  expect(nested, 'forms are not nested').toBe(0)
})

// ---------------------------------------------------------------------------
// Accessibility of the state only this suite can produce
// ---------------------------------------------------------------------------

/**
 * axe over the genuinely sold-out screen — technical plan §9, §12.
 *
 * The read-only a11y suite scans the available state, the editor panel and the Fortryd
 * strip, all of which are reachable from a URL alone. A row that is *actually* sold out
 * is not: it needs a write. So it is scanned here, in the suite that performs one, and
 * both this project and its 375 px sibling run it — which is the two widths §9 asks for.
 */
test('the sold-out screen has no accessibility violations', async () => {
  await openSection(staffPage, BURGERS)
  await expect(availabilityControl(staffPage, THOR, true)).toBeVisible()

  const results = await new AxeBuilder({ page: staffPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([])
})

test('the sold-out state is icon and text, and its control is a 44 px target', async () => {
  const control = availabilityControl(staffPage, THOR, true)

  // The word survives the colours being switched off (1aa).
  await expect(control).toContainText('Udsolgt')

  const box = await control.boundingBox()
  expect(box?.height ?? 0, 'the control is at least 44 px tall').toBeGreaterThanOrEqual(44)

  // And the reset sentence is readable text, not a tooltip and not a colour.
  await expect(dishRow(staffPage, THOR)).toContainText(RESET_SENTENCE)

  await toggleAvailability(staffPage, THOR, true)
  await expect(availabilityControl(staffPage, THOR, false)).toBeVisible()
})

// ---------------------------------------------------------------------------
// Who may do it (§5)
// ---------------------------------------------------------------------------

test('the owner may change availability too', async ({ browser }) => {
  const context = await browser.newContext()
  const ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)

  await openSection(ownerPage, BURGERS)
  await toggleAvailability(ownerPage, THOR, false)

  await expect(availabilityControl(ownerPage, THOR, true)).toBeVisible()
  await expect(undoStrip(ownerPage)).toContainText(
    '«Thor» er nu markeret som udsolgt på hjemmesiden.',
  )

  // Put it back, from the owner's own session.
  await toggleAvailability(ownerPage, THOR, true)
  await expect(availabilityControl(ownerPage, THOR, false)).toBeVisible()

  await context.close()
})

test('an anonymous visitor cannot reach the availability action', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  // The screen itself is unreachable…
  await page.goto(MENU_ADMIN_PATH)
  await expect(page).toHaveURL(/\/admin\/login/)

  // …and so is a direct POST to it. The action calls requireStaff() for itself, so the
  // route being redirected is not what protects it.
  const response = await page.request.post(MENU_ADMIN_PATH, {
    headers: { 'Next-Action': 'forged', 'Content-Type': 'text/plain;charset=UTF-8' },
    data: '[]',
    maxRedirects: 0,
  })
  expect(response.status(), 'a forged Server Action POST is not carried out').not.toBe(200)

  await context.close()
})

test('and the dish is untouched by the anonymous attempt', async ({ browser }) => {
  const { context, page } = await visit(browser, '/menu')
  await expect(publicDish(page, THOR)).not.toContainText('Udsolgt i dag')
  await context.close()
})

// ---------------------------------------------------------------------------
// Forged and stale requests (§8, §7e item 2)
// ---------------------------------------------------------------------------

test('the availability control cannot be extended past sold_out_on', async () => {
  // The negative promise, tried rather than assumed. The control's own form is
  // rewritten in the page to carry a price, a name, a description, a category, a draft,
  // a deletion and a chosen date alongside the state, and then submitted. None of them
  // arrives anywhere: `readAvailabilityForm` reads three named fields and builds its
  // request from those alone, and `set_dish_sold_out` names three columns in one
  // UPDATE. There is no code path for a fourth value to travel down.
  await openDish(staffPage, BURGERS, THOR)

  const before = {
    name: await staffPage.getByRole('form', { name: 'Ret' }).getByLabel('Navn').inputValue(),
    price: await staffPage
      .getByRole('form', { name: 'Ret' })
      .getByLabel('Pris (kr.)')
      .inputValue(),
  }

  await staffPage.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>('form[aria-label="Tilgængelighed"]')
    if (form === null) throw new Error('no availability form')

    for (const [name, value] of Object.entries({
      navn: 'Forfalsket navn',
      pris: '1',
      beskrivelse: 'Forfalsket beskrivelse',
      sektion_id: '00000000-0000-4000-8000-000000000000',
      draft: '{"price_ore":1}',
      deleted_at: '2026-08-29T00:00:00.000Z',
      sold_out_on: '2030-01-01',
    })) {
      const field = document.createElement('input')
      field.type = 'hidden'
      field.name = name
      field.value = value
      form.append(field)
    }

    form.querySelector('button')?.click()
  })

  await staffPage.waitForURL(/\/admin\/menu\?/)
  await openDish(staffPage, BURGERS, THOR)

  const form = staffPage.getByRole('form', { name: 'Ret' })
  await expect(form.getByLabel('Navn')).toHaveValue(before.name)
  await expect(form.getByLabel('Pris (kr.)')).toHaveValue(before.price)
  await expect(form.getByLabel('Beskrivelse')).not.toHaveValue('Forfalsket beskrivelse')

  // Whatever the forged fields asked for, the dish still exists, is still in Burgere,
  // and carries no draft.
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  await ensureAvailability(staffPage, BURGERS, THOR, false)
})

test('a Fortryd strip built by hand for a dish that does not exist shows nothing', async () => {
  await staffPage.goto(
    `${MENU_ADMIN_PATH}?sektion=burgere&fortryd=00000000-0000-4000-8000-000000000000` +
      '&fortryd_version=2026-01-01T00%3A00%3A00.000Z&fortryd_udsolgt=1',
  )

  await expect(undoStrip(staffPage)).toHaveCount(0)
  await expect(staffPage.getByRole('list', { name: /^Retter i / })).toBeVisible()
})

test('a stale version token is refused rather than overwriting a colleague', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)

  // Two people open the same section, both looking at an available dish.
  await openSection(staffPage, BURGERS)
  await openSection(ownerPage, BURGERS)
  expect(await isSoldOut(staffPage, THOR)).toBe(false)

  // The staff member acts. The owner's page is now looking at a stale row.
  await toggleAvailability(staffPage, THOR, false)
  await expect(availabilityControl(staffPage, THOR, true)).toBeVisible()

  await availabilityControl(ownerPage, THOR, false).click()
  await ownerPage.waitForURL(/\/admin\/menu\?.*status=conflict/)
  await expect(ownerPage.getByRole('status').first()).toContainText('Nogen andre har rettet dette')

  // Nothing was undone by the refusal: the first person's change stands.
  await openSection(staffPage, BURGERS)
  await expect(availabilityControl(staffPage, THOR, true)).toBeVisible()

  await context.close()
})

/**
 * With JavaScript switched off — technical plan §7e (item 11).
 *
 * The plan lets the administration require JavaScript, and this control does not use
 * the licence: it is a `<form>` and a `<button>`, so it submits, the server writes, and
 * the page comes back changed. What is lost is only the enhancement — the strip is not
 * taken away after ten seconds — and the strip is a message, not a mechanism. Fortryd
 * still works, because it is a form too.
 *
 * Asserted rather than assumed, because "it is only a form" is exactly the kind of
 * claim that stops being true the first time somebody reaches for an onClick.
 */
test('the control and its Fortryd work with JavaScript switched off', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await signIn(page, STAFF)

  await openSection(page, BURGERS)
  expect(await isSoldOut(page, THOR)).toBe(true)

  await toggleAvailability(page, THOR, true)
  await expect(availabilityControl(page, THOR, false)).toBeVisible()

  // The message is server-rendered, so it is there without the client component that
  // would normally take it away again.
  const strip = undoStrip(page)
  await expect(strip).toContainText('«Thor» er nu tilgængelig på hjemmesiden.')

  // And Fortryd is a second real write, with no script involved.
  await strip.getByRole('button', { name: /^Fortryd/ }).click()
  await page.waitForURL(/\/admin\/menu\?/)
  await expect(availabilityControl(page, THOR, true)).toBeVisible()

  await context.close()
})

test('the seeded dish is left available again', async ({ browser }) => {
  await ensureAvailability(staffPage, BURGERS, THOR, false)

  const { context, page } = await visit(browser, '/menu')
  await expect(publicDish(page, THOR)).not.toContainText('Udsolgt i dag')
  await context.close()
})
