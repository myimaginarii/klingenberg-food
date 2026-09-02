import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Mad ud af huset's editor — technical plan §9, design 1aa, 1aj.
 * Phase 11B.
 *
 * §9 asks for axe on the administration's editors at 375 px and 1440 px; both the
 * `desktop` and the `mobile` project run this file, which is what gives the two
 * widths. It is **read-only**: the states reachable from the URL alone. The states
 * that need a write to reach (a pending card, a refusal, a chosen photograph, the
 * hidden public state) are scanned inside `tests/e2e/takeaway-admin.spec.ts`.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const PATH = '/admin/mad-ud-af-huset'

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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mad ud af huset')
  expect(await violations(page)).toEqual([])
})

test('every field has a real label, in 1aj\'s words, and the switch is a labelled checkbox', async () => {
  await page.goto(PATH)

  const text = page.getByRole('form', { name: 'Tekst', exact: true })
  await expect(text.getByLabel('Overskrift', { exact: true })).toBeVisible()
  await expect(text.getByLabel('Intro', { exact: true })).toBeVisible()

  const cta = page.getByRole('form', { name: 'Knap nederst', exact: true })
  await expect(cta.getByLabel('Tekst på knappen', { exact: true })).toBeVisible()

  const sections = page.getByRole('form', { name: 'Tekstafsnit', exact: true })
  // Composed names: the section's heading plus the field's own label (the Tapas rule).
  await expect(sections.getByRole('textbox', { name: 'Afsnit 1 Overskrift på afsnittet', exact: true })).toBeVisible()
  await expect(sections.getByRole('textbox', { name: 'Afsnit 1 Skriv afsnittet her', exact: true })).toBeVisible()

  const visibility = page.getByRole('form', { name: 'Vis siden på hjemmesiden', exact: true })
  await expect(visibility.getByRole('checkbox', { name: 'Siden vises' })).toBeChecked()

  for (const field of await page.locator('input:not([type=hidden]), textarea').all()) {
    const id = await field.getAttribute('id')
    expect(id, 'every visible field carries an id its label points at').not.toBeNull()
    await expect(page.locator(`label[for="${id}"]`).first()).toBeAttached()
  }
})

test('the image picker over the empty library is a labelled modal with the safe way out focused', async () => {
  await page.goto(`${PATH}?vaelg_billede=1`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName('Vælg billede')
  await expect(dialog.getByRole('link', { name: 'Annuller' })).toBeFocused()
  await expect(dialog).toContainText('Der er ingen billeder i biblioteket endnu.')

  expect(await violations(page)).toEqual([])
})

test('the editor does not scroll sideways at this width', async () => {
  await page.goto(PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mad ud af huset')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow).toBe(false)
})
