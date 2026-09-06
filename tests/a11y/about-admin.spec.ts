import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of the Om os editor — technical plan §9, design 1aa, 1i. Phase 14B1.
 *
 * §9 asks for axe on the administration's editors at 375 px and 1440 px; both the
 * `desktop` and the `mobile` project run this file, which is what gives the two
 * widths. It is **read-only**: the states reachable from the URL alone. The states
 * that need a write to reach (a pending card, a refusal, a chosen photograph, the
 * preview) are scanned inside `tests/e2e/about-admin.spec.ts`.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const PATH = '/admin/om-os'

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

let page: Page

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  page = await context.newPage()
  await signIn(page, STAFF)
})

test.afterAll(async () => {
  await page.context().close()
})

test('the editor has no accessibility violations', async () => {
  await page.goto(PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Om os')
  expect(await violations(page)).toEqual([])
})

test('every field has a real label, and the three slots are named', async () => {
  await page.goto(PATH)

  const story = page.getByRole('form', { name: 'Historien', exact: true })
  await expect(story.getByLabel('Overskrift', { exact: true })).toBeVisible()
  await expect(story.getByLabel('Historien', { exact: true })).toBeVisible()

  const team = page.getByRole('form', { name: 'Holdet', exact: true })
  await expect(team.getByLabel('Tekst om holdet', { exact: true })).toBeVisible()

  const method = page.getByRole('form', { name: 'Køkken og tilberedning', exact: true })
  await expect(method.getByLabel('Overskrift', { exact: true })).toBeVisible()
  await expect(method.getByLabel('Tekst', { exact: true })).toBeVisible()

  for (const label of ['Billede af stedet (valgfrit)', 'Holdfoto (valgfrit)', 'Køkkenfoto (valgfrit)']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }
  for (const slot of ['#vaelg-billede-sted', '#vaelg-billede-holdet', '#vaelg-billede-koekken']) {
    await expect(page.locator(slot)).toHaveText('Vælg billede')
  }

  for (const field of await page.locator('input:not([type=hidden]), textarea').all()) {
    const id = await field.getAttribute('id')
    expect(id, 'every visible field carries an id its label points at').not.toBeNull()
    await expect(page.locator(`label[for="${id}"]`).first()).toBeAttached()
  }
})

test('the image picker over the empty library is a labelled modal with the safe way out focused', async () => {
  await page.goto(`${PATH}?vaelg_billede=holdet`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName('Vælg billede')
  await expect(dialog.getByRole('link', { name: 'Annuller' })).toBeFocused()
  await expect(dialog).toContainText('Der er ingen billeder i biblioteket endnu.')

  expect(await violations(page)).toEqual([])
})

test('the editor does not scroll sideways at this width, and its fields are at least 16 px', async () => {
  await page.goto(PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Om os')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow).toBe(false)

  const sizes = await page
    .locator('input:not([type=hidden]), textarea')
    .evaluateAll((fields) => fields.map((field) => parseFloat(getComputedStyle(field).fontSize)))
  expect(sizes.length).toBeGreaterThan(0)
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16)
})
