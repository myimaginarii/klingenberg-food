import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of the phase-4 administration — technical plan §9, design 1aa.
 *
 * §9 asks for axe on "the dashboard, menu editor and conflict sheet, at 375 px and
 * 1440 px". The menu editor and the conflict sheet are phases 5 and 8; what phase 4
 * builds is the dashboard's publishing half and the preview bar, so those are what is
 * scanned here (the phase-4 content editor retired in 14B1; its last form, Om os, is
 * `tests/a11y/about-admin.spec.ts`). Both projects run this file, which is what gives
 * the two widths.
 *
 * Nothing here changes any content: the pages are loaded and read. The suite that
 * writes runs afterwards, in its own project.
 */

/** WCAG 2.2 A and AA, the same bar the public pages are held to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/**
 * The dashboard's links that stand on their own — 1x / 1q's tiles (phase 12C), named by
 * the words on them: a Staff member's four everyday destinations and the announcement
 * card's own control.
 */
const STANDALONE_DASHBOARD_LINKS = ['Rediger menu', 'Rediger besked', 'Mad ud af huset', 'Om os', 'Se hjemmesiden'] as const

test.describe('the administration', () => {
  test('the dashboard has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)

    expect(await violations(page)).toEqual([])
  })

  /**
   * The dashboard's standalone links, held to 1aa's 44 px minimum target.
   *
   * Named one by one rather than swept up by a selector, so the list is the set of
   * links that stand on their own — 1x's 68 px rows and the bar's control — and it
   * grows only when a screen adds one. Since phase 12C no link on the dashboard sits
   * inside a sentence; the phase-1 "Ejer-området" line, the one WCAG 2.2 target-size
   * exemption the old dashboard relied on, is gone with the card it lived in.
   */
  test('every standalone link on the dashboard is a 44 px target', async ({ page }) => {
    await signIn(page, STAFF)

    for (const name of STANDALONE_DASHBOARD_LINKS) {
      const link = page.getByRole('link', { name, exact: true })
      await expect(link).toHaveCount(1)

      const box = await link.boundingBox()
      expect(box?.height ?? 0, `"${name}" is at least 44 px tall`).toBeGreaterThanOrEqual(44)
    }
  })

})

test.describe('the preview bar', () => {
  test('has no accessibility violations on a public page', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto('/api/preview/start?maal=om-os')

    await expect(page.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  test('announces itself as a status, and says so in text rather than in colour', async ({
    page,
  }) => {
    await signIn(page, STAFF)
    await page.goto('/api/preview/start?maal=om-os')

    const bar = page.getByRole('status').filter({ hasText: 'Forhåndsvisning' })

    await expect(bar).toBeVisible()
    await expect(bar).toContainText('ikke live endnu')

    // The way out is a real link, reachable by keyboard and working without scripting.
    const exit = page.getByRole('link', { name: 'Afslut forhåndsvisning' })
    await expect(exit).toHaveAttribute('href', '/api/preview/stop')

    const box = await exit.boundingBox()
    expect(box?.height ?? 0, 'the exit control meets the 44 px target size (1aa)').toBeGreaterThanOrEqual(44)
  })
})
