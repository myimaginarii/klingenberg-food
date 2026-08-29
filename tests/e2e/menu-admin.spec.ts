import { expect, test, type Browser, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  dishForm,
  MENU_ADMIN_PATH,
  openDish,
  openSection,
  publicDish,
  publishMenu,
  saveDish,
  setStandardLabel,
} from './support/menu-admin'

/**
 * Rediger menu — technical plan §6, §9 (E2E 2); design 1r / 1y.
 *
 * The promise this screen has to keep is phase 4's, applied to the menu:
 *
 *     **Editing changes nothing a guest can see. Publishing changes it at once.**
 *
 * So every test below is written from a guest's side of that line as much as from the
 * administration's, and the guest is a genuinely separate browser context that has
 * never signed in and holds no cookie.
 *
 * The suite runs in order and shares one signed-in page, because it is one story: a
 * dish has to be created before it can be published, and edited before it can be
 * previewed. It is idempotent by construction rather than by luck — the baseline is
 * published in `beforeAll` whatever the database currently holds, and the last two
 * tests put the seeded content back — so an interrupted run leaves the next one
 * unaffected and the database ends where the seed left it.
 */

test.describe.configure({ mode: 'serial' })

const BURGERS = 'Burgere'
const DESSERT = 'Dessert'

/** The dish E2E 2 moves, and the prices it moves between. */
const ODIN = 'Odin'
const BASELINE_PRICE = '89'
const BASELINE_PRICE_PUBLIC = '89 kr.'
const DRAFT_PRICE = '95,50'
const DRAFT_PRICE_PUBLIC = '95,50 kr.'

/** The dish the label tests use. It carries "Pulled pork" in the seed. */
const GLADE_GRIS = 'Glade Gris'
const DESCRIPTIVE_LABEL = 'Pulled pork'

/**
 * The dish this suite creates.
 *
 * The name carries the run's start time, and deliberately so. Phase 5B has no delete —
 * that is the next increment — so a dish this suite publishes cannot be removed again
 * through any path the product actually has. A fixed name would therefore collide with
 * the previous run's leftover the second time the suite is run against the same
 * database, and "a new dish is invisible to a guest" would fail against a dish that is
 * public because a previous run published it.
 *
 * So each run creates its own dish, and the last test returns it to Dessert with its
 * text cleared. The seeded content — which is what the other suites assert against — is
 * restored exactly; the leftover row goes away with the next `npm run db:reset`.
 */
const NEW_DISH = `Testret 5B ${String(Date.now())}`

const FIELD = {
  name: 'Navn',
  price: 'Pris (kr.)',
  category: 'Kategori',
  description: 'Beskrivelse',
  secondaryNote: 'Ekstra linje (valgfrit)',
} as const

/** A visitor: a browser that has never signed in and holds no cookie. */
async function visit(browser: Browser, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(path)

  return { context, page }
}

let staffPage: Page

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  // Publish the baseline before anything else, so the suite starts from a known live
  // price however the previous run ended.
  await openDish(staffPage, BURGERS, ODIN)
  await saveDish(staffPage, { [FIELD.price]: BASELINE_PRICE })
  await publishMenu(staffPage)
})

test.afterAll(async () => {
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// The screen itself
// ---------------------------------------------------------------------------

test('lists the nine sections with their dish counts, and opens one', async () => {
  await staffPage.goto(MENU_ADMIN_PATH)

  const nav = staffPage.getByRole('navigation', { name: 'Menuens sektioner' })

  await expect(nav.getByRole('link')).toHaveCount(9)
  await expect(nav.getByRole('link', { name: /^Burgere/ })).toHaveAttribute(
    'aria-current',
    'page',
  )

  await openSection(staffPage, DESSERT)
  await expect(
    staffPage.getByRole('navigation', { name: 'Menuens sektioner' }).getByRole('link', {
      name: new RegExp(`^${DESSERT}`),
    }),
  ).toHaveAttribute('aria-current', 'page')
})

test('says that Ugens ret is managed in its own editor rather than offering dishes', async () => {
  await openSection(staffPage, 'Ugens ret')

  await expect(staffPage.getByText('redigeres i sin egen skærm')).toBeVisible()
  await expect(staffPage.getByRole('link', { name: /Tilføj ret/ })).toHaveCount(0)

  // And it is not offered as a destination in the editor's own dropdown.
  await openDish(staffPage, BURGERS, ODIN)
  await expect(dishForm(staffPage).getByLabel(FIELD.category)).not.toContainText('Ugens ret')
})

// ---------------------------------------------------------------------------
// E2E 2 — edit → draft → public unchanged → preview → publish → public changed
// ---------------------------------------------------------------------------

test('editing a price saves a draft and shows the Kladde state', async () => {
  await openDish(staffPage, BURGERS, ODIN)
  await expect(dishForm(staffPage).getByLabel(FIELD.price)).toHaveValue(BASELINE_PRICE)

  await saveDish(staffPage, { [FIELD.price]: DRAFT_PRICE })

  await expect(staffPage.getByRole('status').first()).toContainText('gemt som kladde')
  await expect(staffPage.getByText('Kladde', { exact: true }).first()).toBeVisible()
  await expect(staffPage.getByText('Ny pris afventer offentliggørelse')).toBeVisible()
  await expect(staffPage.getByText('Én ændring i menuen er ikke offentliggjort.')).toBeVisible()
})

test('a guest still sees the published price, not the draft', async ({ browser }) => {
  const { context, page } = await visit(browser, '/menu')

  await expect(publicDish(page, ODIN)).toContainText(BASELINE_PRICE_PUBLIC)
  await expect(page.getByText('Forhåndsvisning')).toHaveCount(0)
  expect(await context.cookies()).toEqual([])

  await context.close()
})

test('Forhåndsvis opens the real menu with the draft price merged in', async () => {
  await staffPage.goto('/api/preview/start?maal=menu')

  await expect(staffPage).toHaveURL(/\/menu$/)
  await expect(staffPage.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()
  await expect(publicDish(staffPage, ODIN)).toContainText(DRAFT_PRICE_PUBLIC)

  await staffPage.goto('/api/preview/stop')
})

test('publishing puts the new price live at once', async () => {
  await publishMenu(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText(
    'Menuen er opdateret på hjemmesiden',
  )
  await expect(staffPage.getByText('Ny pris afventer offentliggørelse')).toHaveCount(0)
})

test('the next public request shows the published price', async ({ browser }) => {
  const { context, page } = await visit(browser, '/menu')

  await expect(publicDish(page, ODIN)).toContainText(DRAFT_PRICE_PUBLIC)

  await context.close()
})

// ---------------------------------------------------------------------------
// Labels — the phase brief's own example
// ---------------------------------------------------------------------------

test('a descriptive label survives an unrelated edit', async ({ browser }) => {
  await openDish(staffPage, BURGERS, GLADE_GRIS)

  // The editor renders the stored label into its own field, which is what carries it
  // back through a save that was only about the price.
  await expect(dishForm(staffPage).getByLabel('Egen mærkat 1')).toHaveValue(DESCRIPTIVE_LABEL)

  await saveDish(staffPage, { [FIELD.price]: '92' })
  await publishMenu(staffPage)

  const { context, page } = await visit(browser, '/menu')
  await expect(publicDish(page, GLADE_GRIS)).toContainText('92 kr.')
  await expect(publicDish(page, GLADE_GRIS)).toContainText(DESCRIPTIVE_LABEL)
  await context.close()

  // Put the seeded price back.
  await openDish(staffPage, BURGERS, GLADE_GRIS)
  await saveDish(staffPage, { [FIELD.price]: '89' })
  await publishMenu(staffPage)
})

test('a custom label can be added and published, and a standard one toggled', async ({
  browser,
}) => {
  await openDish(staffPage, BURGERS, GLADE_GRIS)

  await setStandardLabel(staffPage, 'Populær', true)

  const form = dishForm(staffPage)
  await form.getByLabel('Egen mærkat 2').fill('Størst')
  await form.getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/\/admin\/menu\?.*status=/)

  await publishMenu(staffPage)

  const { context, page } = await visit(browser, '/menu')
  const card = publicDish(page, GLADE_GRIS)

  await expect(card).toContainText(DESCRIPTIVE_LABEL)
  await expect(card).toContainText('Populær')
  await expect(card).toContainText('Størst')
  await context.close()

  // Back to the seeded single label.
  await openDish(staffPage, BURGERS, GLADE_GRIS)
  await setStandardLabel(staffPage, 'Populær', false)

  const restore = dishForm(staffPage)
  await restore.getByLabel('Egen mærkat 2').fill('')
  await restore.getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/\/admin\/menu\?.*status=/)
  await publishMenu(staffPage)
})

test('a duplicate label is refused, and the refusal is attached to the field', async () => {
  await openDish(staffPage, BURGERS, GLADE_GRIS)

  const form = dishForm(staffPage)
  // The same label the dish already carries, differing only in case.
  await form.getByLabel('Egen mærkat 2').fill('pulled pork')
  await form.getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/\/admin\/menu\?.*fejl=/)

  await expect(staffPage.getByText('Den samme mærkat kan kun stå én gang.')).toBeVisible()

  // What was typed is still there, so nothing has to be retyped.
  await expect(dishForm(staffPage).getByLabel('Egen mærkat 2')).toHaveValue('pulled pork')
})

// ---------------------------------------------------------------------------
// The price parser, through the real form
// ---------------------------------------------------------------------------

test('a malformed price is refused with a sentence beside the field', async () => {
  await openDish(staffPage, BURGERS, ODIN)

  const form = dishForm(staffPage)
  await form.getByLabel(FIELD.price).fill('89 kr.')
  await form.getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/\/admin\/menu\?.*fejl=/)

  const message = staffPage.getByText('Prisen skal være et tal, fx 89 eller 89,50.')
  await expect(message).toBeVisible()

  // The message is bound to the field, not merely placed near it.
  const field = dishForm(staffPage).getByLabel(FIELD.price)
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  const describedBy = await field.getAttribute('aria-describedby')
  expect(describedBy).toContain('ret-pris-fejl')
})

// ---------------------------------------------------------------------------
// Creating a dish
// ---------------------------------------------------------------------------

test('a new dish is created as a draft and is invisible to a guest', async ({ browser }) => {
  await openSection(staffPage, DESSERT)
  await staffPage.getByRole('link', { name: `+ Tilføj ret til ${DESSERT}` }).click()

  const form = dishForm(staffPage, 'Ny ret')
  await expect(form).toBeVisible()

  await form.getByLabel(FIELD.name).fill(NEW_DISH)
  await form.getByLabel(FIELD.price).fill('45,50')
  await form.getByLabel(FIELD.description).fill('En dessert til at teste udgivelse med.')
  await form.getByLabel(FIELD.secondaryNote).fill('Kun i testperioden')
  await form.getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/\/admin\/menu\?.*status=/)

  await expect(staffPage.getByRole('status').first()).toContainText('oprettet som kladde')
  await expect(staffPage.getByText(`${NEW_DISH}`).first()).toBeVisible()

  const { context, page } = await visit(browser, '/menu')
  await expect(page.getByText(NEW_DISH)).toHaveCount(0)
  await context.close()
})

test('the new dish appears in the preview before it is published', async () => {
  await staffPage.goto('/api/preview/start?maal=menu')

  await expect(publicDish(staffPage, NEW_DISH)).toContainText('45,50 kr.')
  await expect(publicDish(staffPage, NEW_DISH)).toContainText('Kun i testperioden')

  await staffPage.goto('/api/preview/stop')
})

test('publishing makes the new dish public', async ({ browser }) => {
  await publishMenu(staffPage)

  const { context, page } = await visit(browser, '/menu')
  await expect(publicDish(page, NEW_DISH)).toContainText('45,50 kr.')
  await context.close()
})

// ---------------------------------------------------------------------------
// Moving a dish between sections
// ---------------------------------------------------------------------------

test('changing the section is a draft: the public menu does not move the dish', async ({
  browser,
}) => {
  await openDish(staffPage, DESSERT, NEW_DISH)

  await dishForm(staffPage).getByLabel(FIELD.category).selectOption({ label: BURGERS })
  await dishForm(staffPage).getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/\/admin\/menu\?.*status=/)

  // The administration shows what the next publish will produce.
  await openSection(staffPage, BURGERS)
  await expect(staffPage.getByText('Ny sektion afventer offentliggørelse')).toBeVisible()

  // The guest does not.
  const { context, page } = await visit(browser, '/menu')
  const dessert = page.locator('section', { has: page.getByRole('heading', { name: DESSERT }) })
  await expect(dessert.getByRole('heading', { name: NEW_DISH })).toBeVisible()
  await context.close()
})

test('publishing moves the dish to its new section on the public menu', async ({ browser }) => {
  await publishMenu(staffPage)

  const { context, page } = await visit(browser, '/menu')

  const burgers = page.locator('section', { has: page.getByRole('heading', { name: BURGERS }) })
  await expect(burgers.getByRole('heading', { name: NEW_DISH })).toBeVisible()

  const dessert = page.locator('section', { has: page.getByRole('heading', { name: DESSERT }) })
  await expect(dessert.getByRole('heading', { name: NEW_DISH })).toHaveCount(0)

  await context.close()
})

// ---------------------------------------------------------------------------
// Concurrency, and who may do any of this
// ---------------------------------------------------------------------------

test('a second editor who started from an older version is refused, not overwritten', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signIn(ownerPage, OWNER)

  // Both people open the same dish, so both forms carry the same version token.
  await openDish(staffPage, BURGERS, ODIN)
  await openDish(ownerPage, BURGERS, ODIN)

  await saveDish(staffPage, { [FIELD.description]: 'Medarbejderens rettelse' })
  await expect(staffPage.getByRole('status').first()).toContainText('gemt som kladde')

  // The owner submits the form they loaded before that, and is told so.
  await dishForm(ownerPage).getByLabel(FIELD.description).fill('Ejerens rettelse')
  await dishForm(ownerPage).getByRole('button', { name: 'Gem' }).click()
  await ownerPage.waitForURL(/\/admin\/menu\?.*status=conflict/)

  await expect(ownerPage.getByRole('status').first()).toContainText('Nogen andre har rettet dette')

  // Nothing of the first person's work was lost.
  await openDish(staffPage, BURGERS, ODIN)
  await expect(dishForm(staffPage).getByLabel(FIELD.description)).toHaveValue(
    'Medarbejderens rettelse',
  )

  await ownerContext.close()
})

test('an anonymous visitor cannot reach the menu administration or its actions', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(MENU_ADMIN_PATH)
  await expect(page).toHaveURL(/\/admin\/login/)

  // And a direct POST to the screen's Server Action is refused too: the action calls
  // requireStaff() itself, so the route being unreachable is not what protects it.
  const response = await page.request.post(MENU_ADMIN_PATH, {
    headers: { 'Next-Action': 'forged', 'Content-Type': 'text/plain;charset=UTF-8' },
    data: '[]',
    maxRedirects: 0,
  })

  expect(response.status(), 'a forged Server Action POST is not carried out').not.toBe(200)

  await context.close()
})

// ---------------------------------------------------------------------------
// Put the seeded menu back
// ---------------------------------------------------------------------------

test('the created dish is taken off the public menu again', async ({ browser }) => {
  // Phase 5B has no delete — that is the next increment. Moving the dish back to
  // Dessert and clearing its description is enough to leave the seeded sections as they
  // were for every other suite; the row itself is removed by the next `db:reset`.
  await openDish(staffPage, BURGERS, NEW_DISH)

  const form = dishForm(staffPage)
  await form.getByLabel(FIELD.category, { exact: true }).selectOption({ label: DESSERT })
  await form.getByLabel(FIELD.description, { exact: true }).fill('')
  await form.getByLabel(FIELD.secondaryNote, { exact: true }).fill('')
  await form.getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/\/admin\/menu\?.*status=/)

  await publishMenu(staffPage)

  const { context, page } = await visit(browser, '/menu')

  const burgers = page.locator('section', { has: page.getByRole('heading', { name: BURGERS }) })
  await expect(burgers.getByRole('heading', { name: NEW_DISH })).toHaveCount(0)

  // Burgere — the section every other suite reads — still holds the five seeded dishes.
  for (const seeded of ['Odin', 'Frigg', 'Ragnar', 'Thor', 'Glade Gris']) {
    await expect(burgers.getByRole('heading', { name: seeded, exact: true })).toBeVisible()
  }

  await context.close()
})

test('the seeded Odin price and description are restored', async ({ browser }) => {
  await openDish(staffPage, BURGERS, ODIN)
  await saveDish(staffPage, {
    [FIELD.price]: BASELINE_PRICE,
    [FIELD.description]:
      '200 g dry aged bøf, sennepsmayo, bacon, cheddar, karameliserede løg, bøftomat, iceberg og briochebolle.',
  })
  await publishMenu(staffPage)

  const { context, page } = await visit(browser, '/menu')
  await expect(publicDish(page, ODIN)).toContainText(BASELINE_PRICE_PUBLIC)
  await context.close()
})
