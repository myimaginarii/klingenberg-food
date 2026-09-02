import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Rediger forsiden — technical plan §9, design 1aa, 1u. Phase 11A.
 *
 * §9 asks for axe on the administration's editors at 375 px and 1440 px; both the
 * `desktop` and the `mobile` project run this file, which is what gives the two
 * widths.
 *
 * It is **read-only**. The states reachable from the URL alone — the editor as the
 * seed leaves it, the image picker over the empty library, the dish picker over the
 * menu — are scanned here. The states that need a write to reach (a pending card,
 * a refusal bound to its field, a chosen photograph, the preview) are scanned inside
 * `tests/e2e/homepage-admin.spec.ts`, where they can be produced honestly and
 * cleaned up again.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const HOME_PATH = '/admin/forsiden'

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
  await signIn(page, OWNER)
})

test.afterAll(async () => {
  await page.context().close()
})

test('the editor has no accessibility violations', async () => {
  await page.goto(HOME_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rediger forsiden')

  expect(await violations(page)).toEqual([])
})

test('every field on the three text cards has a real label, in 1u\'s words', async () => {
  await page.goto(HOME_PATH)

  const hero = page.getByRole('form', { name: 'Øverst på siden', exact: true })
  await expect(hero.getByLabel('Overskrift', { exact: true })).toBeVisible()
  await expect(hero.getByLabel('Kort tekst under', { exact: true })).toBeVisible()

  const award = page.getByRole('form', { name: 'Udmærkelsen', exact: true })
  await expect(award.getByLabel('Tekst om udmærkelsen', { exact: true })).toBeVisible()
  await expect(award.getByLabel('Et par ord om udmærkelsen', { exact: true })).toBeVisible()

  const about = page.getByRole('form', { name: 'Om os (uddrag)', exact: true })
  await expect(about.getByLabel('Overskrift', { exact: true })).toBeVisible()
  await expect(about.getByLabel('Tekst', { exact: true })).toBeVisible()
})

test('the image picker over the empty library is a labelled modal with the safe way out focused', async () => {
  await page.goto(`${HOME_PATH}?vaelg_billede=hero`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName('Vælg billede')
  await expect(dialog.getByRole('link', { name: 'Annuller' })).toBeFocused()
  await expect(dialog).toContainText('Der er ingen billeder i biblioteket endnu.')

  expect(await violations(page)).toEqual([])
})

test('the dish picker lists the menu by section, marks the chosen dish, and is a labelled modal', async () => {
  await page.goto(`${HOME_PATH}?vaelg_ret=0`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName('Skift retten på plads 1')
  await expect(dialog.getByRole('heading', { name: 'Burgere' })).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'Annuller' })).toBeFocused()
  // The slot's current dish is marked by words, never colour alone (1aa).
  await expect(dialog.getByRole('button', { name: /^✓ Valgt/ })).toHaveCount(1)

  expect(await violations(page)).toEqual([])
})

test('the editor does not scroll sideways at this width', async () => {
  await page.goto(HOME_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rediger forsiden')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow).toBe(false)
})

test('a Staff member is sent to the "no access" page, not shown a locked form', async ({ browser }) => {
  const context = await browser.newContext()
  const staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  await staffPage.goto(HOME_PATH)
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
  await expect(staffPage.getByRole('form', { name: 'Øverst på siden' })).toHaveCount(0)

  await context.close()
})
