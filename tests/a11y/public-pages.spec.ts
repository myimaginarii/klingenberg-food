import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { PUBLIC_ROUTES } from '../e2e/support/site'

/**
 * Accessibility — technical plan §9, design 1aa ("Tilgængelighed").
 *
 * axe runs on every public page in both projects, which means every page at 375 px and
 * again at 1440 px. On top of the automated pass, the design makes promises a scanner
 * cannot check on its own — minimum target sizes, a visible focus ring, status conveyed
 * by more than colour, a heading outline that makes sense — and those are asserted
 * directly.
 */

/** The six pages, and the designed 404 an unmatched address renders inside the same shell. */
const ROUTES = [...PUBLIC_ROUTES.map((route) => route.path), '/denne-side-findes-ikke/']

/** WCAG 2.2 A and AA. Best-practice rules are reported but not made a failure. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

for (const path of ROUTES) {
  test(`${path} has no accessibility violations`, async ({ page }) => {
    await page.goto(path)

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()

    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target.join(' ')),
      })),
    ).toEqual([])
  })
}

test('the page is in Danish, so a screen reader pronounces it', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'da')
})

test('every page has exactly one first-level heading', async ({ page }) => {
  for (const path of ROUTES) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }), `${path}`).toHaveCount(1)
  }
})

test('the landmarks a screen-reader user navigates by are present', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('banner')).toHaveCount(1)
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('contentinfo')).toHaveCount(1)
})

test('a keyboard user can skip the header', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')

  const skipLink = page.getByRole('link', { name: 'Spring til indhold' })
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeVisible()
})

test('the focus ring is the 3 px one the design specifies', async ({ page }) => {
  await page.goto('/menu')
  await page.keyboard.press('Tab')

  const outline = await page.evaluate(() => {
    const active = document.activeElement
    if (active === null) return null
    const style = getComputedStyle(active)
    return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset }
  })

  expect(outline).toEqual({ width: '3px', style: 'solid', offset: '2px' })
})

test('every interactive target is at least 44 px tall', async ({ page }) => {
  for (const path of ROUTES) {
    await page.goto(path)

    const small = await page.locator('a:visible, button:visible, summary:visible').evaluateAll(
      (elements) =>
        elements
          .filter((element) => {
            const box = element.getBoundingClientRect()
            // An inline link inside a paragraph is text, not a target, and is exempt
            // from the size rule; the design's own targets are all standalone controls.
            const inline = getComputedStyle(element).display === 'inline'
            // A visually-hidden control — the skip link before it takes focus — is
            // clipped to a pixel by design. It is measured when it is focusable and
            // visible, which the keyboard test above does.
            const visuallyHidden = box.height <= 2 || box.width <= 2
            return !inline && !visuallyHidden && box.height > 0 && box.height < 44
          })
          .map((element) => `${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 40)}"`),
    )

    expect(small, `${path} has targets under 44 px`).toEqual([])
  }
})

test('the open/closed state is written in words, not carried by colour', async ({ page }) => {
  await page.goto('/find-os')

  // Scoped to the page body: the fullscreen mobile menu carries its own badge, and at
  // 1440 px that copy is display:none rather than absent.
  const badge = page.getByRole('main').getByText(/^(Åbent nu|Lukket)/).first()
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText(/(Åbent nu|Lukket)/)
})

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const scrollBehavior = await page.evaluate(
    () => getComputedStyle(document.documentElement).scrollBehavior,
  )

  expect(scrollBehavior).toBe('auto')
})
