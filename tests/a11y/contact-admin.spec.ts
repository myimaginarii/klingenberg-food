import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Kontaktoplysninger — technical plan §9, design 1aa, 1v. Phase 11B.
 *
 * Read-only, at both widths (the `desktop` and `mobile` projects). The states that
 * need a write — a pending field, a refusal, the enabled Offentliggør — are scanned
 * inside `tests/e2e/contact-admin.spec.ts`.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const PATH = '/admin/kontakt'

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
  await page.goto(PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kontaktoplysninger')
  expect(await violations(page)).toEqual([])
})

test('every field has a real label in 1v\'s words, with its helper bound to it', async () => {
  await page.goto(PATH)
  const form = page.getByRole('form', { name: 'Kontaktoplysninger', exact: true })

  for (const label of [
    'Primært telefonnummer',
    'Ekstra telefonnummer (valgfrit)',
    'Adresse',
    'Postnummer',
    'By',
    'E-mail (valgfrit)',
    'Facebook',
  ]) {
    await expect(form.getByLabel(label, { exact: true }), label).toBeVisible()
  }

  const primary = form.getByLabel('Primært telefonnummer', { exact: true })
  const describedBy = await primary.getAttribute('aria-describedby')
  await expect(page.locator(`#${describedBy}`)).toHaveText('Bruges af alle Ring-knapper og står størst på Find os.')

  for (const field of await page.locator('input:not([type=hidden])').all()) {
    const id = await field.getAttribute('id')
    expect(id).not.toBeNull()
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1)
  }
})

test('the greyed Offentliggør announces why, and is a 44 px target', async () => {
  await page.goto(PATH)
  const button = page.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ })
  await expect(button).toBeDisabled()
  const describedBy = await button.getAttribute('aria-describedby')
  await expect(page.locator(`#${describedBy}`)).toContainText('nedtonet')
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('the editor does not scroll sideways at this width', async () => {
  await page.goto(PATH)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow).toBe(false)
})

test('a Staff member is sent to the "no access" page, not shown a locked form', async ({ browser }) => {
  const context = await browser.newContext()
  const staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  await staffPage.goto(PATH)
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
  await expect(staffPage.getByRole('form', { name: 'Kontaktoplysninger' })).toHaveCount(0)

  await context.close()
})
