import { expect, type Browser, type Locator, type Page } from '@playwright/test'

/**
 * Driving the news administration — design 1s / 1z, phase 9A.
 *
 * Everything here speaks the screen's own language: accessible names, visible labels
 * and the status vocabulary the actions redirect with. Nothing reaches the database —
 * a suite that restored state with SQL would be testing a different application than
 * the one a person uses, so cleanup is the same Slet flow the design draws.
 */

export const NEWS_ADMIN_PATH = '/admin/nyheder'

export async function openNewsAdmin(page: Page): Promise<void> {
  await page.goto(NEWS_ADMIN_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nyheder')
}

/** The list row carrying an article's title. */
export function listRow(page: Page, title: string): Locator {
  return page.getByRole('link', { name: new RegExp(title) })
}

export async function openArticleEditor(page: Page, title: string): Promise<void> {
  await openNewsAdmin(page)
  await listRow(page, title).click()
  await expect(editorForm(page)).toBeVisible()
}

export async function openNewEditor(page: Page): Promise<void> {
  await openNewsAdmin(page)
  await page.getByRole('link', { name: '+ Ny nyhed' }).click()
  await expect(page.getByRole('form', { name: 'Ny nyhed' })).toBeVisible()
}

/** The editor form, whichever of its two headings it carries. */
export function editorForm(page: Page): Locator {
  return page.getByRole('form', { name: /^(Ny nyhed|Rediger nyhed)$/ })
}

export async function fillArticle(
  page: Page,
  values: { title?: string; text?: string; date?: string; category?: string },
): Promise<void> {
  const form = editorForm(page)

  if (values.title !== undefined) await form.getByLabel('Overskrift').fill(values.title)
  if (values.text !== undefined) await form.getByLabel('Tekst').fill(values.text)
  if (values.date !== undefined) {
    await form.getByLabel('Dato på hjemmesiden').fill(values.date)
  }
  if (values.category !== undefined) {
    // The radio is `sr-only` behind the pill its label draws, so the label is what a
    // person presses — the same shape the announcement chips' helper uses.
    const chip = form.getByRole('radio', { name: values.category, exact: true })
    const id = await chip.getAttribute('id')
    expect(id, 'a category chip carries an id its label points at').not.toBeNull()

    await form.locator(`label[for="${id}"]`).click()
    await expect(chip).toBeChecked()
  }
}

/** Gem — and wait for the action's redirect, so a caller can navigate immediately. */
export async function saveArticle(page: Page): Promise<void> {
  await editorForm(page)
    .getByRole('button', { name: /^(Gem kladde|Gem ændringer)$/ })
    .click()
  await page.waitForURL(/\/admin\/nyheder\?.*status=/)
}

/** The state pill in the burgundy bar: "Kladde" or "Udgivet". */
export function stateBadge(page: Page): Locator {
  return page.getByRole('banner').getByText(/^(Kladde|Udgivet)$/)
}

/** The §7f address line under the title field. */
export function addressLine(page: Page): Locator {
  return editorForm(page).getByText(/^Adresse:/)
}

/** The slug the editor reports, read from the address line. */
export async function shownSlug(page: Page): Promise<string> {
  const text = await addressLine(page).innerText()
  const match = /\/nyheder\/([a-z0-9-]+)/.exec(text)

  expect(match, `the address line names a slug: ${text}`).not.toBeNull()
  return match![1]!
}

/**
 * Offentliggør: the footer link, then 1s's confirmation, then the redirect. The
 * confirmation is part of the promise, so it is asserted on the way through.
 */
export async function publishArticle(page: Page, title: string): Promise<void> {
  await page.getByRole('link', { name: 'Offentliggør' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(`Offentliggør “${title}”?`)
  await expect(dialog).toContainText('synlig på hjemmesiden og på forsiden')

  await dialog.getByRole('button', { name: 'Offentliggør' }).click()
  await page.waitForURL(/\/admin\/nyheder\?.*status=offentliggjort/)
}

/** Fjern fra hjemmesiden, through its confirmation. */
export async function unpublishArticle(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Fjern fra hjemmesiden' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('adressen holder op med at virke')

  await dialog.getByRole('button', { name: 'Fjern fra hjemmesiden' }).click()
  await page.waitForURL(/\/admin\/nyheder\?.*status=fjernet/)
}

/** Slet, through its confirmation. Ends on the list. */
export async function deleteArticle(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Slet', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('kan ikke fortrydes')

  await dialog.getByRole('button', { name: /^Slet nyhed/ }).click()
  await page.waitForURL(/\/admin\/nyheder\?status=slettet/)
}

/** Open the editor for `title` and delete the article — the cleanup path. */
export async function deleteArticleNamed(page: Page, title: string): Promise<void> {
  await openArticleEditor(page, title)
  await deleteArticle(page)
}

/**
 * One guest request, in a cookie-free context of its own — the **first** request
 * after whatever the caller just committed, which is exactly the §6 promise under
 * test. The callback receives the page; the context is closed afterwards.
 */
export async function asGuest<T>(
  browser: Browser,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    return await run(page)
  } finally {
    await context.close()
  }
}
