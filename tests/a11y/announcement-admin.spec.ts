import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Besked på hjemmesiden — technical plan §9, design 1aa, 1ad.
 *
 * §9 asks for axe on the administration's editors at 375 px and 1440 px. This file is the
 * announcement editor's half; both the `desktop` and the `mobile` project run it, which is
 * what gives the two widths.
 *
 * It is **read-only**. Every state it scans — the editor, and the editor showing a
 * refusal — is reachable from the URL alone, because a refused save comes back with its
 * codes in the query string (`./forms.ts`). So nothing here writes to the database and the
 * suites that do can run afterwards undisturbed. The states that need a write to reach — a
 * populated draft, a published bar, a linked bar — are scanned inside
 * `tests/e2e/announcement.spec.ts`, where they can be produced honestly.
 *
 * The scans are one half. The assertions beneath them are the other: axe cannot see
 * whether a target is 44 px, whether a status is carried by colour alone, whether an error
 * is bound to the control it belongs to, or whether a date field and a row of chips fit a
 * phone without the page scrolling sideways — and those are promises the approved design
 * makes by name (1aa).
 */

/** WCAG 2.2 A and AA, the same bar the public pages and the other editors are held to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const ANNOUNCEMENT_PATH = '/admin/besked'

/** Every field-level refusal 1ad can show, reached from the address alone. */
const EVERY_ERROR =
  `${ANNOUNCEMENT_PATH}?fejl=besked%3Atom&fejl=adresse%3Augyldig` +
  '&fejl=linktekst%3Amangler&fejl=udloeb%3Afortid&link=adresse'

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
  await page.goto(ANNOUNCEMENT_PATH)
  await expect(page.getByRole('form', { name: 'Besked på hjemmesiden', exact: true })).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('the editor showing every refusal has no accessibility violations', async () => {
  await page.goto(EVERY_ERROR)

  await expect(page.getByText('Skriv beskeden')).toBeVisible()
  expect(await violations(page)).toEqual([])
})

test('every field carries a label its control points at', async () => {
  await page.goto(ANNOUNCEMENT_PATH)

  for (const field of await page
    .locator('input:not([type=hidden]):not([type=radio]), textarea, select')
    .all()) {
    const id = await field.getAttribute('id')

    expect(id, 'every visible field carries an id its label points at').not.toBeNull()
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1)
  }
})

test('each refusal is bound to the control it belongs to', async () => {
  await page.goto(EVERY_ERROR)

  // 1aa: the message is a real element with an id, the control points at it with
  // `aria-describedby`, and `aria-invalid` marks the control — so the problem is never
  // carried by the red border alone.
  for (const [label, sentence] of [
    ['Besked', 'Skriv beskeden'],
    ['Anden adresse', 'Adressen skal begynde med https://'],
    ['Tekst på linket', 'Skriv, hvad der skal stå på linket.'],
  ] as const) {
    const control = page.getByLabel(label, { exact: true })

    await expect(control).toHaveAttribute('aria-invalid', 'true')

    const describedBy = (await control.getAttribute('aria-describedby')) ?? ''
    const ids = describedBy.split(/\s+/).filter(Boolean)

    const texts = await Promise.all(ids.map((id) => page.locator(`#${id}`).innerText()))
    expect(texts.join(' '), `${label} names its own problem`).toContain(sentence)
  }

  // The expiry's message belongs to the group of three controls that decide it, so it is
  // bound one level up — on the fieldset.
  const group = page.getByRole('group', { name: /Beskeden fjernes automatisk/ })
  await expect(group).toHaveAttribute('aria-invalid', 'true')

  const groupDescribedBy = (await group.getAttribute('aria-describedby')) ?? ''
  const groupTexts = await Promise.all(
    groupDescribedBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => page.locator(`#${id}`).innerText()),
  )

  expect(groupTexts.join(' ')).toContain('Vælg et tidspunkt ude i fremtiden')
})

test('every control on the screen meets the 44 px minimum target size', async () => {
  await page.goto(ANNOUNCEMENT_PATH)

  const small = await page
    .locator('a:visible, button:visible, select:visible, input:visible, textarea:visible')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect()
          // A radio drawn as a chip is visually hidden behind its own label; the label is
          // the target, and it is measured on its own.
          const visuallyHidden = box.height <= 2 || box.width <= 2
          return !visuallyHidden && box.height > 0 && box.height < 44
        })
        .map(
          (element) =>
            `${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 40)}"`,
        ),
    )

  expect(small, 'no control on the announcement editor is under 44 px').toEqual([])
})

test('the suggestion chips are 44 px targets and a real radio group', async () => {
  await page.goto(ANNOUNCEMENT_PATH)

  const chips = page.getByRole('radio')
  // `count()` answers immediately, and the streamed document is not necessarily in
  // place when `goto` resolves — wait for one chip, then count them all.
  await expect(chips.first()).toBeVisible()
  const count = await chips.count()

  // "Vælg selv" plus at least one suggestion. The closing chip is absent only when the
  // published hours contain no opening day at all, which the seed does not.
  expect(count).toBeGreaterThanOrEqual(2)

  for (let index = 0; index < count; index += 1) {
    const chip = chips.nth(index)
    const id = await chip.getAttribute('id')
    const label = page.locator(`label[for="${id}"]`)

    await expect(label).toHaveCount(1)

    const box = await label.boundingBox()
    expect(box?.height ?? 0, 'a suggestion chip is at least 44 px tall').toBeGreaterThanOrEqual(44)
  }

  // Exactly one is chosen, so the group always has an answer.
  expect(await page.getByRole('radio', { checked: true }).count()).toBe(1)
})

test('the state is written in words, not carried by colour', async () => {
  await page.goto(ANNOUNCEMENT_PATH)

  // 1aa: "status = ikon + tekst, aldrig farve alene". The pill in the burgundy bar says
  // one of four things, and each is a sentence fragment a person can read with the
  // colours switched off. "Kladde" replaces it while a draft is waiting.
  await expect(
    page.getByRole('banner').getByText(/^(Vises nu|Udløbet|Ingen besked|Slået fra|Kladde)$/),
  ).toHaveCount(1)

  // And the banner beneath it says the same thing as a whole sentence, so the pill is
  // never the only place the state exists.
  await expect(
    page.getByRole('region', { name: 'Sådan ser beskeden ud på hjemmesiden lige nu' }),
  ).toBeVisible()
})

test('the editor does not scroll sideways at this width', async () => {
  await page.goto(ANNOUNCEMENT_PATH)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow).toBe(false)
})

test('the editor does not scroll sideways at 768 either, where the md rows begin', async () => {
  // 1aa's "768–1023 2 kort pr. række" is the width at which the editor's link row, its
  // date/time row and its chip row all switch to side-by-side. Both Playwright projects
  // run at 375 and 1440, so the step in between is measured here explicitly.
  // Restored afterwards, because this file shares one page between its scenarios and the
  // project's own width is what every other assertion here is about.
  const projectViewport = page.viewportSize()

  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto(ANNOUNCEMENT_PATH)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow).toBe(false)

  const small = await page
    .locator('a:visible, button:visible, select:visible, input:visible, textarea:visible')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect()
          const visuallyHidden = box.height <= 2 || box.width <= 2
          return !visuallyHidden && box.height > 0 && box.height < 44
        })
        .map((element) => element.tagName.toLowerCase()),
    )

  expect(small, 'no control is under 44 px at 768 either').toEqual([])

  if (projectViewport !== null) await page.setViewportSize(projectViewport)
})
