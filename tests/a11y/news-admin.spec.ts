import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of the news administration — technical plan §9, design 1s / 1z, 1aa.
 *
 * §9 asks for axe on the administration's editors at 375 px and 1440 px; both the
 * `desktop` and the `mobile` project run this file, which is what gives the two
 * widths.
 *
 * It is **read-only**. Every state it scans is reachable from the URL alone: the
 * list, the empty editor, the editor showing every refusal (a refused save comes back
 * with its codes in the query string, `article-form.ts`), the edit form for a seeded
 * article, and the two confirmations a published article offers — which are
 * server-rendered questions, and rendering a question writes nothing. The states that
 * need a write to reach — a Kladde badge, the publish confirmation, a conflict — are
 * scanned inside `tests/e2e/news-admin.spec.ts`, where they can be produced honestly.
 *
 * Both roles are scanned, because §5 gives news to Staff *and* Owner and an
 * accessibility bug that only one of them meets is still a bug.
 */

/** WCAG 2.2 A and AA, the same bar the public pages and the other editors are held to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const NEWS_PATH = '/admin/nyheder'
const SEEDED_TITLE = 'Overskrift placeholder — ny burger'

/** Every field-level refusal 1s can show, reached from the address alone. */
const EVERY_ERROR =
  `${NEWS_PATH}?ny=1&status=ugyldig` +
  '&fejl=overskrift%3Auden_adresse&fejl=dato%3Augyldig&fejl=kategori%3Aukendt&fejl=tekst%3Amangler' +
  '&overskrift=%3F%3F%3F&dato=2026-09-01&kategori=Sladder&tekst='

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/** Open the seeded article's editor and answer its address, read from the URL. */
async function openSeededEditor(page: Page): Promise<string> {
  await page.goto(NEWS_PATH)
  await page.getByRole('link', { name: new RegExp(SEEDED_TITLE) }).click()
  await expect(page.getByRole('form', { name: 'Rediger nyhed' })).toBeVisible()

  const url = new URL(page.url())
  const id = url.searchParams.get('nyhed')
  expect(id, 'the editor address names the article').not.toBeNull()

  return id!
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow).toBe(false)
}

async function expectMinimumTargets(page: Page): Promise<void> {
  const small = await page
    .locator('a:visible, button:visible, select:visible, input:visible, textarea:visible')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect()
          // A radio drawn as a chip is visually hidden behind its own label; the label
          // is the target, and it is measured on its own.
          const visuallyHidden = box.height <= 2 || box.width <= 2
          return !visuallyHidden && box.height > 0 && box.height < 44
        })
        .map(
          (element) =>
            `${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 40)}"`,
        ),
    )

  expect(small, 'no control on the news administration is under 44 px').toEqual([])
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

test('the list has no accessibility violations', async () => {
  await page.goto(NEWS_PATH)
  await expect(page.getByRole('link', { name: new RegExp(SEEDED_TITLE) })).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('the list states each article’s state in words, never colour alone', async () => {
  await page.goto(NEWS_PATH)

  const row = page.getByRole('link', { name: new RegExp(SEEDED_TITLE) })
  await expect(row).toContainText('Udgivet')
  await expect(row).toContainText('Offentliggjort')
})

test('the list is all 44 px targets and no sideways scrolling', async () => {
  await page.goto(NEWS_PATH)
  await expect(page.getByRole('link', { name: new RegExp(SEEDED_TITLE) })).toBeVisible()

  await expectMinimumTargets(page)
  await expectNoSidewaysScroll(page)
})

test('the create form has no accessibility violations', async () => {
  await page.goto(`${NEWS_PATH}?ny=1`)
  await expect(page.getByRole('form', { name: 'Ny nyhed' })).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('every field carries a label its control points at', async () => {
  await page.goto(`${NEWS_PATH}?ny=1`)
  await expect(page.getByRole('form', { name: 'Ny nyhed' })).toBeVisible()

  for (const field of await page
    .locator('input:not([type=hidden]):not([type=radio]), textarea, select')
    .all()) {
    const id = await field.getAttribute('id')

    expect(id, 'every visible field carries an id its label points at').not.toBeNull()
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1)
  }
})

test('the category chips are 44 px targets and a real radio group with an answer', async () => {
  await page.goto(`${NEWS_PATH}?ny=1`)

  const chips = page.getByRole('radio')
  await expect(chips.first()).toBeVisible()
  const count = await chips.count()

  // "Ingen kategori" plus the five the design draws.
  expect(count).toBe(6)

  for (let index = 0; index < count; index += 1) {
    const chip = chips.nth(index)
    const id = await chip.getAttribute('id')
    const label = page.locator(`label[for="${id}"]`)

    await expect(label).toHaveCount(1)

    const box = await label.boundingBox()
    expect(box?.height ?? 0, 'a category chip is at least 44 px tall').toBeGreaterThanOrEqual(44)
  }

  expect(await page.getByRole('radio', { checked: true }).count()).toBe(1)
})

test('the editor showing every refusal has no accessibility violations', async () => {
  await page.goto(EVERY_ERROR)
  await expect(page.getByText('Overskriften skal indeholde mindst ét bogstav')).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('each refusal is bound to the control it belongs to', async () => {
  await page.goto(EVERY_ERROR)

  for (const [label, sentence] of [
    ['Overskrift', 'Overskriften skal indeholde mindst ét bogstav'],
    ['Dato på hjemmesiden', 'Datoen skal være en rigtig dato.'],
    ['Tekst', 'Skriv teksten til nyheden.'],
  ] as const) {
    const control = page.getByLabel(label, { exact: true })

    await expect(control).toHaveAttribute('aria-invalid', 'true')

    const describedBy = (await control.getAttribute('aria-describedby')) ?? ''
    const ids = describedBy.split(/\s+/).filter(Boolean)

    const texts = await Promise.all(ids.map((id) => page.locator(`#${id}`).innerText()))
    expect(texts.join(' '), `${label} names its own problem`).toContain(sentence)
  }

  // The category's message belongs to the group of chips, so it is bound one level up.
  const group = page.getByRole('group', { name: /Hvad handler den om/ })
  await expect(group).toHaveAttribute('aria-invalid', 'true')

  const groupDescribedBy = (await group.getAttribute('aria-describedby')) ?? ''
  const groupTexts = await Promise.all(
    groupDescribedBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => page.locator(`#${id}`).innerText()),
  )

  expect(groupTexts.join(' ')).toContain('Ukendt kategori.')
})

test('the edit form for a published article has no accessibility violations', async () => {
  await openSeededEditor(page)

  // The state is in the bar in words, and the model is stated beside the button.
  await expect(page.getByRole('banner').getByText('Udgivet')).toBeVisible()
  await expect(page.getByText('på hjemmesiden med det samme')).toBeVisible()

  expect(await violations(page)).toEqual([])
  await expectMinimumTargets(page)
  await expectNoSidewaysScroll(page)
})

test('the unpublish confirmation has no accessibility violations', async () => {
  const id = await openSeededEditor(page)
  await page.goto(`${NEWS_PATH}?nyhed=${id}&fjern=${id}`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Fjern')
  await expect(dialog.getByRole('link', { name: 'Behold den på hjemmesiden' })).toBeFocused()

  expect(await violations(page)).toEqual([])
})

test('the delete confirmation has no accessibility violations, and opens on the safe choice', async () => {
  const id = await openSeededEditor(page)
  await page.goto(`${NEWS_PATH}?nyhed=${id}&slet=${id}`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Slet')
  await expect(dialog.getByRole('link', { name: 'Behold nyheden' })).toBeFocused()

  expect(await violations(page)).toEqual([])
})

test('the editor does not scroll sideways at 768 either, where the md row begins', async () => {
  // 1s's date-and-chips row goes side by side from `md`. Both projects run at 375 and
  // 1440, so the step in between is measured here explicitly and the width restored.
  const projectViewport = page.viewportSize()

  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto(`${NEWS_PATH}?ny=1`)
  await expect(page.getByRole('form', { name: 'Ny nyhed' })).toBeVisible()

  await expectNoSidewaysScroll(page)
  await expectMinimumTargets(page)

  if (projectViewport !== null) await page.setViewportSize(projectViewport)
})

test('the owner meets the same accessible screens (§5)', async ({ browser }) => {
  const context = await browser.newContext()
  const ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)

  await ownerPage.goto(NEWS_PATH)
  await expect(
    ownerPage.getByRole('link', { name: new RegExp(SEEDED_TITLE) }),
  ).toBeVisible()
  expect(await violations(ownerPage)).toEqual([])

  await ownerPage.goto(`${NEWS_PATH}?ny=1`)
  await expect(ownerPage.getByRole('form', { name: 'Ny nyhed' })).toBeVisible()
  expect(await violations(ownerPage)).toEqual([])

  await context.close()
})
