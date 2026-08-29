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
