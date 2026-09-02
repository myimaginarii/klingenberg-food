import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  cancelDelete,
  confirmDelete,
  deleteDialog,
  dishRow,
  MENU_ADMIN_PATH,
  openDeleteConfirmation,
  openDish,
  openSection,
  pressDeleteUndo,
  publicDish,
  saveDish,
  undoStrip,
} from './support/menu-admin'
import { waitForPublicShell } from './support/public-shell'

/**
 * Slet ret — technical plan §6, §7e item 4; design 1r / 1y / 1aa.
 *
 * Two promises, and the second is the one this suite exists for:
 *
 *   1. **The dish leaves the hjemmeside before the page has finished loading.** No
 *      draft, no preview, no publish — and Fortryd is a second write, not a rollback.
 *   2. **Deleting a dish that Forsiden features does not change Forsiden.** Forsiden is
 *      Owner-only (§5). A Staff member removing a burger mid-shift is warned about the
 *      consequence, the dish stops appearing there, and the Owner's document is left
 *      exactly as they wrote it — which is also why Fortryd brings the dish back to
 *      Forsiden with no further action.
 *
 * So the suite is written from the guest's side as much as from the staff member's, and
 * the guest is a genuinely separate browser context that has never signed in. Between
 * the two it also asserts what *did not* happen: no draft was lost, no homepage
 * reference was rewritten, and nothing was hard-deleted.
 *
 * It runs in order and shares one signed-in page, because it is one story. Every
 * scenario restores what it moved, so an interrupted run leaves the next one unaffected
 * and the database ends where the seed left it.
 */

test.describe.configure({ mode: 'serial' })

const BURGERS = 'Burgere'

/** The dish the design's own confirmation is written about, and a Forside feature. */
const ODIN = 'Odin'

/** A published dish Forsiden does not feature. The control. */
const THOR = 'Thor'

/** A visitor: a browser that has never signed in and holds no cookie. */
async function visit(browser: Browser, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(path)
  // `isPublic` below asks `count()`, which answers immediately — the streamed shell has
  // to be in the document first, or a dish that is on the page reads as missing.
  await waitForPublicShell(page)

  return { context, page }
}

/** Is this dish on the public page at `path` right now? */
async function isPublic(browser: Browser, path: string, dish: string): Promise<boolean> {
  const { context, page } = await visit(browser, path)
  const found = await publicDish(page, dish).count()
  await context.close()

  return found > 0
}

let staffPage: Page

/**
 * The address a deletion redirected to, kept from one test to the next.
 *
 * The Fortryd offer lives in the query string rather than in server memory, so
 * returning to that address is how a later test gets the strip back. That is worth
 * asserting in its own right: the undo is a plain authorized write bound to a version
 * token, not a session-held token that expires with a timer.
 */
let undoUrl = ''

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
})

test.afterAll(async () => {
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// The confirmation — design 1r's "Slet spørger altid"
// ---------------------------------------------------------------------------

test('Slet ret opens a confirmation and deletes nothing by itself', async ({ browser }) => {
  await openDeleteConfirmation(staffPage, BURGERS, ODIN)

  await expect(deleteDialog(staffPage)).toHaveAccessibleName(`Slet ${ODIN}?`)
  await expect(deleteDialog(staffPage)).toContainText('Den forsvinder fra hjemmesiden.')

  // Nothing has happened: the section still holds all five burgers, and the dish is
  // still on the public menu. The count is read from the chip rather than from the list,
  // because at 375 px the editor panel replaces the list (1y) and the list is not on
  // screen to count.
  await expect(
    staffPage.getByRole('navigation', { name: 'Menuens sektioner' }).getByRole('link', {
      name: /^Burgere/,
    }),
  ).toHaveAccessibleName(/5 retter/)

  expect(await isPublic(browser, '/menu', ODIN)).toBe(true)
})

test('a featured dish is warned about, in words a guest’s screen would recognise', async () => {
  await expect(deleteDialog(staffPage)).toContainText(
    'Denne ret vises også på forsiden. Den forsvinder derfra, men forsiden bliver ikke ændret permanent.',
  )

  // The warning is a block with its own icon and its own border, not a colour (1aa) —
  // and it never names the document it is talking about.
  await expect(deleteDialog(staffPage)).not.toContainText('pages')
  await expect(deleteDialog(staffPage)).not.toContainText('featured')
})

test('the dialog is modal: focus is inside it, and clicking outside does not dismiss', async () => {
  const dialog = deleteDialog(staffPage)

  // The platform's own modality, from `showModal()`.
  expect(await dialog.evaluate((node: HTMLDialogElement) => node.matches(':modal'))).toBe(true)

  // Focus moved into the dialog, and onto the *safe* choice.
  await expect(dialog.getByRole('link', { name: 'Behold ret' })).toBeFocused()

  // A press on the page behind it changes nothing: the backdrop swallows it, and the
  // dialog is still there. 1ae: "Arket kan ikke lukkes ved at trykke udenfor."
  await staffPage.mouse.click(8, 8)
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((node: HTMLDialogElement) => node.matches(':modal'))).toBe(true)
})

test('focus is trapped while the dialog is open', async () => {
  // Tab all the way round, several times over. Nothing on the page behind the dialog is
  // ever reached — the list, the editor panel and the header are inert, which is what
  // `showModal()` guarantees and what an overlaid `<div>` could not.
  //
  // The one stop that is not *inside* the dialog is `<body>`: leaving the last control
  // of a modal hands focus to the browser's own chrome, and the document reports the
  // body while it is gone. That is the platform's wrap-around, not an escape — so it is
  // named here rather than asserted away.
  const reached: string[] = []

  for (let step = 0; step < 8; step += 1) {
    await staffPage.keyboard.press('Tab')

    reached.push(
      await staffPage.evaluate(() => {
        const active = document.activeElement
        if (active === null) return 'nothing'
        if (active === document.body || active === document.documentElement) return 'body'

        const open = document.querySelector('dialog[open]')
        return open !== null && open.contains(active) ? 'dialog' : `outside: ${active.tagName}`
      }),
    )
  }

  expect(reached.filter((stop) => stop.startsWith('outside'))).toEqual([])
  expect(reached, 'the dialog’s own controls are reachable').toContain('dialog')
})

test('both controls are at least 44 px, and the destructive one says what it does', async () => {
  const dialog = deleteDialog(staffPage)

  for (const name of ['Behold ret', `Slet ret — ${ODIN}`]) {
    const control = dialog.getByRole(name === 'Behold ret' ? 'link' : 'button', {
      name: new RegExp(`^${name}`),
    })
    const box = await control.boundingBox()

    expect(box?.height ?? 0, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(44)
  }

  // WCAG 2.5.3: the visible word comes first; the dish is the rest of the name.
  await expect(dialog.getByRole('button')).toHaveAccessibleName(`Slet ret — ${ODIN}`)
})

test('the confirmation has no accessibility violations', async () => {
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

test('Behold ret cancels and gives the keyboard back to the control it came from', async () => {
  await cancelDelete(staffPage)

  await expect(deleteDialog(staffPage)).toHaveCount(0)
  await expect(staffPage.getByRole('link', { name: `Slet ret — ${ODIN}` })).toBeFocused()
})

// ---------------------------------------------------------------------------
// The deletion itself — live at once, and Fortryd
// ---------------------------------------------------------------------------

test('confirming removes the dish from the administration and from the menu', async ({
  browser,
}) => {
  await openDeleteConfirmation(staffPage, BURGERS, ODIN)
  await confirmDelete(staffPage)

  undoUrl = staffPage.url()
  expect(undoUrl, 'the Fortryd offer travels in the address').toContain('fortryd_slet=')

  // Gone from the active list — a deleted dish is not something anybody is editing.
  await expect(dishRow(staffPage, ODIN)).toHaveCount(0)

  // And gone from the hjemmeside on the next request. No publish was needed.
  expect(await isPublic(browser, '/menu', ODIN)).toBe(false)
})

test('Fortryd is offered, does not steal focus, and is a large enough target', async () => {
  const strip = undoStrip(staffPage)
  await expect(strip).toContainText(`«${ODIN}» er fjernet fra hjemmesiden.`)

  // 1aa: "De stjæler aldrig tastaturfokus."
  const focusedInStrip = await staffPage.evaluate(() => {
    const active = document.activeElement
    const status = document.querySelector('[role="status"]')
    return active !== null && status !== null && status.contains(active)
  })
  expect(focusedInStrip, 'the strip did not take focus').toBe(false)

  const box = await strip.getByRole('button', { name: /^Fortryd/ }).boundingBox()
  expect(box?.height ?? 0, 'Fortryd is at least 44 px tall').toBeGreaterThanOrEqual(44)
})

test('the deletion created no draft and nothing to publish', async () => {
  await staffPage.goto('/admin')
  await expect(staffPage.getByText(`Ret: ${ODIN}`)).toHaveCount(0)
})

test('the Forside drops the dish, stays valid, and is not rewritten', async ({ browser }) => {
  const { context, page } = await visit(browser, '/')

  // No dangling object, no error page, no hole where the third card was: the section
  // still renders, with the two references that still resolve.
  await expect(page.getByRole('heading', { name: 'Tre fra menuen' })).toBeVisible()
  await expect(publicDish(page, ODIN)).toHaveCount(0)
  await expect(publicDish(page, 'Frigg')).toHaveCount(1)
  await expect(publicDish(page, 'Ragnar')).toHaveCount(1)

  expect(await context.cookies(), 'a guest is still given no cookie at all').toEqual([])

  await context.close()
})

test('Fortryd brings the dish back — to the menu and to the Forside', async ({ browser }) => {
  // The offer is in the address, not in a session, so returning to it brings the strip
  // back and the version token it carries is still the one that write produced.
  await staffPage.goto(undoUrl)
  await pressDeleteUndo(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText('Retten er hentet tilbage')

  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, ODIN)).toHaveCount(1)

  expect(await isPublic(browser, '/menu', ODIN)).toBe(true)

  // The Forside reference was never touched, so the dish returns there by itself —
  // nobody has to go and put it back.
  expect(await isPublic(browser, '/', ODIN)).toBe(true)
})

test('the restore offers no one-click deletion of its own', async () => {
  // The reverse of "put it back" is "delete it", and this screen never deletes without
  // asking (§4 of the phase brief). So the restore reports and finishes.
  await expect(undoStrip(staffPage)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// A dish with a draft, and a dish that was never published
// ---------------------------------------------------------------------------

test('a draft survives a deletion and comes back with the dish', async () => {
  await openDish(staffPage, BURGERS, THOR)
  await saveDish(staffPage, { 'Pris (kr.)': '95' })

  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, THOR)).toContainText('Kladde')

  await openDeleteConfirmation(staffPage, BURGERS, THOR)
  await confirmDelete(staffPage)
  await expect(dishRow(staffPage, THOR)).toHaveCount(0)

  await pressDeleteUndo(staffPage)
  await openSection(staffPage, BURGERS)

  // Back, with the pending price still pending. Deletion published nothing and cleared
  // nothing.
  await expect(dishRow(staffPage, THOR)).toContainText('Kladde')
  await expect(dishRow(staffPage, THOR)).toContainText('Ny pris afventer offentliggørelse')

  await openDish(staffPage, BURGERS, THOR)
  await expect(staffPage.getByRole('form', { name: 'Ret' }).getByLabel('Pris (kr.)')).toHaveValue(
    '95',
  )

  // Put the price back, so the suite leaves the seed as it found it.
  await saveDish(staffPage, { 'Pris (kr.)': '89' })
  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, THOR)).not.toContainText('Kladde')
})

test('a dish that was never published is asked about in its own words', async ({ browser }) => {
  await staffPage.goto(`${MENU_ADMIN_PATH}?sektion=burgere&ny=1`)
  await saveDish(staffPage, { Navn: 'Testret 5D', 'Pris (kr.)': '75' }, 'Ny ret')

  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, 'Testret 5D')).toContainText('Ny ret')
  expect(await isPublic(browser, '/menu', 'Testret 5D')).toBe(false)

  await openDeleteConfirmation(staffPage, BURGERS, 'Testret 5D')

  // No promise about a hjemmeside it has never been on, and no Forside warning either.
  await expect(deleteDialog(staffPage)).toContainText(
    'Den er ikke offentliggjort endnu, så den forsvinder kun herfra.',
  )
  await expect(deleteDialog(staffPage)).not.toContainText('forsiden')

  await confirmDelete(staffPage)
  await expect(undoStrip(staffPage)).toContainText('«Testret 5D» er fjernet fra listen.')
  expect(await isPublic(browser, '/menu', 'Testret 5D')).toBe(false)

  // Restoring puts it back as an unpublished draft — restoring is not publishing.
  await pressDeleteUndo(staffPage)
  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, 'Testret 5D')).toContainText('Ny ret')
  expect(await isPublic(browser, '/menu', 'Testret 5D')).toBe(false)

  // And take it away again, for good, so the seed is left as it was found.
  await openDeleteConfirmation(staffPage, BURGERS, 'Testret 5D')
  await confirmDelete(staffPage)
  await expect(dishRow(staffPage, 'Testret 5D')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Who may do it, and what a stale request gets (§5, §6, §8)
// ---------------------------------------------------------------------------

test('the owner may delete and restore too', async ({ browser }) => {
  const context = await browser.newContext()
  const ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)

  await openDeleteConfirmation(ownerPage, BURGERS, THOR)
  await confirmDelete(ownerPage)
  await expect(dishRow(ownerPage, THOR)).toHaveCount(0)

  await pressDeleteUndo(ownerPage)
  await openSection(ownerPage, BURGERS)
  await expect(dishRow(ownerPage, THOR)).toHaveCount(1)

  await context.close()
})

test('a colleague’s edit refuses a stale deletion rather than winning over it', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const otherPage = await context.newPage()
  await signIn(otherPage, OWNER)

  // One person opens the confirmation. The version in its form is the row as it stands
  // right now.
  await openDeleteConfirmation(staffPage, BURGERS, THOR)

  // A colleague edits the same dish in between.
  await openDish(otherPage, BURGERS, THOR)
  await saveDish(otherPage, { 'Pris (kr.)': '91' })

  // The deletion is refused, and says so in the design's own words.
  await deleteDialog(staffPage).getByRole('button', { name: /^Slet ret/ }).click()
  await staffPage.waitForURL(/\/admin\/menu\?.*status=conflict/)
  await expect(staffPage.getByRole('status').first()).toContainText('Nogen andre har rettet dette')

  // Nothing was deleted, and the colleague's work stands.
  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, THOR)).toHaveCount(1)
  await expect(dishRow(staffPage, THOR)).toContainText('Kladde')

  // Clean up the colleague's draft.
  await openDish(otherPage, BURGERS, THOR)
  await saveDish(otherPage, { 'Pris (kr.)': '89' })
  await context.close()
})

test('a stale Fortryd is refused once the row has moved on', async () => {
  await openDeleteConfirmation(staffPage, BURGERS, THOR)
  await confirmDelete(staffPage)

  const staleUndo = staffPage.url()

  // Restore it through the strip, which moves the version on.
  await pressDeleteUndo(staffPage)
  await openSection(staffPage, BURGERS)
  await expect(dishRow(staffPage, THOR)).toHaveCount(1)

  // The old offer still renders — the dish is not deleted any more, so it should not.
  await staffPage.goto(staleUndo)
  await expect(undoStrip(staffPage)).toHaveCount(0)
  await expect(dishRow(staffPage, THOR)).toHaveCount(1)
})

test('a Fortryd strip built by hand for a dish that is not deleted shows nothing', async () => {
  await staffPage.goto(
    `${MENU_ADMIN_PATH}?sektion=burgere&fortryd_slet=00000000-0000-4000-8000-000000000000` +
      '&fortryd_slet_version=2026-01-01T00%3A00%3A00.000Z',
  )

  await expect(undoStrip(staffPage)).toHaveCount(0)
  await expect(staffPage.getByRole('list', { name: /^Retter i / })).toBeVisible()
})

test('an anonymous visitor cannot reach the deletion action', async ({ browser }) => {
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

test('and every dish is untouched by the anonymous attempt', async ({ browser }) => {
  const { context, page } = await visit(browser, '/menu')

  for (const dish of [ODIN, THOR, 'Frigg', 'Ragnar']) {
    await expect(publicDish(page, dish)).toHaveCount(1)
  }

  await context.close()
})

// ---------------------------------------------------------------------------
// Forged and over-reaching requests (§8, §9 of the phase brief)
// ---------------------------------------------------------------------------

test('the deletion form cannot be extended past deleted_at', async ({ browser }) => {
  // The negative promise, tried rather than assumed. The confirmation's own form is
  // rewritten in the page to carry a price, a name, a description, a category, a draft,
  // a sold-out date and a homepage reference alongside the intent, and then submitted.
  // None of them arrives anywhere: `readDeleteForm` reads four named fields and builds
  // its request from those alone, and `set_dish_deleted` names two columns in one
  // UPDATE.
  await openDeleteConfirmation(staffPage, BURGERS, ODIN)

  await staffPage.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>('dialog form')
    if (form === null) throw new Error('no deletion form')

    for (const [name, value] of Object.entries({
      navn: 'Forfalsket navn',
      pris: '1',
      beskrivelse: 'Forfalsket beskrivelse',
      sektion_id: '00000000-0000-4000-8000-000000000000',
      draft: '{"price_ore":1}',
      udsolgt: '1',
      sold_out_on: '2030-01-01',
      featured_dish_ids: '[]',
      key: 'home',
    })) {
      const field = document.createElement('input')
      field.type = 'hidden'
      field.name = name
      field.value = value
      form.append(field)
    }

    form.querySelector('button')?.click()
  })

  await staffPage.waitForURL(/\/admin\/menu\?.*fortryd_slet=/)

  // The deletion happened, because that is what the form was for. Nothing else did.
  await pressDeleteUndo(staffPage)
  await openDish(staffPage, BURGERS, ODIN)

  const form = staffPage.getByRole('form', { name: 'Ret' })
  await expect(form.getByLabel('Navn')).toHaveValue(ODIN)
  await expect(form.getByLabel('Pris (kr.)')).toHaveValue('89')
  await expect(form.getByLabel('Beskrivelse')).not.toHaveValue('Forfalsket beskrivelse')
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  // The dish is available, not sold out: the forged `udsolgt` reached no column.
  await expect(staffPage.getByRole('form', { name: 'Tilgængelighed' })).toContainText(
    'Tilgængelig',
  )

  // And the Forside still shows all three, from the reference the Owner wrote.
  expect(await isPublic(browser, '/', ODIN)).toBe(true)
})

test('a Staff member still cannot edit Forsiden — before or after deleting from it', async () => {
  // The permission boundary the phase brief asks to be negative-tested. Deleting a dish
  // Forsiden features must not become a door into the Owner-only document, and it does
  // not: the deletion never touched `pages.home`, and the Forsiden editor is exactly as
  // closed to this staff member as it was before phase 5D existed.
  // Since phase 11A the Forside's approved editor is its own screen (1u), and §5's
  // treatment for an Owner-only area is absence: the address sends a staff member to
  // the "no access" page, and no form of the Forside's is rendered for them at all.
  await staffPage.goto('/admin/forsiden')
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
  await expect(staffPage.getByRole('form', { name: 'Øverst på siden' })).toHaveCount(0)
  await expect(staffPage.getByRole('form', { name: 'Udvalgte burgere (vælg 3)' })).toHaveCount(0)

  // The phase-4 content screen no longer offers the Forside to anybody.
  await staffPage.goto('/admin/indhold')
  await expect(staffPage.getByRole('form', { name: 'Rediger Forsiden' })).toHaveCount(0)
})

/**
 * With JavaScript switched off — technical plan §7e (item 11).
 *
 * The administration is allowed to require JavaScript, and this part of it does not.
 * Every step is a link or a form: Slet ret navigates, the confirmation posts, Fortryd
 * posts. What is lost is only the enhancement — the confirmation is an ordinary block
 * at the end of the screen rather than a modal in the top layer, and the Fortryd strip
 * is not taken away after ten seconds. Both of those are presentation; neither is the
 * mechanism.
 *
 * Asserted rather than assumed, because "it is only a form" is exactly the kind of
 * claim that stops being true the first time somebody reaches for an onClick — and for
 * a destructive action, a confirmation that quietly stopped appearing would be the
 * worst possible way to find that out.
 */
test('Slet ret, its confirmation and its Fortryd work with JavaScript switched off', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    // The same pairing the `no-javascript` project uses: the site's smooth scrolling is
    // CSS, so it survives JavaScript being switched off, and Slet ret sits at the foot
    // of the editor panel. Reduced motion turns the scroll into an instant jump, which
    // is what makes a click on a control below the fold deterministic — and it is a
    // mode the administration genuinely supports (1aa), so this pass covers both.
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await signIn(page, STAFF)

  await openDeleteConfirmation(page, BURGERS, THOR)

  // Server-rendered, `open`, and readable — not a modal, because `showModal()` needs a
  // script, but a complete confirmation all the same.
  const dialog = deleteDialog(page)
  await expect(dialog).toHaveAccessibleName(`Slet ${THOR}?`)
  await expect(dialog).toContainText('Den forsvinder fra hjemmesiden.')
  expect(await dialog.evaluate((node: HTMLDialogElement) => node.matches(':modal'))).toBe(false)

  // Cancelling is a plain link, so it works too, and lands back on the control.
  await cancelDelete(page)
  await expect(page.getByRole('link', { name: `Slet ret — ${THOR}` })).toBeVisible()

  await openDeleteConfirmation(page, BURGERS, THOR)
  await confirmDelete(page)
  await expect(dishRow(page, THOR)).toHaveCount(0)

  // The message is server-rendered, so it is there without the client component that
  // would normally take it away again — and Fortryd is a second real write.
  await expect(undoStrip(page)).toContainText(`«${THOR}» er fjernet fra hjemmesiden.`)
  await pressDeleteUndo(page)

  await openSection(page, BURGERS)
  await expect(dishRow(page, THOR)).toHaveCount(1)

  await context.close()
})

// ---------------------------------------------------------------------------
// Leaving the seed as it was found
// ---------------------------------------------------------------------------

/**
 * The last word, and not a formality.
 *
 * This suite deletes real dishes from a real database, and the suites that ran before
 * it — and the ones a later phase will add — read those dishes. A run that ends with a
 * dish still deleted would fail somebody else's test with a message about the Forside.
 * Each scenario above restores what it moved; this asserts that they did.
 */
test('every seeded dish is present again, with no draft left behind', async ({ browser }) => {
  await openSection(staffPage, BURGERS)

  for (const dish of [ODIN, 'Frigg', 'Ragnar', THOR, 'Glade Gris']) {
    await expect(dishRow(staffPage, dish)).toHaveCount(1)
    await expect(dishRow(staffPage, dish)).not.toContainText('Kladde')
  }

  await expect(dishRow(staffPage, 'Testret 5D')).toHaveCount(0)

  const { context, page } = await visit(browser, '/')
  await expect(publicDish(page, ODIN)).toHaveCount(1)
  await expect(publicDish(page, 'Frigg')).toHaveCount(1)
  await expect(publicDish(page, 'Ragnar')).toHaveCount(1)
  await context.close()
})
