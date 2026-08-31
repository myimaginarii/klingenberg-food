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
/** The one-off card's form, by its own accessible name (phase 8B). */
function overrideFormOn(target: Page) {
  return target.getByRole('form', { name: 'Ændrede tider en enkelt dag', exact: true })
}

/**
 * The one-off card showing a date refusal and both time refusals at once, from the address
 * alone: a date that has been, "Andre tider" chosen, and neither time picked.
 */
const EVERY_OVERRIDE_ERROR =
  `${HOURS_PATH}?enkelt-fejl=dato_fortid&enkelt-fejl=fra_mangler&enkelt-fejl=til_mangler` +
  '&dato=2020-01-01&art=custom&fra=&til='

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

/**
 * Everything visible that a person can operate, with anything visually hidden dropped.
 *
 * A `<label>` on this screen is one of two different things, and only one of them is a
 * target:
 *
 *   * **a drawn control** — the weekday switch and 1t's two chips are a visually hidden
 *     `<input>` with a label that draws it, so the label *is* what a person presses and it
 *     has to be 44 px;
 *   * **a caption** — "Dato", "Fra" and "Til" sit above a field that is itself the target.
 *     Clicking one focuses the field, but WCAG 2.5.8 is about the control's own size, and
 *     the control is measured on its own line below.
 *
 * They are told apart by the control each one points at: a label whose control is visible
 * is a caption, and a label whose control is hidden is the control. Nothing is exempted by
 * name, so a caption that one day became the only target would be measured again.
 */
async function smallTargets(page: Page): Promise<string[]> {
  return page
    .locator('a:visible, button:visible, select:visible, input:visible, textarea:visible, label:visible')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect()
          const hidden = (rect: DOMRect) => rect.height <= 2 || rect.width <= 2

          if (element.tagName === 'LABEL') {
            const control = document.getElementById(
              (element as HTMLLabelElement).htmlFor,
            )

            // A caption: the control it names is visible and is measured itself.
            if (control !== null && !hidden(control.getBoundingClientRect())) return false
          }

          return !hidden(box) && box.height > 0 && box.height < 44
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

  /*
   * The one-off card is on this page too (phase 8B), so the middle width is measured for
   * both cards at once. Its own control labels are the ones most likely to wrap here: 1t's
   * two chips and "Gem og offentliggør" are the longest strings on the screen.
   */
  await page.goto(EVERY_OVERRIDE_ERROR)

  expect(await smallTargets(page), 'the one-off card keeps its targets at 768').toEqual([])

  for (const label of ['Lukket en bestemt dato', 'Andre tider en enkelt dag']) {
    const chip = overrideFormOn(page).getByText(label, { exact: true })

    await expect(chip).toBeVisible()
    // One line, not two: a wrapped chip is the defect phase 6's completion pass found
    // twice at exactly this width.
    expect(
      (await chip.boundingBox())?.height ?? 0,
      `"${label}" does not wrap at 768`,
    ).toBeLessThan(64)
  }

  await expect(
    overrideFormOn(page).getByRole('button', { name: 'Gem og offentliggør' }),
  ).toBeVisible()
  await expect(overrideFormOn(page).getByLabel('Fra', { exact: true })).toBeVisible()
  await expect(overrideFormOn(page).getByLabel('Til', { exact: true })).toBeVisible()

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

/**
 * The one-off change card — 1t's lower half, phase 8B.
 *
 * Scanned the same read-only way and at the same two widths. Every state below is reachable
 * from the address alone, because a refused save comes back with its codes in the query
 * string (`./override-forms.ts`), so nothing here writes to the database and the suites
 * that do can run afterwards undisturbed. The states that need a write — a pending
 * override, a published one, and a published one with an edit waiting — are scanned inside
 * `tests/e2e/opening-hours-override.spec.ts`, where they can be produced honestly.
 */
test.describe('the one-off change card', () => {
  test('has no accessibility violations', async () => {
    await page.goto(HOURS_PATH)
    await expect(overrideFormOn(page)).toBeVisible()

    expect(await violations(page)).toEqual([])
  })

  test('showing every refusal has no violations, and keeps its 44 px targets', async () => {
    await page.goto(EVERY_OVERRIDE_ERROR)

    await expect(
      page.getByText('Datoen er passeret. Vælg i dag eller en dag længere fremme.'),
    ).toBeVisible()

    expect(await violations(page)).toEqual([])
    expect(await smallTargets(page)).toEqual([])
  })

  test('the two kinds are one named group, and the date field is labelled', async () => {
    await page.goto(HOURS_PATH)

    await expect(
      overrideFormOn(page).getByRole('group', { name: 'Hvad sker der den dag?' }),
    ).toHaveCount(1)

    for (const name of ['Lukket en bestemt dato', 'Andre tider en enkelt dag']) {
      await expect(overrideFormOn(page).getByRole('radio', { name })).toHaveCount(1)
    }

    const date = overrideFormOn(page).getByLabel('Dato', { exact: true })
    await expect(date).toBeVisible()

    const id = await date.getAttribute('id')
    expect(id, 'the date field carries an id its label points at').not.toBeNull()
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1)
  })

  test('each refusal is bound to the control it belongs to', async () => {
    await page.goto(EVERY_OVERRIDE_ERROR)

    // 1aa: the message is a real element with an id, the control points at it with
    // `aria-describedby`, and `aria-invalid` marks the control — so the problem is never
    // carried by the red border alone.
    for (const [label, sentence] of [
      ['Dato', 'Datoen er passeret. Vælg i dag eller en dag længere fremme.'],
      ['Fra', 'Vælg, hvornår I åbner den dag.'],
      ['Til', 'Vælg, hvornår I lukker den dag.'],
    ] as const) {
      const control = overrideFormOn(page).getByLabel(label, { exact: true })

      await expect(control).toHaveAttribute('aria-invalid', 'true')

      const describedBy = (await control.getAttribute('aria-describedby')) ?? ''
      const ids = describedBy.split(/\s+/).filter(Boolean)
      const texts = await Promise.all(ids.map((id) => page.locator(`#${id}`).innerText()))

      expect(texts.join(' '), `${label} names its own problem`).toContain(sentence)
    }
  })

  test('the state of a date is written in words, not carried by colour', async () => {
    await page.goto(HOURS_PATH)

    // 1aa: "status = ikon + tekst, aldrig farve alene". A date with no change says so in a
    // sentence; a date with one carries a word — "Kladde" or "På hjemmesiden".
    await expect(page.getByText('de normale åbningstider gælder')).toBeVisible()
  })

  test('the two time fields stay usable at this width', async () => {
    await page.goto(EVERY_OVERRIDE_ERROR)

    // The phase brief's own rule, applied to the one-off card: at 375 the two fields share
    // the line and each takes half of it; at 1440 they sit beside the chips. Either way
    // each is wide enough for "00:00" plus the arrow.
    const width = await overrideFormOn(page)
      .getByLabel('Fra', { exact: true })
      .evaluate((element) => element.getBoundingClientRect().width)

    expect(width).toBeGreaterThanOrEqual(96)
  })
})

/**
 * A staff member's view of the same screen — phase 8B.
 *
 * Phase 8A sent them to `/admin/ingen-adgang` from this address, because the whole screen
 * was the Owner-only week. §5 puts the *one-off change* in both columns, so since 8B the
 * screen is theirs too, with the weekly card **absent** and a statement in its place. What
 * is scanned here is that half of the screen.
 */
test.describe('a staff member’s view of the same screen', () => {
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

    await expect(overrideFormOn(staffPage)).toBeVisible()

    const results = await new AxeBuilder({ page: staffPage }).withTags(TAGS).analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })

  test('says who can change the week, in words rather than with a locked form', async () => {
    await staffPage.goto(HOURS_PATH)

    await expect(staffPage.getByRole('heading', { name: 'Normale åbningstider' })).toBeVisible()
    await expect(staffPage.getByText('kan kun ejeren rette')).toBeVisible()

    // Not a disabled form — no form at all, so there is nothing to re-enable from the
    // browser and nothing that could be submitted.
    await expect(
      staffPage.getByRole('form', { name: 'Normale åbningstider', exact: true }),
    ).toHaveCount(0)
    await expect(staffPage.getByRole('checkbox')).toHaveCount(0)
  })

  test('keeps its 44 px targets and does not scroll sideways at this width', async () => {
    await staffPage.goto(HOURS_PATH)

    expect(await smallTargets(staffPage)).toEqual([])

    const overflow = await staffPage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )

    expect(overflow).toBe(false)
  })
})
