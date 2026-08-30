import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from '../e2e/support/admin'

/**
 * Accessibility of Åbningstider — technical plan §9, design 1aa, 1t.
 *
 * §9 asks for axe on the administration's editors at 375 px and 1440 px. This file is the
 * weekly opening-hours editor's half; both the `desktop` and the `mobile` project run it,
 * which is what gives the two widths.
 *
 * It is **read-only**. Every state it scans — the editor, the editor showing refusals, and
 * the Owner-only refusal a staff member meets — is reachable from the URL alone, because a
 * refused save comes back with its codes in the query string (`./forms.ts`). So nothing
 * here writes to the database and the suites that do can run afterwards undisturbed. The
 * one state that needs a write — a populated Kladde — is scanned inside
 * `tests/e2e/opening-hours.spec.ts`, where it can be produced honestly.
 *
 * The scans are one half. The assertions beneath them are the other: axe cannot see whether
 * a target is 44 px, whether a state is carried by colour alone, whether a refusal is bound
 * to the control it belongs to, or whether seven rows of switches and dropdowns fit a phone
 * without the page scrolling sideways — and those are promises the approved design makes by
 * name (1aa).
 */

/** WCAG 2.2 A and AA, the same bar the public pages and the other editors are held to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const HOURS_PATH = '/admin/aabningstider'

/**
 * Every kind of refusal 1t's card can show, on four different days, reached from the
 * address alone. Monday is switched on with no times, Wednesday has an unreadable opening
 * time, Friday has no closing time, and Saturday closes before it opens.
 */
const EVERY_ERROR =
  `${HOURS_PATH}?fejl=mon%3Afra_mangler&fejl=mon%3Atil_mangler&fejl=wed%3Afra_ugyldig` +
  '&fejl=fri%3Atil_mangler&fejl=sat%3Aikke_efter' +
  '&aaben-mon=1&fra-mon=&til-mon=' +
  '&aaben-wed=1&fra-wed=noget&til-wed=20%3A00' +
  '&aaben-fri=1&fra-fri=15%3A00&til-fri=' +
  '&aaben-sat=1&fra-sat=20%3A00&til-sat=17%3A00'

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/** Everything visible that a person can operate, with anything visually hidden dropped. */
async function smallTargets(page: Page): Promise<string[]> {
  return page
    .locator('a:visible, button:visible, select:visible, input:visible, textarea:visible, label:visible')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect()
          // A checkbox drawn as a switch is visually hidden behind its own label; the
          // label is the target, and it is measured on its own.
          const visuallyHidden = box.height <= 2 || box.width <= 2
          return !visuallyHidden && box.height > 0 && box.height < 44
        })
        .map(
          (element) =>
            `${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 40)}"`,
        ),
    )
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

test('the editor has no accessibility violations', async () => {
  await page.goto(HOURS_PATH)
  await expect(page.getByRole('form', { name: 'Normale åbningstider', exact: true })).toBeVisible()

  expect(await violations(page)).toEqual([])
})

test('the editor showing every refusal has no accessibility violations', async () => {
  await page.goto(EVERY_ERROR)

  await expect(page.getByText('Vælg, hvornår I åbner om mandagen.')).toBeVisible()
  expect(await violations(page)).toEqual([])
})

test('each weekday is a group with the weekday as its name', async () => {
  await page.goto(HOURS_PATH)

  for (const weekday of [
    'Mandag',
    'Tirsdag',
    'Onsdag',
    'Torsdag',
    'Fredag',
    'Lørdag',
    'Søndag',
  ]) {
    await expect(page.getByRole('group', { name: weekday, exact: true })).toHaveCount(1)
  }
})

test('the open/closed control has a name that says which day it is', async () => {
  await page.goto(HOURS_PATH)

  // "Åbent" on its own is ambiguous in a list of seven rows, which is exactly the case
  // WCAG 2.5.3 is about. The name carries the weekday, so a control read out of context is
  // still a sentence somebody can act on.
  await expect(page.getByRole('checkbox', { name: 'Åbent om onsdagen' })).toBeVisible()

  expect(await page.getByRole('checkbox').count()).toBe(7)
})

test('every time field is associated with its weekday', async () => {
  await page.goto(HOURS_PATH)

  for (const [weekday, edge] of [
    ['Onsdag', 'åbner'],
    ['Onsdag', 'lukker'],
    ['Søndag', 'åbner'],
    ['Søndag', 'lukker'],
  ] as const) {
    const control = page.getByLabel(`${weekday} — ${edge}`, { exact: true })

    await expect(control).toBeVisible()

    const id = await control.getAttribute('id')
    expect(id, 'every field carries an id its label points at').not.toBeNull()
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1)
  }
})

test('every visible field carries a label its control points at', async () => {
  await page.goto(HOURS_PATH)

  for (const field of await page
    .locator('select:visible, input:visible:not([type=hidden])')
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
  for (const [weekday, edge, sentence] of [
    ['Mandag', 'åbner', 'Vælg, hvornår I åbner om mandagen.'],
    ['Mandag', 'lukker', 'Vælg, hvornår I lukker om mandagen.'],
    ['Onsdag', 'åbner', 'Åbningstidspunktet om onsdagen skal skrives som TT:MM.'],
    ['Fredag', 'lukker', 'Vælg, hvornår I lukker om fredagen.'],
    ['Lørdag', 'lukker', 'Om lørdagen skal lukketiden ligge efter åbningstiden.'],
  ] as const) {
    const control = page.getByLabel(`${weekday} — ${edge}`, { exact: true })

    await expect(control).toHaveAttribute('aria-invalid', 'true')

    const describedBy = (await control.getAttribute('aria-describedby')) ?? ''
    const ids = describedBy.split(/\s+/).filter(Boolean)
    const texts = await Promise.all(ids.map((id) => page.locator(`#${id}`).innerText()))

    expect(texts.join(' '), `${weekday} ${edge} names its own problem`).toContain(sentence)
  }
})

test('the state of a day is written in words, not carried by colour', async () => {
  await page.goto(HOURS_PATH)

  // 1aa: "status = ikon + tekst, aldrig farve alene". A closed day says so beside the
  // switch; an open day says so by showing the two times the closed one does not have.
  await expect(
    page.getByRole('group', { name: 'Mandag', exact: true }).getByText('Lukket'),
  ).toBeVisible()

  await expect(
    page.getByRole('group', { name: 'Onsdag', exact: true }).getByText('Lukket'),
  ).toBeHidden()

  // And the screen's own state is a word in the bar, not a colour.
  await expect(page.getByRole('banner').getByText(/^(Kladde|Live)$/)).toHaveCount(1)
})

test('every control on the screen meets the 44 px minimum target size', async () => {
  await page.goto(HOURS_PATH)

  expect(await smallTargets(page), 'no control on the hours editor is under 44 px').toEqual([])
})

test('the refusal state keeps its 44 px targets too', async () => {
  await page.goto(EVERY_ERROR)

  expect(await smallTargets(page)).toEqual([])
})

test('the editor does not scroll sideways at this width', async () => {
  await page.goto(HOURS_PATH)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow).toBe(false)
})

test('the two time fields stay usable at this width', async () => {
  await page.goto(HOURS_PATH)

  // The phase brief's own rule: "Do not squeeze two time fields into unusably narrow
  // columns at 375." At 375 the row stacks and each field takes half the line; at 1440 it
  // is 1t's drawn 104 px. Either way it is wide enough for "00:00" plus the arrow.
  const width = await page
    .getByLabel('Onsdag — åbner', { exact: true })
    .evaluate((element) => element.getBoundingClientRect().width)

  expect(width).toBeGreaterThanOrEqual(96)
})

test('the editor does not scroll sideways at 768 either, where the md rows begin', async () => {
  // 1aa's "768–1023" is the width at which each weekday row switches from two stacked
  // lines to one. Both Playwright projects run at 375 and 1440, so the step in between is
  // measured here explicitly. Restored afterwards, because this file shares one page
  // between its scenarios and the project's own width is what every other assertion is about.
  const projectViewport = page.viewportSize()

  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto(HOURS_PATH)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

  expect(overflow).toBe(false)
  expect(await smallTargets(page), 'no control is under 44 px at 768 either').toEqual([])

  // The bar's action labels must not collapse around 768 — the lesson phases 5–7 recorded.
  for (const label of ['Forhåndsvis Find os', 'Forhåndsvis forsiden', 'Offentliggør']) {
    await expect(page.getByRole('banner').getByText(label, { exact: true })).toBeVisible()
  }

  if (projectViewport !== null) await page.setViewportSize(projectViewport)
})

test('motion is not forced on anybody', async () => {
  /*
   * The switch is the one thing on this screen that animates, and it animates in its
   * label's `::before` (the track's colour) and `::after` (the knob's position) — so the
   * pseudo-elements are what have to be measured. Reading the label itself would report
   * `0s` whatever the setting, and would pass without proving anything.
   *
   * Both directions are asserted, because "the duration is zero" is only evidence of
   * anything if it was not zero to begin with. `app/globals.css` turns every transition off
   * under `prefers-reduced-motion` globally, including `*::before` and `*::after`, so the
   * promise is checked once here rather than restated per component.
   */
  const trackDurations = async (): Promise<number[]> =>
    page
      .getByRole('checkbox', { name: 'Åbent om onsdagen' })
      .locator('xpath=following-sibling::label[1]')
      .evaluate((element) =>
        ['::before', '::after']
          .map((part) => getComputedStyle(element, part).transitionDuration)
          .flatMap((value) => value.split(',').map((duration) => parseFloat(duration))),
      )

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(HOURS_PATH)

  expect(
    (await trackDurations()).some((duration) => duration > 0.02),
    'the switch does animate when nobody has asked it not to',
  ).toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()

  expect(
    (await trackDurations()).every((duration) => duration < 0.02),
    'and it does not when somebody has',
  ).toBe(true)

  await page.emulateMedia({ reducedMotion: null })
})

test.describe('the Owner-only refusal a staff member meets', () => {
  let staffPage: Page

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    staffPage = await context.newPage()
    await signIn(staffPage, STAFF)
  })

  test.afterAll(async () => {
    await staffPage.context().close()
  })

  test('has no accessibility violations', async () => {
    await staffPage.goto(HOURS_PATH)

    await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
    await expect(staffPage.getByText('Denne side kræver ejer-rollen.')).toBeVisible()

    const results = await new AxeBuilder({ page: staffPage }).withTags(TAGS).analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })

  test('says why in words rather than by hiding a control', async () => {
    await staffPage.goto(HOURS_PATH)

    await expect(staffPage.getByText('normale åbningstider')).toBeVisible()
    await expect(staffPage.getByRole('link', { name: 'Tilbage til oversigten' })).toBeVisible()
  })
})
