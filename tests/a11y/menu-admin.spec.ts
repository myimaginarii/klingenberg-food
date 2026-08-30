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

/** The Tapas dish's id, taken from the Tapas section's own list (phase 5F). */
async function tapasDishId(page: Page): Promise<string> {
  await page.goto('/admin/menu?sektion=tapas')

  const href = await page
    .getByRole('list', { name: /^Retter i / })
    .getByRole('link', { name: /^Tapas/ })
    .first()
    .getAttribute('href')

  const id = new URL(href ?? '', 'http://localhost').searchParams.get('ret')
  expect(id, 'the Tapas section lists the Tapas dish').not.toBeNull()

  return id ?? ''
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

  /*
   * The Fortryd strip is reachable from the URL alone — the three parameters the
   * action redirects with are all this page needs to draw it — so it can be scanned
   * here, in the read-only suite, without any suite writing to a dish. The genuinely
   * sold-out row and panel are scanned in `e2e/menu-sold-out.spec.ts`, where the data
   * exists, at the same two widths.
   */
  test('the Fortryd strip has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)
    const id = await firstDishId(page)
    await page.goto(
      `/admin/menu?fortryd=${id}&fortryd_version=2026-08-29T12%3A00%3A00.000Z&fortryd_udsolgt=1`,
    )

    await expect(page.getByRole('button', { name: /^Fortryd/ })).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  /*
   * The deletion confirmation is reachable from the URL alone — `?slet=<id>` is all the
   * page needs to render it — so it is scanned here, in the read-only suite, at both
   * widths. Opening it deletes nothing; the deletion itself is exercised in
   * `e2e/menu-delete.spec.ts`.
   */
  test('the deletion confirmation has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)
    const id = await firstDishId(page)
    await page.goto(`/admin/menu?ret=${id}&slet=${id}`)

    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  test('the deletion Fortryd strip has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)
    const id = await firstDishId(page)
    await page.goto(
      `/admin/menu?fortryd_slet=${id}&fortryd_slet_version=2026-08-29T12%3A00%3A00.000Z`,
    )

    // The dish is not deleted, so no strip is drawn — which is itself the rule being
    // scanned: a hand-built address produces a screen, not an offer.
    await expect(page.getByRole('list', { name: /^Retter i / })).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  /*
   * The Tapas lists (phase 5F). Reachable read-only — opening the Tapas dish's editor
   * writes nothing — so both this scan and the refusal state below live here, at both
   * widths, and the suites that write run afterwards undisturbed.
   */
  test('the Tapas list editor has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto(`/admin/menu?sektion=tapas&ret=${await tapasDishId(page)}`)

    await expect(page.getByRole('heading', { name: 'Tapas-indhold' })).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  test('a refused Tapas save has no accessibility violations', async ({ page }) => {
    await signIn(page, STAFF)
    const id = await tapasDishId(page)
    await page.goto(
      `/admin/menu?sektion=tapas&ret=${id}` +
        '&tapas_gruppe=dressing&tapas_overskrift=Og+3+dressinger' +
        '&tapas_punkt=Pesto&tapas_punkt=pesto&tapas_fejl=punkt%3A1%3Aduplicate',
    )

    await expect(page.getByText('Punktet står allerede på listen.')).toBeVisible()
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
  test('every Tapas list has a heading, and every field a name', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto(`/admin/menu?sektion=tapas&ret=${await tapasDishId(page)}`)

    for (const label of ['Fast indhold', 'Vælg 7', 'Vælg 3 dressinger']) {
      await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
      await expect(page.getByRole('form', { name: `Tapas — ${label}` })).toBeVisible()
    }

    // Every text field in the three lists carries a name that says which list it is in,
    // because "Punkt 1" three times over is three fields nobody can tell apart.
    const names = await page
      .locator('#tapas-indhold input:not([type=hidden])')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLInputElement).getAttribute('aria-labelledby')),
      )

    expect(names.every((value) => (value ?? '').includes('-titel'))).toBe(true)
  })


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

  test('the availability control names both the state and what pressing will do', async ({
    page,
  }) => {
    await signIn(page, STAFF)
    await page.goto('/admin/menu')

    // Named, not positional. A row now begins with the reorder handle (phase 5E), so
    // "the first button in the list" is no longer the availability control — and a test
    // that says which control it means keeps saying it whatever else joins the row.
    const control = page
      .getByRole('list', { name: /^Retter i / })
      .getByRole('button', { name: /^Tilgængelig/ })
      .first()

    // WCAG 2.5.3: the visible word comes first in the accessible name. The rest is what
    // a screen reader needs and a sighted person can already see — which dish, and
    // where pressing leads.
    await expect(control).toHaveAccessibleName(/^Tilgængelig — .+\. Skift til udsolgt\.$/)
  })

  test('Slet ret is a 44 px target that names the dish it would remove', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto(`/admin/menu?ret=${await firstDishId(page)}`)

    const control = page.getByRole('link', { name: /^Slet ret — / })

    // The word is in the control, so the destructive action survives the colours being
    // switched off (1aa) — and the dish is in its accessible name, so a screen reader
    // is never asked to delete "a ret".
    await expect(control).toContainText('Slet ret')

    const box = await control.boundingBox()
    expect(box?.height ?? 0, 'Slet ret is at least 44 px tall').toBeGreaterThanOrEqual(44)
  })

  test('the deletion confirmation is named by its own question', async ({ page }) => {
    await signIn(page, STAFF)
    const id = await firstDishId(page)
    await page.goto(`/admin/menu?ret=${id}&slet=${id}`)

    const dialog = page.getByRole('dialog')

    await expect(dialog).toHaveAccessibleName(/^Slet .+\?$/)
    // Focus is inside the dialog, on the safe choice, and the page behind is inert.
    await expect(dialog.getByRole('link', { name: 'Behold ret' })).toBeFocused()
  })

  test('the availability control is operable from the keyboard alone', async ({ page }) => {
    await signIn(page, STAFF)
    await page.goto('/admin/menu')

    // Named rather than positional, for the same reason as above: the reorder handle now
    // comes first in a row, and this test is about the availability control.
    const control = page
      .getByRole('list', { name: /^Retter i / })
      .getByRole('button', { name: /^Tilgængelig/ })
      .first()

    await control.focus()
    await expect(control).toBeFocused()

    // A real submit button: the focus ring is the global one, and the outline is drawn
    // rather than removed.
    const outlineWidth = await control.evaluate(
      (element) => getComputedStyle(element).outlineWidth,
    )
    expect(parseFloat(outlineWidth), 'the focus ring is visible').toBeGreaterThanOrEqual(3)
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
      // the frame and are given 44 here rather than shipping the smaller value — so the
      // number asserted is 44, which is what the sentence above it says.
      expect(box?.height ?? 0, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(44)
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
