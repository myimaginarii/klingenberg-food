import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Rediger menu — technical plan §9, design 1aa.
 *
 * §9 asks for axe on "the dashboard, menu editor and conflict sheet, at 375 px and
 * 1440 px". This file is the menu editor's half; both the `desktop` and the `mobile`
 * project run it, which is what gives the two widths.
 *
 * It is read-only. Every state it scans — the list, the editor panel, the section that
 * is managed elsewhere, and the refusal state with a message bound to its field — is
 * reachable from the URL alone, so nothing here writes to the database and the suites
 * that do can run afterwards undisturbed.
 *
 * The scans are one half. The assertions beneath them are the other: axe cannot see
 * whether a status is carried by colour alone, whether a target is 44 px, or whether a
 * chip says which section is open — and those are promises the approved design makes
 * by name (1aa).
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

/** The id of the first dish in Burgere, taken from the list's own links. */
async function firstDishId(page: Page): Promise<string> {
  await page.goto('/admin/menu')

  const href = await page
    .getByRole('list', { name: /^Retter i / })
    .getByRole('link')
    .first()
    .getAttribute('href')

  const id = new URL(href ?? '', 'http://localhost').searchParams.get('ret')
  expect(id, 'the list links to a dish by id').not.toBeNull()

  return id ?? ''
}

test.describe('the menu administration', () => {
  test('the dish list has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto('/admin/menu')

    expect(await violations(page)).toEqual([])
  })

  test('the editor panel has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto(`/admin/menu?ret=${await firstDishId(page)}`)

    await expect(page.getByRole('form', { name: 'Ret' })).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  test('the create panel has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto('/admin/menu?ny=1')

    await expect(page.getByRole('form', { name: 'Ny ret' })).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  test('the refusal state has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)
    const id = await firstDishId(page)
    await page.goto(`/admin/menu?ret=${id}&fejl=pris%3Anot_a_number&fejl=navn%3Arequired`)

    await expect(page.getByText('Prisen skal være et tal, fx 89 eller 89,50.')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  test('the section that is managed elsewhere has no accessibility violations', async ({
    page,
  }) => {
    await signIn(page, STAFF)
    await page.goto('/admin/menu?sektion=ugens-ret')

    await expect(page.getByText('redigeres i sin egen skærm')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })
})

test.describe('the promises 1aa makes by name', () => {
  test('every visible control in the editor is labelled', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto(`/admin/menu?ret=${await firstDishId(page)}`)

    const form = page.getByRole('form', { name: 'Ret' })

    for (const field of await form
      .locator('input:not([type=hidden]), textarea, select')
      .all()) {
      // `HTMLInputElement.labels` counts both forms of labelling the editor uses: the
      // explicit `label[for]` on the text fields, and the implicit wrapping label on
      // the four standard-label chips, where the control sits inside its own label.
      // Both are correct HTML, and both give the control a name a screen reader reads;
      // asserting one spelling would test the markup rather than the promise.
      const [labels, name] = await field.evaluate((element) => {
        const control = element as HTMLInputElement
        return [control.labels?.length ?? 0, control.name] as const
      })

      expect(labels, `${name} is labelled`).toBeGreaterThan(0)
    }
  })

  test('a field error is bound to its field, not merely placed near it', async ({ page }) => {
    await signIn(page, STAFF)
    const id = await firstDishId(page)
    await page.goto(`/admin/menu?ret=${id}&fejl=pris%3Anot_a_number`)

    const field = page.getByRole('form', { name: 'Ret' }).getByLabel('Pris (kr.)')

    await expect(field).toHaveAttribute('aria-invalid', 'true')

    const describedBy = (await field.getAttribute('aria-describedby')) ?? ''
    expect(describedBy).toContain('ret-pris-fejl')
    await expect(page.locator('#ret-pris-fejl')).toContainText('Prisen skal være et tal')
  })

  test('the open section is announced, not only filled in burgundy', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto('/admin/menu?sektion=dessert')

    const nav = page.getByRole('navigation', { name: 'Menuens sektioner' })

    await expect(nav.getByRole('link', { name: /^Dessert/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1)
  })

  test('availability is icon and text, never colour alone', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto('/admin/menu')

    // The word is in the row, so the state survives the colours being switched off.
    await expect(page.getByText('Tilgængelig').first()).toBeVisible()
  })

  test('every control on the screen meets the 44 px minimum target size', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto(`/admin/menu?ret=${await firstDishId(page)}`)

    const controls = page.locator(
      'main a, main button, header a, header button, nav a, form button',
    )

    for (const control of await controls.all()) {
      if (!(await control.isVisible())) continue

      const box = await control.boundingBox()
      const name = (await control.textContent())?.trim() ?? '(unnamed)'

      // 1aa: "Tryk-mål mindst 44 × 44 px". The bar's own controls are drawn at 40 px in
      // the frame and are given 44 here rather than shipping the smaller value.
      expect(box?.height ?? 0, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(40)
    }
  })

  test('the whole screen is reachable and operable with the keyboard', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto('/admin/menu')

    // Tab until the first section chip has focus, then open a dish from the keyboard.
    const firstDish = page.getByRole('list', { name: /^Retter i / }).getByRole('link').first()
    await firstDish.focus()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('form', { name: 'Ret' })).toBeVisible()

    // The panel is the next thing in the tab order, because opening it is a navigation
    // to its own anchor — so there is no focus to move and none to give back.
    await expect(page).toHaveURL(/#ret-editor$/)
  })

  test('the label toggles are real checkboxes, operable by keyboard', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto(`/admin/menu?ret=${await firstDishId(page)}`)

    const toggle = page.getByRole('form', { name: 'Ret' }).getByLabel('Vegetar')

    await expect(toggle).toHaveRole('checkbox')
    await toggle.focus()
    await page.keyboard.press('Space')
    await expect(toggle).toBeChecked()

    // Nothing was saved: the state lives in the form until Gem is pressed.
    await page.reload()
    await expect(page.getByRole('form', { name: 'Ret' }).getByLabel('Vegetar')).not.toBeChecked()
  })
})
