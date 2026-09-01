import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Billeder — technical plan §9, design 1aa, 1w. Phase 10B.
 *
 * §9 asks for axe on the administration's editors at 375 px and 1440 px; both the
 * `desktop` and the `mobile` project run this file, which is what gives the two
 * widths.
 *
 * It is **read-only**. The seed contains no images, so the states reachable from
 * the URL alone are the empty library and its upload chooser — scanned here. The
 * states that need a write to reach — a populated grid, the detail panel, the
 * usage warning, the delete confirmation, the upload status — are scanned inside
 * `tests/e2e/image-library.spec.ts`, where they can be produced honestly and
 * cleaned up again.
 */

/** WCAG 2.2 A and AA, the same bar the other editors are held to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const IMAGES_PATH = '/admin/billeder'

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

test('the empty library has no accessibility violations', async () => {
  await page.goto(IMAGES_PATH)
  await expect(page.getByText('Træk billeder hertil')).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('the upload chooser is a labelled control the keyboard can reach', async () => {
  await page.goto(IMAGES_PATH)

  const input = page.locator('#billede-upload')
  await expect(input).toBeEnabled()

  // The dashed dropzone is the input's own label, so pressing the words is
  // pressing the control — and the input is in the tab order, not display:none.
  await expect(page.locator('label[for="billede-upload"]')).toContainText(
    'Træk billeder hertil',
  )
  await input.focus()
  await expect(input).toBeFocused()
})

test('the library does not scroll sideways at this width', async () => {
  await page.goto(IMAGES_PATH)
  await expect(page.getByText('Træk billeder hertil')).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow).toBe(false)
})

test('nor at 768, where the md layout begins', async () => {
  const projectViewport = page.viewportSize()

  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto(IMAGES_PATH)
  await expect(page.getByText('Træk billeder hertil')).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow).toBe(false)

  if (projectViewport !== null) await page.setViewportSize(projectViewport)
})
