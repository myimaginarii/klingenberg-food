import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Ugens ret & Lørdagsmenu — technical plan §9, design 1aa, 1ag.
 *
 * §9 asks for axe on the administration's editors at 375 px and 1440 px. This file is
 * the weekly editor's half; both the `desktop` and the `mobile` project run it, which is
 * what gives the two widths.
 *
 * It is **read-only**. Every state it scans — the two cards, the copy control, and the
 * overwrite confirmation — is reachable from the URL alone, so nothing here writes to the
 * database and the suites that do can run afterwards undisturbed. The states that need a
 * write to reach (a refusal with a message bound to its field, a Kladde badge, the green
 * Fortryd strip) are scanned inside `tests/e2e/weekly-special.spec.ts`, where they can
 * be produced honestly.
 *
 * The scans are one half. The assertions beneath them are the other: axe cannot see
 * whether a target is 44 px, whether a status is carried by colour alone, or whether
 * seven day boxes fit a phone without the page scrolling sideways — and those are
 * promises the approved design makes by name (1aa).
 */

/** WCAG 2.2 A and AA, the same bar the public pages and the menu editor are held to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const WEEKLY_PATH = '/admin/menu/ugens-ret'

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
  await page.goto(WEEKLY_PATH)
  await expect(page.getByRole('form', { name: 'Ugens ret', exact: true })).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('the overwrite confirmation has no accessibility violations', async () => {
  // A screen state, reachable from the address. Nothing has been copied: the write still
  // needs the confirmation's own field, which only its button submits.
  await page.goto(`${WEEKLY_PATH}?kopier=1`)
  await expect(page.getByRole('dialog')).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('the confirmation is a real modal dialog, named by its own heading (1ae)', async () => {
  await page.goto(`${WEEKLY_PATH}?kopier=1`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName('Dette overskriver din nuværende kladde')

  // Focus is inside it, and on the safe choice — never on the one that replaces work.
  await expect(dialog.getByRole('link', { name: 'Behold min kladde' })).toBeFocused()
})

test('the image picker has no accessibility violations, and focus opens on the safe way out', async () => {
  // Phase 10C-1's picker, reachable from the address. The seed's library is empty,
  // so this is the read-only state; the populated grid, the selected marker and the
  // keyboard path are scanned inside `tests/e2e/editor-images.spec.ts`, where the
  // images they need can be produced honestly.
  await page.goto(`${WEEKLY_PATH}?vaelg_billede=1`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleName('Vælg billede')
  await expect(dialog).toContainText('Der er ingen billeder i biblioteket endnu.')
  // The way to upload is the library, linked — a chooser never grows its own upload.
  await expect(
    dialog.getByRole('link', { name: 'Upload eller administrér billeder' }),
  ).toHaveAttribute('href', '/admin/billeder')
  await expect(dialog.getByRole('link', { name: 'Annuller' })).toBeFocused()

  expect(await violations(page)).toEqual([])
})

test('every field has a real label, and the week dropdown says what changing it does', async () => {
  await page.goto(WEEKLY_PATH)

  for (const label of [
    'Ugenummer',
    'Retnavn',
    'Beskrivelse',
    'Lille portion (kr.)',
    'Stor portion (kr.)',
    'Pris (kr.)',
    'Bestillingsfrist (valgfrit)',
  ]) {
    await expect(page.getByLabel(label, { exact: true }).first()).toBeVisible()
  }

  // The rollover is announced before it happens, in the field's own description (§7e
  // item 5) — not only after the form has gone blank.
  const week = page.getByLabel('Ugenummer', { exact: true })
  const describedBy = await week.getAttribute('aria-describedby')
  expect(describedBy).not.toBeNull()

  await expect(page.locator(`#${describedBy ?? ''}`)).toContainText('blankt skema')
})

test('the two availability states are carried by shape and words, not by colour', async () => {
  await page.goto(WEEKLY_PATH)

  for (const card of ['Ugens ret', 'Lørdagsmenuen']) {
    const block = page.getByRole('form', { name: `Tilgængelighed — ${card}` })

    // The word is on screen…
    await expect(block).toContainText(/Tilgængelig|Udsolgt i dag/)
    // …and the control's own name says both the state and what pressing will do, so a
    // screen reader meeting one of two identical switches knows which is which.
    await expect(
      block.getByRole('button', { name: new RegExp(`— ${card}\\. Skift til`) }),
    ).toBeVisible()
  }
})

test('every control a person presses is at least 44 px', async () => {
  await page.goto(WEEKLY_PATH)

  const small = await page
    .locator('main button, main a[href], main select, main label:has(input[type="checkbox"])')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const box = node.getBoundingClientRect()
          return { name: node.textContent?.trim().slice(0, 24), h: box.height, w: box.width }
        })
        // A control the layout has not laid out is not a target anybody can mis-tap.
        .filter((box) => box.h > 0 && (box.h < 44 || box.w < 44)),
    )

  expect(small).toEqual([])
})

test('the screen does not scroll sideways at this width', async () => {
  await page.goto(WEEKLY_PATH)

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
  }))

  expect(overflow.body).toBeLessThanOrEqual(overflow.client)
})

test('the focus ring is the design’s 3 px, on a field and on a day box', async () => {
  await page.goto(WEEKLY_PATH)

  const ring = async (locator: ReturnType<Page['locator']>) => {
    await locator.focus()

    return locator.evaluate((node) => {
      // The box the ring is drawn on is the element itself for a field, and the styled
      // sibling for a visually hidden checkbox — so both are read the same way the
      // browser draws them.
      const target =
        node.matches('.sr-only') && node.nextElementSibling !== null
          ? node.nextElementSibling
          : node

      return getComputedStyle(target).outlineWidth
    })
  }

  expect(await ring(page.getByLabel('Retnavn', { exact: true }).first())).toBe('3px')
  expect(await ring(page.getByRole('checkbox', { name: 'onsdag', exact: true }))).toBe('3px')
})
