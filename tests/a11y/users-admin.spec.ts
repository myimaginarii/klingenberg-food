import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Brugere — technical plan §9, design 1aa. Phase 11C.
 *
 * Read-only, at both widths (the `desktop` and `mobile` projects). The states that
 * need a write — a refused invitation, the confirmations, a deactivated row — are
 * scanned inside `tests/e2e/users-admin.spec.ts`.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const PATH = '/admin/brugere'

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

test('the Owner\'s dashboard tile is a 44 px target', async () => {
  await page.goto('/admin')
  const link = page.getByRole('link', { name: 'Brugere', exact: true })
  await expect(link).toHaveCount(1)
  expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('the screen has no accessibility violations', async () => {
  await page.goto(PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brugere')
  expect(await violations(page)).toEqual([])
})

test('the list is a list, and each row says the role and the state in words', async () => {
  await page.goto(PATH)
  const rows = page.getByRole('listitem')
  await expect(rows).toHaveCount(2)

  const owner = rows.filter({ hasText: 'owner@example.test' })
  await expect(owner).toContainText('Ejer')
  await expect(owner).toContainText('Aktiv')
  await expect(owner).toContainText('Eneste aktive ejer')
  await expect(owner.getByRole('link')).toHaveCount(0)

  const staff = rows.filter({ hasText: 'staff@example.test' })
  await expect(staff).toContainText('Medarbejder')
  await expect(staff).toContainText('Aktiv')
  for (const name of [/^Gør til ejer/, /^Deaktivér/]) {
    const control = staff.getByRole('link', { name })
    await expect(control).toHaveCount(1)
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  }
})

test('every field in the invitation form has a real label, with its helper bound to it', async () => {
  await page.goto(PATH)
  const form = page.getByRole('form', { name: 'Invitér en ny bruger', exact: true })

  for (const label of ['Navn', 'E-mail', 'Rolle']) {
    await expect(form.getByLabel(label, { exact: true }), label).toBeVisible()
  }

  const email = form.getByLabel('E-mail', { exact: true })
  await expect(email).toHaveAttribute('type', 'email')
  const describedBy = await email.getAttribute('aria-describedby')
  await expect(page.locator(`#${describedBy}`)).toContainText('Invitationen sendes hertil')

  for (const field of await page.locator('input:not([type=hidden]), select').all()) {
    const id = await field.getAttribute('id')
    expect(id).not.toBeNull()
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1)
  }

  const button = form.getByRole('button', { name: 'Send invitation' })
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
})

test('the screen does not scroll sideways at this width', async () => {
  await page.goto(PATH)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow).toBe(false)
})

test('a Staff member is sent to the "no access" page, not shown a locked screen', async ({ browser }) => {
  const context = await browser.newContext()
  const staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  await expect(staffPage.getByRole('link', { name: 'Brugere', exact: true })).toHaveCount(0)
  await staffPage.goto(PATH)
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
  await expect(staffPage.getByRole('form', { name: 'Invitér en ny bruger' })).toHaveCount(0)

  await context.close()
})
