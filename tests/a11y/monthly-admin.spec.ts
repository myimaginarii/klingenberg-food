import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Månedens burger — technical plan §9, design 1aa, 1ah.
 *
 * §9 asks for axe on the administration's editors at 375 px and 1440 px. This file is the
 * monthly editor's half; both the `desktop` and the `mobile` project run it, which is what
 * gives the two widths.
 *
 * It is **read-only**. Every state it scans — the empty editor and the expired-period
 * confirmation — is reachable from the URL alone, so nothing here writes to the database
 * and the suites that do can run afterwards undisturbed. The states that need a write to
 * reach (a populated draft, a refusal with a message bound to its field, the scheduled and
 * expired states, the green Fortryd strip) are scanned inside
 * `tests/e2e/monthly-burger.spec.ts`, where they can be produced honestly.
 *
 * The scans are one half. The assertions beneath them are the other: axe cannot see
 * whether a target is 44 px, whether a status is carried by colour alone, or whether two
 * date fields fit a phone without the page scrolling sideways — and those are promises the
 * approved design makes by name (1aa).
 */

/** WCAG 2.2 A and AA, the same bar the public pages and the other editors are held to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const MONTHLY_PATH = '/admin/menu/maanedens-burger'

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
  await page.goto(MONTHLY_PATH)
  await expect(page.getByRole('form', { name: 'Månedens burger', exact: true })).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('the expired-period confirmation has no accessibility violations', async () => {
  // A screen state, reachable from the address. Nothing has been published: the publish
  // still needs the confirmation's own field, which only its button submits.
  await page.goto(`${MONTHLY_PATH}?udloebet=1`)
  await expect(page.getByRole('dialog')).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('the confirmation is a real modal dialog, named by its own heading (1ae)', async () => {
  await page.goto(`${MONTHLY_PATH}?udloebet=1`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName('Perioden er allerede forbi')

  // Focus is inside it, and on the safe choice — never on the one that publishes.
  await expect(dialog.getByRole('link', { name: 'Ret perioden' })).toBeFocused()
})

test('every field has a real label, and both dates say which end they are', async () => {
  await page.goto(MONTHLY_PATH)

  for (const label of ['Navn', 'Beskrivelse', 'Pris (kr.)', 'Startdato', 'Slutdato']) {
    await expect(page.getByLabel(label, { exact: true }).first()).toBeVisible()
  }

  // The two dates are a group with one explanation, rather than two fields with the same
  // sentence repeated under each.
  const period = page.getByRole('group', { name: 'Periode' })
  await expect(period).toBeVisible()

  const describedBy = await period.getAttribute('aria-describedby')
  expect(describedBy).not.toBeNull()
  await expect(page.locator(`#${describedBy ?? ''}`)).toContainText('Uden for perioden')
})

test('the forside toggle is announced with what it actually does (§7e item 3)', async () => {
  await page.goto(MONTHLY_PATH)

  const toggle = page.getByRole('checkbox', { name: 'Vis på forsiden' })
  await expect(toggle).toBeVisible()

  const describedBy = await toggle.getAttribute('aria-describedby')
  await expect(page.locator(`#${describedBy ?? ''}`)).toContainText(
    'sit eget afsnit på forsiden',
  )
  await expect(page.locator(`#${describedBy ?? ''}`)).not.toContainText(
    'Optager en af de tre pladser',
  )
})

test('the availability state is carried by shape and words, not by colour', async () => {
  await page.goto(MONTHLY_PATH)

  const block = page.getByRole('form', { name: 'Tilgængelighed — Månedens burger' })

  // The word is on screen…
  await expect(block).toContainText(/Tilgængelig|Udsolgt i dag/)
  // …and the control's own name says both the state and what pressing will do.
  await expect(
    block.getByRole('button', { name: /— Månedens burger\. Skift til/ }),
  ).toBeVisible()
})

test('the computed state is a named region a screen reader can jump to (§7d)', async () => {
  await page.goto(MONTHLY_PATH)

  await expect(
    page.getByRole('region', { name: 'Sådan ser Månedens burger ud på hjemmesiden lige nu' }),
  ).toBeVisible()
})

test('every control a person presses is at least 44 px', async () => {
  await page.goto(MONTHLY_PATH)

  const small = await page
    .locator('main button, main a[href], main input[type="date"], main label:has(input)')
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
  await page.goto(MONTHLY_PATH)

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
  }))

  expect(overflow.body).toBeLessThanOrEqual(overflow.client)
})

test('the focus ring is the design’s 3 px, on a field, a date and the toggle', async () => {
  await page.goto(MONTHLY_PATH)

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

  expect(await ring(page.getByLabel('Navn', { exact: true }))).toBe('3px')
  expect(await ring(page.getByLabel('Startdato', { exact: true }))).toBe('3px')
  expect(await ring(page.getByRole('checkbox', { name: 'Vis på forsiden' }))).toBe('3px')
})
