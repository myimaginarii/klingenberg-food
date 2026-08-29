import { expect, type Page } from '@playwright/test'

/**
 * Driving the menu administration, for the browser tests — design 1r / 1y.
 *
 * Everything on that screen is a link or a form, so these helpers do exactly what a
 * person does: follow a link, fill fields, press a button, wait for the redirect the
 * Server Action performs. No selector here reaches for a class name or a test id — the
 * screen is addressed the way a screen reader addresses it, which is also the surest
 * way for these tests to catch an accessibility regression.
 */

export const MENU_ADMIN_PATH = '/admin/menu'

/** The section chip, by the name a person reads. */
export async function openSection(page: Page, name: string): Promise<void> {
  await page.goto(MENU_ADMIN_PATH)
  await page.getByRole('navigation', { name: 'Menuens sektioner' }).getByRole('link', { name }).click()
  await page.waitForURL(/\/admin\/menu\?/)
}

/** Open one dish's editor panel from the list. */
export async function openDish(page: Page, section: string, dish: string): Promise<void> {
  await openSection(page, section)
  await page.getByRole('link', { name: new RegExp(`^${dish}`) }).first().click()
  await expect(page.getByRole('form', { name: 'Ret' })).toBeVisible()
}

/** The editor panel, addressed by its own accessible name. */
export function dishForm(page: Page, heading: 'Ret' | 'Ny ret' = 'Ret') {
  return page.getByRole('form', { name: heading })
}

/**
 * Fill the given fields and press Gem.
 *
 * The panel carries the version it was rendered from in a hidden field, so reopening
 * the dish before each save is what makes a save use the *current* version — and
 * deliberately not reopening it is how the concurrency test produces a stale one.
 */
export async function saveDish(
  page: Page,
  fields: Record<string, string>,
  heading: 'Ret' | 'Ny ret' = 'Ret',
): Promise<void> {
  const form = dishForm(page, heading)

  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value)
  }

  await form.getByRole('button', { name: 'Gem' }).click()
  await page.waitForURL(/\/admin\/menu\?.*status=/)
}

/**
 * Turn one of the four standard labels on or off.
 *
 * The control is a real checkbox drawn by its own wrapping label — the chip 1r draws —
 * and the checkbox itself is visually hidden. Clicking the chip is what a person does,
 * and it is what toggles the control; reaching past it to the hidden input would be
 * testing something nobody can do.
 */
export async function setStandardLabel(page: Page, label: string, on: boolean): Promise<void> {
  const form = dishForm(page)
  const checkbox = form.getByRole('checkbox', { name: label })

  if ((await checkbox.isChecked()) !== on) {
    await form
      .locator('label')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .click()
  }

  await expect(checkbox).toBeChecked({ checked: on })
}

/**
 * One dish's row in the open section, by the name a person reads.
 *
 * The list is a `<ul>` of rows, each holding the dish's link, its price and its
 * availability control — so scoping to the row is what keeps "Thor is udsolgt" from
 * being satisfied by the word appearing somewhere else on the screen.
 */
export function dishRow(page: Page, dish: string) {
  return page
    .getByRole('list', { name: /^Retter i / })
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`^${dish}`) }) })
    .first()
}

/**
 * The availability control in a dish's row.
 *
 * Found by its accessible name, which carries the current state *and* the dish — a
 * screen reader hears "Tilgængelig — Thor. Skift til udsolgt.", and so does this.
 */
export function availabilityControl(page: Page, dish: string, soldOut: boolean) {
  return dishRow(page, dish).getByRole('button', {
    name: new RegExp(`^${soldOut ? 'Udsolgt' : 'Tilgængelig'}.*${dish}`),
  })
}

/**
 * Press a dish's availability control and wait for the redirect the action performs.
 *
 * `soldOut` is the dish's state *now*; pressing changes it to the other one. Naming
 * the current state rather than the wanted one is deliberate: a test that presses the
 * control has to know what it is pressing, and a helper that quietly did nothing when
 * the dish was already in the wanted state would make "and now it changed" untrue.
 */
export async function toggleAvailability(
  page: Page,
  dish: string,
  soldOut: boolean,
): Promise<void> {
  await availabilityControl(page, dish, soldOut).click()
  await page.waitForURL(/\/admin\/menu\?/)
}

/** Is this dish currently sold out, as the administration reads it right now? */
export async function isSoldOut(page: Page, dish: string): Promise<boolean> {
  return availabilityControl(page, dish, true).isVisible()
}

/**
 * Put a dish into a known state, whatever it is in now.
 *
 * For the `beforeAll` baseline and for restoring between scenarios — never inside an
 * assertion, where the point is that a specific press had a specific effect.
 */
export async function ensureAvailability(
  page: Page,
  section: string,
  dish: string,
  soldOut: boolean,
): Promise<void> {
  await openSection(page, section)

  if ((await isSoldOut(page, dish)) !== soldOut) {
    await toggleAvailability(page, dish, !soldOut)
  }

  await expect(availabilityControl(page, dish, soldOut)).toBeVisible()
}

/** The green Fortryd strip an immediate availability change leaves behind (1r / 1y). */
export function undoStrip(page: Page) {
  return page.getByRole('status').filter({ has: page.getByRole('button', { name: /^Fortryd/ }) })
}

/** Press the menu screen's own Offentliggør ændringer, and wait for the report. */
export async function publishMenu(page: Page): Promise<void> {
  await page.goto(MENU_ADMIN_PATH)
  await page.getByRole('button', { name: 'Offentliggør ændringer' }).click()
  await page.waitForURL(/\/admin\/menu\?.*status=/)
}

/**
 * One dish's card on the public menu.
 *
 * A described dish renders as an `<article>` with the name as its heading (1h), so the
 * card is found by the name a guest reads rather than by a class or a test id.
 */
export function publicDish(page: Page, dish: string) {
  return page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: dish, exact: true }) })
    .first()
}

/**
 * The deletion confirmation, addressed by the question it asks (phase 5D).
 *
 * A native `<dialog>` opened with `showModal()`, so Playwright's `dialog` role finds it
 * and its accessible name is the heading — which is what a screen reader announces too.
 */
export function deleteDialog(page: Page) {
  return page.getByRole('dialog')
}

/** Open a dish's editor and press Slet ret. Nothing is deleted by this. */
export async function openDeleteConfirmation(
  page: Page,
  section: string,
  dish: string,
): Promise<void> {
  await openDish(page, section, dish)
  await page.getByRole('link', { name: new RegExp(`^Slet ret — ${dish}$`) }).click()
  await expect(deleteDialog(page)).toBeVisible()
}

/**
 * Confirm the open dialog, and wait for the redirect the action performs.
 *
 * The wait names a parameter the *result* carries — the Fortryd offer, or a refusal
 * code — rather than the path. The confirmation is itself a `/admin/menu?…` address, so
 * a pattern that only matched the path would resolve before the action had answered,
 * and a caller reading `page.url()` afterwards would read the address it started from.
 */
export async function confirmDelete(page: Page): Promise<void> {
  await deleteDialog(page).getByRole('button', { name: /^Slet ret/ }).click()
  await page.waitForURL(/\/admin\/menu\?.*(fortryd_slet=|status=)/)
}

/** Cancel the open dialog, and wait for the navigation back to the editor. */
export async function cancelDelete(page: Page): Promise<void> {
  await deleteDialog(page).getByRole('link', { name: 'Behold ret' }).click()
  await page.waitForURL(/#slet-ret$/)
}

/**
 * Restore a dish through the Fortryd strip the deletion left behind.
 *
 * Deliberately not a helper that "restores a dish by id": the strip is the only path
 * this administration offers, and a test that reached past it would stop testing the
 * thing that has to work.
 */
export async function pressDeleteUndo(page: Page): Promise<void> {
  await undoStrip(page).getByRole('button', { name: /^Fortryd/ }).click()
  // Same reason as `confirmDelete`: the strip is rendered on a `/admin/menu?…` address,
  // so the wait has to name something only the answer carries.
  await page.waitForURL(/\/admin\/menu\?.*status=/)
}
