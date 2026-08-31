import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { addDays } from '@/lib/time/calendar'

import { OWNER, signIn, STAFF } from './support/admin'
import { ensureAvailability, isSoldOut, openSection } from './support/menu-admin'
import { hoursForm, openHoursAdmin } from './support/hours-admin'
import {
  closedOverride,
  customOverride,
  datesBetween,
  expectedResetOpening,
  fillOverride,
  firstNormallyClosedDay,
  guestBadge,
  HOURS_ADMIN_PATH,
  listedOverrideDates,
  OPEN_ALL_DAY,
  openOverrideCard,
  overrideCard,
  overrideFieldErrors,
  overrideForm,
  overridePendingBand,
  overrideStateBadge,
  overrideStateSentence,
  overrideVersion,
  pressAndSettle,
  previewBadge,
  publishFromBand,
  removeAllOverrides,
  removeOverride,
  saveAndPublishOverride,
  saveOverride,
  setOverrideDate,
  setOverrideKind,
  setOverrideTime,
  todayInCopenhagen,
  tooLateToOpenToday,
} from './support/hours-override'

/**
 * Ændrede tider en enkelt dag — design 1t (lower card), 1aa; §5, §6, §7b, §7e, §9.
 *
 * One promise, and it is the ordinary one this administration makes everywhere except on
 * the four immediate paths:
 *
 *     **Changing one date changes nothing a guest can see. Forhåndsvis shows the pending
 *      change on the real public pages. Offentliggør is what moves the hjemmeside — and a
 *      staff member may do all of it, while the normal week stays the owner's.**
 *
 * So the suite is written from the guest's side as much as from the staff member's, and the
 * guest is a real request with no session, no cookie and no browser cache — the same shape
 * `public-cache.spec.ts` uses, because §6's promise is about the **first** request after a
 * publish and a poll would turn that into "some request eventually".
 *
 * WHAT A GUEST CAN SEE, AND WHY IT IS THE BADGE
 *
 * A published override moves the **open/closed badge** — on every page, resolved by the
 * phase-2 engine from the weekly schedule *and* the published overrides — and §7b's
 * **sold-out reset**, through the same engine. Find os's seven-day table is the recurring
 * week and does not change, and the *generated announcement* that would say "Ændrede
 * åbningstider søndag" in words is **phase 8C**. The marker these scenarios use is
 * `til kl. 23:45`: the seeded week closes at 20:00 every open day, so only a published
 * override can produce it.
 *
 * It runs in order and shares one signed-in page, because it is one story. Every scenario
 * that creates an override removes it again, so an interrupted run leaves the database —
 * and every other suite that reads the same hours — where the seed left it.
 */

test.describe.configure({ mode: 'serial' })

/** The dish §7b's own worked examples are written about. */
const THOR = 'Thor'
const BURGERS = 'Burgere'

/** The §7b sentence, as a shape. The exact weekday and time are computed per scenario. */
const RESET_SENTENCE = /Nulstilles automatisk, når I åbner igen — (\S+dag) kl\. (\d{2}:\d{2})/

/** WCAG 2.2 A and AA, the same bar the public pages and the other editors are held to. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()

  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

let staffPage: Page
let guest: APIRequestContext

const TODAY = todayInCopenhagen()

test.beforeAll(async ({ browser, playwright }) => {
  staffPage = await (await browser.newContext()).newPage()
  await signIn(staffPage, STAFF)

  guest = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL })

  // The seed creates no override, and every scenario below removes what it makes. This is
  // the belt to that pair of braces: an earlier run interrupted halfway would otherwise
  // leave a row that changes what the first scenario's Gem *means*, and the failure would
  // point at the screen rather than at the leftover.
  await removeAllOverrides(staffPage)
})

test.afterAll(async () => {
  await guest.dispose()
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// The screen, as a staff member finds it
// ---------------------------------------------------------------------------

test('a staff member reaches the card from the dashboard', async () => {
  await staffPage.goto('/admin')

  // Phase 8A's tile was Owner-only and absent here. §5 puts the one-off change in both
  // columns, so the tile is now drawn for staff too — with 1q's own wording for it.
  await staffPage.getByRole('link', { name: 'Ret tider for en dag' }).click()

  await expect(staffPage).toHaveURL(new RegExp(HOURS_ADMIN_PATH))
  await expect(overrideForm(staffPage)).toBeVisible()
})

test('the normal week is not editable by a staff member, and says who can', async () => {
  await openOverrideCard(staffPage)

  // §5: an Owner-only area is **absent** for staff rather than shown and disabled. There
  // is no weekly form, no weekday switch and no weekly Offentliggør anywhere on the page.
  await expect(hoursForm(staffPage)).toHaveCount(0)
  await expect(staffPage.getByRole('checkbox')).toHaveCount(0)
  await expect(staffPage.getByRole('banner').getByRole('button', { name: 'Offentliggør' })).toHaveCount(0)

  for (const weekday of ['Mandag', 'Onsdag', 'Søndag']) {
    await expect(staffPage.getByRole('group', { name: weekday, exact: true })).toHaveCount(0)
  }

  // And a statement stands where the card would be, naming who can change it.
  await expect(
    staffPage.getByRole('heading', { name: 'Normale åbningstider' }),
  ).toBeVisible()
  await expect(staffPage.getByText('kan kun ejeren rette')).toBeVisible()
})

test('the card contains nothing of phase 8C', async () => {
  await openOverrideCard(staffPage)

  // Each is asserted by name rather than by a count, so a future phase that adds one has
  // to change this line rather than slip past it.
  await expect(staffPage.getByText(/Vis også som besked/i)).toHaveCount(0)
  await expect(staffPage.getByText(/Foreslået besked/i)).toHaveCount(0)
  await expect(staffPage.getByText(/Erstat med den nye besked/i)).toHaveCount(0)
  await expect(staffPage.getByText(/Behold eksisterende/i)).toHaveCount(0)

  // And no field the card could smuggle an announcement through. `$ACTION_ID` is Next.js's
  // own hidden field naming the Server Action; it carries no content and is dropped rather
  // than allow-listed by name, because its value changes with every build.
  const names = await overrideForm(staffPage)
    .locator('input, select')
    .evaluateAll((elements) =>
      elements
        .map((element) => (element as HTMLInputElement).name)
        .filter((name) => name.length > 0 && !name.startsWith('$')),
    )

  expect([...new Set(names)].sort()).toEqual(['art', 'dato', 'fra', 'til', 'version', 'version-dato'])
})

test('the two chips are one named radio group, and the times follow the second', async () => {
  await openOverrideCard(staffPage)

  const group = overrideForm(staffPage).getByRole('group', { name: 'Hvad sker der den dag?' })
  await expect(group).toBeVisible()

  // Closed is the state a date with no override starts in, and it asks for no times.
  await expect(
    overrideForm(staffPage).getByRole('radio', { name: 'Lukket en bestemt dato' }),
  ).toBeChecked()
  await expect(overrideForm(staffPage).getByLabel('Fra', { exact: true })).toBeHidden()

  // Choosing the other one reveals them, with no JavaScript involved: the radio is a
  // sibling of the fields and `peer-checked/andre:` is a `~` combinator.
  await setOverrideKind(staffPage, 'custom')
  await expect(overrideForm(staffPage).getByLabel('Fra', { exact: true })).toBeVisible()
  await expect(overrideForm(staffPage).getByLabel('Til', { exact: true })).toBeVisible()

  // 1t's "kvarter-spring", plus the "not chosen" placeholder.
  await expect(
    overrideForm(staffPage).getByLabel('Fra', { exact: true }).getByRole('option'),
  ).toHaveCount(97)
})

// ---------------------------------------------------------------------------
// The story the phase brief asks for: closed → published → edited to custom
// ---------------------------------------------------------------------------

test.describe('one date, all the way through', () => {
  test.skip(
    tooLateToOpenToday(),
    'An opening cannot cross midnight, so after 23:30 no override can make the badge say "Åbent nu" — the flip these scenarios assert has nothing to flip to.',
  )

  test('a closed override saves as a pending change and leaves the hjemmeside alone', async () => {
    const before = await guestBadge(guest)
    expect(before.status).toBe(200)
    expect(before.marker, 'no seeded week produces this closing time').toBe(false)

    await openOverrideCard(staffPage, TODAY)
    await fillOverride(staffPage, { date: TODAY, kind: 'closed' })
    await saveOverride(staffPage)

    await expect(staffPage.getByRole('status').first()).toContainText('gemt som kladde')
    await expect(overrideStateBadge(staffPage)).toHaveText('Kladde')
    await expect(overridePendingBand(staffPage)).toContainText('Lukket hele dagen')

    // And the guest reads exactly what they read before.
    const during = await guestBadge(guest)
    expect(during.open).toBe(before.open)
    expect(during.marker).toBe(false)
  })

  test('the Kladde state has no accessibility violations', async () => {
    await openOverrideCard(staffPage, TODAY)

    await expect(overridePendingBand(staffPage)).toBeVisible()
    expect(await violations(staffPage)).toEqual([])
  })

  test('the dashboard lists the pending change as not yet published', async () => {
    await staffPage.goto('/admin')

    await expect(
      staffPage.getByRole('form', { name: 'Ændringer der venter' }).getByText('Ændret åbningstid'),
    ).toBeVisible()
  })

  test('Forhåndsvis shows the pending closure on the real public page', async () => {
    await openOverrideCard(staffPage, TODAY)

    const preview = await previewBadge(staffPage)
    expect(preview.open, 'the preview closes the restaurant for today').toBe(false)
  })

  test('Offentliggør puts the closure on the hjemmeside, on the first guest request', async () => {
    await openOverrideCard(staffPage, TODAY)
    await publishFromBand(staffPage)

    await expect(staffPage.getByRole('status').first()).toContainText(
      'står nu på hjemmesiden',
    )
    await expect(overrideStateBadge(staffPage)).toHaveText('På hjemmesiden')
    await expect(overridePendingBand(staffPage)).toBeHidden()

    // One request. Not a poll, not a second attempt.
    const after = await guestBadge(guest)
    expect(after.cacheState, 'the first request after a publish is not answered from a stale cache').not.toBe('STALE')
    expect(after.open, 'the restaurant is closed today').toBe(false)
  })

  test('editing the same date to other hours is a pending change, and does not leak', async () => {
    await openOverrideCard(staffPage, TODAY)

    // The card shows the published override, not an empty form (§7e).
    await expect(
      overrideForm(staffPage).getByRole('radio', { name: 'Lukket en bestemt dato' }),
    ).toBeChecked()

    await fillOverride(staffPage, { date: TODAY, kind: 'custom', ...OPEN_ALL_DAY })
    await saveOverride(staffPage)

    await expect(overrideStateBadge(staffPage)).toHaveText('Kladde')

    // The state sentence names **both** answers: what the hjemmeside says, and what waits.
    const sentence = await overrideStateSentence(staffPage)
    expect(sentence).toContain('Lukket hele dagen')
    expect(sentence).toContain(`00:00–${OPEN_ALL_DAY.to}`)

    // The guest keeps the published closed state. This is the assertion the whole draft
    // column exists for.
    const during = await guestBadge(guest)
    expect(during.open, 'a pending edit does not reopen the restaurant').toBe(false)
    expect(during.marker, 'and the pending closing time has not leaked').toBe(false)
  })

  test('Forhåndsvis shows the pending hours, and Offentliggør puts them on the hjemmeside', async () => {
    await openOverrideCard(staffPage, TODAY)

    const preview = await previewBadge(staffPage)
    expect(preview.open).toBe(true)
    expect(preview.marker, 'the preview carries the pending closing time').toBe(true)

    await openOverrideCard(staffPage, TODAY)
    await publishFromBand(staffPage)

    const after = await guestBadge(guest)
    expect(after.cacheState).not.toBe('STALE')
    expect(after.open).toBe(true)
    expect(after.marker, 'the first guest request carries the published hours').toBe(true)
  })

  test('and the same publish reaches every public page, not only the Forside', async () => {
    for (const path of ['/menu', '/find-os', '/om-os']) {
      const badge = await guestBadge(guest, path)

      expect(badge.marker, `${path} carries the published override`).toBe(true)
    }
  })

  test('removing the published override asks first, and gives the date back to the week', async () => {
    await openOverrideCard(staffPage, TODAY)

    // Pressing it must not remove anything: it is a link to a confirmation, exactly as
    // phase 5D's Slet ret is.
    const control = overrideCard(staffPage).getByRole('link', {
      name: 'Fjern ændringen fra hjemmesiden',
    })
    await expect(control).toBeVisible()
    await control.click()

    await expect(
      overrideCard(staffPage).getByRole('link', { name: 'Behold ændringen' }),
    ).toBeVisible()

    const stillThere = await guestBadge(guest)
    expect(stillThere.marker, 'asking removes nothing').toBe(true)

    await overrideCard(staffPage).getByRole('button', { name: /^Ja — fjern/ }).click()
    await staffPage.waitForURL(/status=enkelt_fjernet/)

    const after = await guestBadge(guest)
    expect(after.cacheState).not.toBe('STALE')
    expect(after.marker, 'the date follows the normal week again, on the first request').toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test('a date that has already been is refused, by name', async () => {
  await openOverrideCard(staffPage)

  await setOverrideDate(staffPage, addDays(TODAY, -1))
  await setOverrideKind(staffPage, 'closed')
  await saveOverride(staffPage)

  expect(await overrideFieldErrors(staffPage)).toEqual([
    'Datoen er passeret. Vælg i dag eller en dag længere fremme.',
  ])

  // Bound to the control a person moves to fix it, and the control is marked — so the
  // problem is never carried by the red border alone (1aa).
  const field = overrideForm(staffPage).getByLabel('Dato', { exact: true })
  await expect(field).toHaveAttribute('aria-invalid', 'true')

  // And the value the sentence is about is still in the field. A card that swapped it for
  // today would name a problem with a date it had just thrown away.
  await expect(field).toHaveValue(addDays(TODAY, -1))

  await expect(overridePendingBand(staffPage)).toBeHidden()
  expect(await listedOverrideDates(staffPage)).toEqual([])
})

test('other hours with no times chosen are refused, on both fields', async () => {
  await openOverrideCard(staffPage)

  await setOverrideDate(staffPage, addDays(TODAY, 4))
  await setOverrideKind(staffPage, 'custom')
  await saveOverride(staffPage)

  expect(await overrideFieldErrors(staffPage)).toEqual([
    'Vælg, hvornår I åbner den dag.',
    'Vælg, hvornår I lukker den dag.',
  ])
  expect(await listedOverrideDates(staffPage)).toEqual([])
})

test('a closing time before its opening is refused, on the closing field', async () => {
  await openOverrideCard(staffPage)

  await setOverrideDate(staffPage, addDays(TODAY, 4))
  await setOverrideKind(staffPage, 'custom')
  await setOverrideTime(staffPage, 'Fra', '18:00')
  await setOverrideTime(staffPage, 'Til', '13:00')
  await saveOverride(staffPage)

  expect(await overrideFieldErrors(staffPage)).toEqual([
    'Lukketiden skal ligge efter åbningstiden. Åbningstider kan ikke gå over midnat.',
  ])

  const closing = overrideForm(staffPage).getByLabel('Til', { exact: true })
  await expect(closing).toHaveAttribute('aria-invalid', 'true')

  const describedBy = (await closing.getAttribute('aria-describedby')) ?? ''
  await expect(staffPage.locator(`#${describedBy}`)).toContainText('ligge efter åbningstiden')
})

test('the refusal state has no accessibility violations', async () => {
  expect(await violations(staffPage)).toEqual([])
})

test('choosing a date that already has a change shows it rather than creating a second', async () => {
  const date = addDays(TODAY, 6)

  await openOverrideCard(staffPage)
  await fillOverride(staffPage, { date, kind: 'custom', from: '11:00', to: '14:00' })
  await saveOverride(staffPage)

  await expect(overrideStateBadge(staffPage)).toHaveText('Kladde')

  // Now start again from a *different* date's card and type the taken one. The version
  // token in the form belongs to another row, so nothing is written and the card re-opens
  // on that date, showing what is already there (§7e).
  await openOverrideCard(staffPage, addDays(TODAY, 7))
  await fillOverride(staffPage, { date, kind: 'closed' })
  await saveOverride(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText(
    'Der er allerede en ændring for den dato',
  )
  await expect(staffPage).toHaveURL(new RegExp(`dato=${date}`))
  await expect(
    overrideForm(staffPage).getByRole('radio', { name: 'Andre tider en enkelt dag' }),
  ).toBeChecked()
  await expect(overrideForm(staffPage).getByLabel('Fra', { exact: true })).toHaveValue('11:00')

  // One row, not two.
  expect(await listedOverrideDates(staffPage)).toHaveLength(1)

  await removeOverride(staffPage)
})

test('a stale version token is refused rather than silently overwriting', async () => {
  const date = addDays(TODAY, 9)

  await openOverrideCard(staffPage)
  await fillOverride(staffPage, { date, kind: 'closed' })
  await saveOverride(staffPage)

  const version = await overrideVersion(staffPage)

  // A second save from the same rendered page moves the version…
  await setOverrideKind(staffPage, 'custom')
  await setOverrideTime(staffPage, 'Fra', '12:00')
  await setOverrideTime(staffPage, 'Til', '15:00')
  await saveOverride(staffPage)

  // …and putting the old token back by hand is exactly what a second tab would send.
  await overrideForm(staffPage)
    .locator('input[name="version"]')
    .first()
    .evaluate((input, value) => {
      ;(input as HTMLInputElement).value = value
    }, version)

  await setOverrideTime(staffPage, 'Til', '16:00')
  await pressAndSettle(staffPage, () =>
    overrideForm(staffPage).getByRole('button', { name: 'Gem', exact: true }).click(),
  )

  await expect(staffPage.getByRole('status').first()).toContainText('Nogen andre har rettet dette')

  // Nothing was overwritten: the card still holds what the successful save wrote.
  await openOverrideCard(staffPage, date)
  await expect(overrideForm(staffPage).getByLabel('Til', { exact: true })).toHaveValue('15:00')

  await removeOverride(staffPage)
})

// ---------------------------------------------------------------------------
// Removing a pending change
// ---------------------------------------------------------------------------

test('a pending change can be taken away without asking, because no guest can see it', async () => {
  const date = addDays(TODAY, 11)

  await openOverrideCard(staffPage)
  await fillOverride(staffPage, { date, kind: 'closed' })
  await saveOverride(staffPage)

  const control = overrideCard(staffPage).getByRole('button', { name: 'Fjern kladden' })
  await expect(control).toBeVisible()

  await removeOverride(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText('Kladden er fjernet')
  expect(await listedOverrideDates(staffPage)).toEqual([])
})

test('a pending edit to a published change can be dropped, leaving the published one alone', async () => {
  const date = addDays(TODAY, 12)

  await openOverrideCard(staffPage)
  await fillOverride(staffPage, { date, kind: 'closed' })
  await saveAndPublishOverride(staffPage)
  await expect(overrideStateBadge(staffPage)).toHaveText('På hjemmesiden')

  await fillOverride(staffPage, { date, kind: 'custom', from: '13:00', to: '18:00' })
  await saveOverride(staffPage)
  await expect(overrideStateBadge(staffPage)).toHaveText('Kladde')

  await removeOverride(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText(
    'Det, der står på hjemmesiden, er uændret',
  )

  await openOverrideCard(staffPage, date)
  await expect(overrideStateBadge(staffPage)).toHaveText('På hjemmesiden')
  await expect(
    overrideForm(staffPage).getByRole('radio', { name: 'Lukket en bestemt dato' }),
  ).toBeChecked()

  await removeOverride(staffPage)
})

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

test('the whole workflow can be completed with the keyboard alone', async () => {
  const date = addDays(TODAY, 14)

  await openOverrideCard(staffPage)

  const closedChip = overrideForm(staffPage).getByRole('radio', {
    name: 'Lukket en bestemt dato',
  })
  const customChip = overrideForm(staffPage).getByRole('radio', {
    name: 'Andre tider en enkelt dag',
  })

  // The date field takes a typed date. `type="date"` renders as segments a person moves
  // between with the arrow keys rather than with Tab, so this is what somebody actually
  // does: focus it and type the digits.
  const dateField = overrideForm(staffPage).getByLabel('Dato', { exact: true })
  await dateField.focus()
  await expect(dateField).toBeFocused()
  await staffPage.keyboard.type(date.split('-').reverse().join(''))
  await expect(dateField).toHaveValue(date)

  /*
   * The chips are a real radio group, which is what a keyboard gets from them that two
   * buttons would not: Tab enters at the chosen chip, and the **arrow keys** move within
   * the group without leaving it.
   */
  await closedChip.focus()
  await expect(closedChip).toBeFocused()

  await staffPage.keyboard.press('ArrowRight')
  await expect(customChip).toBeChecked()
  await expect(customChip).toBeFocused()

  // And the two fields it revealed are the next stops after the group.
  await staffPage.keyboard.press('Tab')
  await expect(overrideForm(staffPage).getByLabel('Fra', { exact: true })).toBeFocused()

  await staffPage.keyboard.press('Tab')
  await expect(overrideForm(staffPage).getByLabel('Til', { exact: true })).toBeFocused()

  await overrideForm(staffPage).getByLabel('Fra', { exact: true }).selectOption('12:00')
  await overrideForm(staffPage).getByLabel('Til', { exact: true }).selectOption('16:00')

  await overrideForm(staffPage).getByRole('button', { name: 'Gem', exact: true }).focus()
  await pressAndSettle(staffPage, () => staffPage.keyboard.press('Enter'))

  await expect(overridePendingBand(staffPage)).toContainText('12:00–16:00')

  // 1aa's focus ring is 3 px and is set globally in app/globals.css, so it is asserted once
  // here against a real focused element rather than restated per control. The chip's own
  // input is visually hidden, so the ring lands on the label that draws it.
  await closedChip.focus()
  const outlineWidth = await closedChip
    .locator('xpath=following-sibling::label[1]')
    .evaluate((element) => getComputedStyle(element).outlineWidth)

  expect(outlineWidth).toBe('3px')

  await removeOverride(staffPage)
})

// ---------------------------------------------------------------------------
// §7b — what a published override feeds
// ---------------------------------------------------------------------------

/**
 * Both directions §7b names, against the real administration.
 *
 * The whole sold-out matrix — every weekday, both DST transitions, overrides in both
 * directions — is asserted in `tests/unit/menu/sold-out.test.ts` against the pure function.
 * What can only be asserted here is the **wiring**: that the administration's reset sentence
 * is resolved from the *published* overrides, so a pending one does not move it and a
 * published one does, in both directions.
 *
 * The expectation is computed with the engine the application itself uses, rather than with
 * a second implementation of §7b's arithmetic — the claim under test is that the screen and
 * the engine agree, not that the engine is right.
 *
 */
test.describe('the sold-out reset', () => {
  test('follows the published overrides, in both directions', async ({}, testInfo) => {
    /*
     * Desktop only. Nothing here is a question about layout, and the scenario publishes up
     * to six overrides to construct the second direction; running it at both widths would
     * double a long write sequence to assert the same fact twice.
     */
    test.skip(
      testInfo.project.name.endsWith('-mobile'),
      'The §7b wiring is not a layout question, and the scenario is a long write sequence.',
    )

    await ensureAvailability(staffPage, BURGERS, THOR, true)

    const resetTime = async (): Promise<{ weekday: string; time: string }> => {
      await openSection(staffPage, BURGERS)
      const text = await staffPage.getByText(RESET_SENTENCE).first().innerText()
      const match = RESET_SENTENCE.exec(text)

      expect(match, 'the administration states when the dish comes back').not.toBeNull()

      return { weekday: match?.[1] ?? '', time: match?.[2] ?? '' }
    }

    const publish = async (
      date: string,
      kind: 'closed' | 'custom',
      from?: string,
      to?: string,
    ): Promise<void> => {
      await openOverrideCard(staffPage, date)
      await fillOverride(staffPage, { date, kind, from, to })
      await saveAndPublishOverride(staffPage)
      await expect(overrideStateBadge(staffPage)).toHaveText('På hjemmesiden')
    }

    // The seeded week's own answer, before any override exists.
    expect(await resetTime()).toMatchObject({
      time: expectedResetOpening(TODAY, []).time,
    })

    /*
     * Direction one — a normally **open** day, closed.
     *
     * The days to close are every open day between today and the next normally-closed one,
     * because direction two needs the engine to *reach* that closed day. When today is a
     * Sunday or a Monday there are none — the very next day is already closed in the seeded
     * week — and this direction would then have nothing to assert, whichever weekday the
     * suite happens to run on. So in that case the day it closes is the one the reset
     * currently lands on, which always exists and is always normally open.
     *
     * Either way the **first** publish has to move the answer, which is asserted explicitly
     * rather than left to the engine comparison: an assertion that the screen agrees with
     * the engine passes trivially if neither of them moved.
     */
    const closedDay = firstNormallyClosedDay(addDays(TODAY, 1))
    const daysBeforeIt = datesBetween(TODAY, closedDay)
    const openDays =
      daysBeforeIt.length > 0 ? daysBeforeIt : [expectedResetOpening(TODAY, []).date]

    const overrides = []
    const beforeAnyClosure = await resetTime()

    for (const date of openDays) {
      // A draft first, to prove it moves nothing.
      await openOverrideCard(staffPage, date)
      await fillOverride(staffPage, { date, kind: 'closed' })
      await saveOverride(staffPage)

      expect(
        await resetTime(),
        'a pending override does not move the sold-out reset',
      ).toMatchObject({ time: expectedResetOpening(TODAY, overrides).time })

      await openOverrideCard(staffPage, date)
      await publishFromBand(staffPage)

      overrides.push(closedOverride(date))

      expect(
        await resetTime(),
        'a published closure is skipped by the reset',
      ).toMatchObject({ time: expectedResetOpening(TODAY, overrides).time })
    }

    expect(
      await resetTime(),
      'closing the day the dish would have come back on actually moved the answer',
    ).not.toEqual(beforeAnyClosure)

    /*
     * Direction two — a normally **closed** day, opened.
     *
     * This is the case §11 calls especially important: a day the engine would skip becomes
     * the reset day, at the override's own opening time. Nothing in phase 8B writes
     * sold-out logic; the behaviour arrives because `resolveSoldOut` resolves against the
     * published overrides, and has since phase 2.
     */
    expect(
      await resetTime(),
      'a normally closed day is skipped while it has no override',
    ).toMatchObject({ time: expectedResetOpening(TODAY, overrides).time })

    await publish(closedDay, 'custom', '07:15', '08:15')
    overrides.push(customOverride(closedDay, '07:15', '08:15'))

    const expected = expectedResetOpening(TODAY, overrides)
    expect(expected.date, 'the override day is now the first opening').toBe(closedDay)

    expect(
      await resetTime(),
      'a published override opens a normally closed day, and the reset uses it',
    ).toMatchObject({ time: '07:15' })

    // Back to the seed: every override removed, and Thor available.
    await removeAllOverrides(staffPage)

    expect(await resetTime()).toMatchObject({ time: expectedResetOpening(TODAY, []).time })

    await ensureAvailability(staffPage, BURGERS, THOR, false)
    expect(await isSoldOut(staffPage, THOR)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The owner
// ---------------------------------------------------------------------------

test.describe('as the owner', () => {
  let ownerPage: Page

  test.beforeAll(async ({ browser }) => {
    ownerPage = await (await browser.newContext()).newPage()
    await signIn(ownerPage, OWNER)
  })

  test.afterAll(async () => {
    await ownerPage.context().close()
  })

  test('sees both cards, and the weekly one is still editable', async () => {
    await openHoursAdmin(ownerPage)

    await expect(hoursForm(ownerPage)).toBeVisible()
    await expect(overrideForm(ownerPage)).toBeVisible()

    // The weekly card's own controls are there, and so is the bar's Offentliggør.
    await expect(ownerPage.getByRole('group', { name: 'Onsdag', exact: true })).toBeVisible()
    await expect(
      ownerPage.getByRole('banner').getByRole('button', { name: 'Offentliggør' }),
    ).toBeVisible()

    // And the staff member's statement is not shown to somebody who can edit the week.
    await expect(ownerPage.getByText('kan kun ejeren rette')).toHaveCount(0)
  })

  test('can run the one-off workflow too', async () => {
    const date = addDays(TODAY, 16)

    await openOverrideCard(ownerPage, date)
    await fillOverride(ownerPage, { date, kind: 'custom', from: '10:00', to: '12:00' })
    await saveOverride(ownerPage)

    await expect(overrideStateBadge(ownerPage)).toHaveText('Kladde')

    await publishFromBand(ownerPage)
    await expect(overrideStateBadge(ownerPage)).toHaveText('På hjemmesiden')

    await openOverrideCard(ownerPage, date)
    await removeOverride(ownerPage)

    expect(await listedOverrideDates(ownerPage)).toEqual([])
  })

  test('the weekly card is untouched by everything the one-off card did', async () => {
    await openHoursAdmin(ownerPage)

    await expect(ownerPage.getByRole('banner').getByText(/^(Kladde|Live)$/)).toHaveText('Live')
    await expect(
      ownerPage.getByRole('status').filter({ hasText: /venter på at blive offentliggjort/ }),
    ).toBeHidden()
  })
})

// ---------------------------------------------------------------------------
// The state the seed must be left in
// ---------------------------------------------------------------------------

test('every one-off change is gone again', async () => {
  await removeAllOverrides(staffPage)

  await openOverrideCard(staffPage)
  expect(await listedOverrideDates(staffPage)).toEqual([])
  await expect(overrideStateBadge(staffPage)).toHaveCount(0)

  const guestNow = await guestBadge(guest)
  expect(guestNow.marker).toBe(false)
})
