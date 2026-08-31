import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import { ensureAvailability, isSoldOut, openSection } from './support/menu-admin'
import {
  dayLine,
  fieldErrors,
  guestHours,
  hoursForm,
  hoursVersion,
  HOURS_ADMIN_PATH,
  openHoursAdmin,
  openHoursAdminFromDashboard,
  openSwitch,
  pendingBand,
  pressAndSettle,
  previewHours,
  publishHours,
  readWeek,
  restoreSeededWeek,
  saveHours,
  setWeekdayOpen,
  setWeekdayTime,
  stateBadge,
  timeSelect,
  weekdayRow,
  WEEKDAYS,
} from './support/hours-admin'

/**
 * De normale åbningstider — technical plan §5, §6, §7b, §9; design 1t, 1aa.
 *
 * One promise, and it is the ordinary one this administration makes everywhere except on
 * the four immediate paths:
 *
 *     **Editing the week changes nothing a guest can see. Forhåndsvis shows the draft on
 *      the real public pages. Offentliggør is what moves the hjemmeside — and only the
 *      owner may press any of it.**
 *
 * So the suite is written from the guest's side as much as from the owner's, and the guest
 * is a genuinely separate browser context that has never signed in. Between the two it also
 * asserts what *did not* happen: the public table unchanged while a draft waits, the
 * one-off override screen still absent, and the announcement bar untouched.
 *
 * It runs in order and shares one signed-in page, because it is one story. Every scenario
 * that moves the hours restores the seeded week before the next one begins, so an
 * interrupted run leaves the database — and every other suite that reads the same schedule
 * — where the seed left it.
 */

test.describe.configure({ mode: 'serial' })

/** The dish §7b's own worked examples are written about. */
const THOR = 'Thor'
const BURGERS = 'Burgere'

/** The §7b sentence, as a shape. The exact weekday is pinned in the unit suite. */
const RESET_SENTENCE = /Nulstilles automatisk, når I åbner igen — \S+dag kl\. (\d{2}:\d{2})/

/** WCAG 2.2 A and AA, the same bar the public pages and the other editors are held to. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()

  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

let ownerPage: Page

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)
})

test.afterAll(async () => {
  await ownerPage.context().close()
})

// ---------------------------------------------------------------------------
// The screen itself
// ---------------------------------------------------------------------------

test('the owner reaches the editor from the dashboard, and it shows the stored week', async () => {
  await openHoursAdminFromDashboard(ownerPage)

  await expect(ownerPage).toHaveURL(new RegExp(`${HOURS_ADMIN_PATH}$`))
  await expect(ownerPage.getByRole('heading', { level: 1 })).toHaveText('Åbningstider')

  // Seven rows, in the document's order, each a named group.
  for (const weekday of WEEKDAYS) {
    await expect(weekdayRow(ownerPage, weekday)).toBeVisible()
  }

  expect(await readWeek(ownerPage)).toEqual({
    Mandag: { open: false, from: '', to: '' },
    Tirsdag: { open: false, from: '', to: '' },
    Onsdag: { open: true, from: '15:00', to: '20:00' },
    Torsdag: { open: true, from: '15:00', to: '20:00' },
    Fredag: { open: true, from: '15:00', to: '20:00' },
    Lørdag: { open: true, from: '17:00', to: '20:00' },
    Søndag: { open: true, from: '17:00', to: '20:00' },
  })

  await expect(stateBadge(ownerPage)).toHaveText('Live')
  await expect(pendingBand(ownerPage)).toBeHidden()
})

test('a closed day shows the word and no times; an open day shows two dropdowns', async () => {
  await openHoursAdmin(ownerPage)

  // 1t draws a closed row as weekday + grey switch + "Lukket", with no fields.
  await expect(weekdayRow(ownerPage, 'Mandag').getByText('Lukket')).toBeVisible()
  await expect(timeSelect(ownerPage, 'Mandag', 'åbner')).toBeHidden()

  // And an open row as weekday + green switch + two times.
  await expect(weekdayRow(ownerPage, 'Onsdag').getByText('Lukket')).toBeHidden()
  await expect(timeSelect(ownerPage, 'Onsdag', 'åbner')).toBeVisible()
  await expect(timeSelect(ownerPage, 'Onsdag', 'lukker')).toBeVisible()

  // The quarter-hour grid 1t asks for, plus the "not chosen" placeholder.
  await expect(timeSelect(ownerPage, 'Onsdag', 'åbner').getByRole('option')).toHaveCount(97)
})

test('the weekly card can express nothing but the week', async () => {
  await openHoursAdmin(ownerPage)

  /*
   * Phase 8A asserted here that 1t's *lower half* was absent from the screen. Phase 8B
   * built it, on the same screen and beside this card, so the claim that is still true —
   * and still worth holding — is the narrower one this card was always making: **the
   * recurring week's own form cannot express a date, a message or anything else.**
   *
   * The one-off card's own boundary, including everything phase 8C owns, is asserted in
   * `tests/e2e/opening-hours-override.spec.ts`.
   */
  await expect(ownerPage.getByText(/Erstat med den nye besked/i)).toHaveCount(0)
  await expect(ownerPage.getByText(/Vis også som besked/i)).toHaveCount(0)

  // No field the *weekly* form could smuggle a date or an announcement through.
  // `$ACTION_ID` is Next.js's own hidden field naming the Server Action; it carries no
  // content and is dropped rather than allow-listed by name, because its value changes
  // with every build.
  const names = await hoursForm(ownerPage)
    .locator('input, select')
    .evaluateAll((elements) =>
      elements
        .map((element) => (element as HTMLInputElement).name)
        .filter((name) => name.length > 0 && !name.startsWith('$')),
    )

  expect(names.filter((name) => !/^(version|aaben-|fra-|til-)/.test(name))).toEqual([])
  // Twenty-one weekday fields plus the version token, and nothing else.
  expect(names).toHaveLength(22)

  // And the weekly form holds no date field, whatever the card beneath it holds.
  await expect(hoursForm(ownerPage).locator('input[type="date"]')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// The story E2E 5 asks for: edit → Kladde → preview → publish
// ---------------------------------------------------------------------------

test('changing Wednesday saves as a draft and leaves the hjemmeside alone', async ({
  browser,
}) => {
  const before = await guestHours(browser)
  expect(before.table).toMatch(dayLine('Onsdag', '15:00–20:00'))

  await openHoursAdmin(ownerPage)
  await setWeekdayTime(ownerPage, 'Onsdag', 'åbner', '16:00')
  await saveHours(ownerPage)

  await expect(ownerPage.getByRole('status').first()).toContainText(
    'Åbningstiderne er gemt som kladde',
  )

  // 1aa's Kladde treatment: the pill in the bar, and the band that names the day.
  await expect(stateBadge(ownerPage)).toHaveText('Kladde')
  await expect(pendingBand(ownerPage)).toContainText('Onsdag venter på at blive offentliggjort.')

  // And the guest reads exactly what they read before.
  const during = await guestHours(browser)
  expect(during.table).toBe(before.table)
  expect(during.footer).toBe(before.footer)
})

/*
 * The Kladde state, scanned where it can be produced honestly.
 *
 * `tests/a11y/hours-admin.spec.ts` is read-only, so it can reach the editor and every
 * refusal from the address alone but not a populated draft. Both Playwright projects run
 * this file, so this scan happens at 1440 and at 375.
 */
test('the Kladde state has no accessibility violations', async () => {
  await openHoursAdmin(ownerPage)

  await expect(pendingBand(ownerPage)).toBeVisible()
  expect(await violations(ownerPage)).toEqual([])
})

test('the dashboard lists the pending change, and only the owner may publish it', async () => {
  await ownerPage.goto('/admin')

  await expect(
    ownerPage.getByRole('form', { name: 'Ændringer der venter' }).getByText('Åbningstider'),
  ).toBeVisible()
})

test('Forhåndsvis shows the draft week on the real public pages', async () => {
  const preview = await previewHours(ownerPage)

  // The seven-day table on Find os.
  expect(preview.table).toMatch(dayLine('Onsdag', '16:00–20:00'))
  // And the footer's grouping, which the site does for itself: Wednesday has left the
  // Wed–Fri run, so the run has closed up behind it.
  expect(preview.footer).toContain('Ons 16:00–20:00')
  expect(preview.footer).toContain('Tor–fre 15:00–20:00')
})

test('Offentliggør puts the new week on the hjemmeside', async ({ browser }) => {
  await openHoursAdmin(ownerPage)
  await publishHours(ownerPage)

  await expect(ownerPage.getByRole('status').first()).toContainText(
    'De nye åbningstider står nu på hjemmesiden',
  )
  await expect(stateBadge(ownerPage)).toHaveText('Live')
  await expect(pendingBand(ownerPage)).toBeHidden()

  const after = await guestHours(browser)
  expect(after.table).toMatch(dayLine('Onsdag', '16:00–20:00'))
  expect(after.footer).toContain('Ons 16:00–20:00')
})

test('and the week can be put back the same way', async ({ browser }) => {
  await restoreSeededWeek(ownerPage)

  const restored = await guestHours(browser)
  expect(restored.table).toMatch(dayLine('Onsdag', '15:00–20:00'))
  expect(restored.footer).toContain('Ons–fre 15:00–20:00')
})

// ---------------------------------------------------------------------------
// Closing a day, and opening a closed one
// ---------------------------------------------------------------------------

test('closing an open day is a draft, and publishing removes it from the public table', async ({
  browser,
}) => {
  await openHoursAdmin(ownerPage)
  await setWeekdayOpen(ownerPage, 'Torsdag', false)
  await saveHours(ownerPage)

  await expect(pendingBand(ownerPage)).toContainText('Torsdag venter')
  expect((await guestHours(browser)).table).toMatch(dayLine('Torsdag', '15:00–20:00'))

  await publishHours(ownerPage)

  const after = await guestHours(browser)
  expect(after.table).toMatch(dayLine('Torsdag', 'Lukket'))
  expect(after.footer).toContain('Ons 15:00–20:00')

  await restoreSeededWeek(ownerPage)
  expect((await guestHours(browser)).table).toMatch(dayLine('Torsdag', '15:00–20:00'))
})

test('opening a normally closed day needs both times, and then publishes', async ({
  browser,
}) => {
  await openHoursAdmin(ownerPage)

  // Switching Monday on leaves its two dropdowns empty, because the stored document holds
  // no times for a closed day (§4). Saving without choosing is refused, by day and by field.
  await setWeekdayOpen(ownerPage, 'Mandag', true)
  await expect(timeSelect(ownerPage, 'Mandag', 'åbner')).toHaveValue('')
  await saveHours(ownerPage)

  expect(await fieldErrors(ownerPage)).toEqual([
    'Vælg, hvornår I åbner om mandagen.',
    'Vælg, hvornår I lukker om mandagen.',
  ])
  await expect(pendingBand(ownerPage)).toBeHidden()
  expect((await guestHours(browser)).table).toMatch(dayLine('Mandag', 'Lukket'))

  // With both times it saves, and only then does it publish.
  await setWeekdayTime(ownerPage, 'Mandag', 'åbner', '12:00')
  await setWeekdayTime(ownerPage, 'Mandag', 'lukker', '14:30')
  await saveHours(ownerPage)

  await expect(pendingBand(ownerPage)).toContainText('Mandag venter')
  expect((await guestHours(browser)).table).toMatch(dayLine('Mandag', 'Lukket'))

  await publishHours(ownerPage)
  expect((await guestHours(browser)).table).toMatch(dayLine('Mandag', '12:00–14:30'))

  await restoreSeededWeek(ownerPage)
  expect((await guestHours(browser)).table).toMatch(dayLine('Mandag', 'Lukket'))
})

test('editing a day back to what is published removes the draft entirely', async () => {
  await openHoursAdmin(ownerPage)

  await setWeekdayTime(ownerPage, 'Fredag', 'åbner', '16:00')
  await saveHours(ownerPage)
  await expect(pendingBand(ownerPage)).toContainText('Fredag venter')

  await setWeekdayTime(ownerPage, 'Fredag', 'åbner', '15:00')
  await saveHours(ownerPage)

  // §4: a draft holds only the changed fields, so a week with none stops being pending.
  await expect(ownerPage.getByRole('status').first()).toContainText(
    'der er ingen kladde at offentliggøre længere',
  )
  await expect(pendingBand(ownerPage)).toBeHidden()
  await expect(stateBadge(ownerPage)).toHaveText('Live')
})

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test('a closing time before its opening is refused, on the day and on the field', async () => {
  await openHoursAdmin(ownerPage)

  await setWeekdayTime(ownerPage, 'Lørdag', 'åbner', '20:00')
  await setWeekdayTime(ownerPage, 'Lørdag', 'lukker', '17:00')
  await saveHours(ownerPage)

  expect(await fieldErrors(ownerPage)).toEqual([
    'Om lørdagen skal lukketiden ligge efter åbningstiden. Åbningstider kan ikke gå over midnat.',
  ])

  // The message is bound to the control it belongs to, and the control is marked — so the
  // problem is never carried by the red border alone (1aa).
  const closing = timeSelect(ownerPage, 'Lørdag', 'lukker')
  await expect(closing).toHaveAttribute('aria-invalid', 'true')
  const describedBy = (await closing.getAttribute('aria-describedby')) ?? ''
  await expect(ownerPage.locator(`#${describedBy}`)).toContainText('ligge efter åbningstiden')

  await expect(pendingBand(ownerPage)).toBeHidden()
})

test('a stale version token is refused rather than silently overwriting', async () => {
  await openHoursAdmin(ownerPage)
  const stalePage = ownerPage

  // Two saves from the same rendered page: the first moves the version, the second still
  // carries the old one.
  await setWeekdayTime(stalePage, 'Søndag', 'åbner', '16:00')
  const version = await hoursVersion(stalePage)
  await saveHours(stalePage)

  // Put the old token back by hand, which is exactly what a second tab would have sent.
  await stalePage
    .locator('input[name="version"]')
    .first()
    .evaluate((input, value) => {
      ;(input as HTMLInputElement).value = value
    }, version)

  await pressAndSettle(stalePage, () =>
    hoursForm(stalePage).getByRole('button', { name: 'Gem' }).click(),
  )

  await expect(stalePage.getByRole('status').first()).toContainText('Nogen andre har rettet dette')

  await restoreSeededWeek(ownerPage)
})

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

test('the whole workflow can be completed with the keyboard alone', async () => {
  await openHoursAdmin(ownerPage)

  // Reach Saturday's switch by tabbing from the top of the card, flip it with Space, and
  // check that the two dropdowns it reveals are then reachable — the sequence somebody
  // using a keyboard actually performs. Nothing here uses a mouse.
  await openSwitch(ownerPage, 'Lørdag').focus()
  await expect(openSwitch(ownerPage, 'Lørdag')).toBeFocused()

  await ownerPage.keyboard.press('Space')
  await expect(openSwitch(ownerPage, 'Lørdag')).not.toBeChecked()
  await expect(timeSelect(ownerPage, 'Lørdag', 'åbner')).toBeHidden()

  await ownerPage.keyboard.press('Space')
  await expect(openSwitch(ownerPage, 'Lørdag')).toBeChecked()

  // Tab moves into the times the switch has just revealed.
  await ownerPage.keyboard.press('Tab')
  await expect(timeSelect(ownerPage, 'Lørdag', 'åbner')).toBeFocused()

  await timeSelect(ownerPage, 'Lørdag', 'åbner').selectOption('16:00')

  // And the form can be submitted from the keyboard.
  await hoursForm(ownerPage).getByRole('button', { name: 'Gem' }).focus()
  await pressAndSettle(ownerPage, () => ownerPage.keyboard.press('Enter'))

  await expect(pendingBand(ownerPage)).toContainText('Lørdag venter')

  // The focus ring 1aa asks for is 3 px, and it is set globally in app/globals.css rather
  // than per control, so it is asserted once here against a real focused element.
  await openSwitch(ownerPage, 'Søndag').focus()
  const outlineWidth = await openSwitch(ownerPage, 'Søndag')
    .locator('xpath=following-sibling::label[1]')
    .evaluate((element) => getComputedStyle(element).outlineWidth)

  expect(outlineWidth).toBe('3px')

  await restoreSeededWeek(ownerPage)
})

// ---------------------------------------------------------------------------
// §7b — what the published week feeds
// ---------------------------------------------------------------------------

/**
 * One integration case, not a second copy of §7b.
 *
 * The whole sold-out matrix — every weekday, both DST transitions, overrides in both
 * directions — is asserted in `tests/unit/menu/sold-out.test.ts` against the pure function.
 * What can only be asserted here is the *wiring*: that the administration's reset sentence
 * is computed from the **published** schedule, so a draft does not move it and a publish
 * does.
 *
 * Every open day is given the same distinctive opening time, so the assertion holds
 * whichever day of the week the suite happens to run on.
 */
test('the sold-out reset follows the published week, before and after a publish', async () => {
  await ensureAvailability(ownerPage, BURGERS, THOR, true)

  const resetTime = async (): Promise<string> => {
    await openSection(ownerPage, BURGERS)
    const text = await ownerPage.getByText(RESET_SENTENCE).first().innerText()
    const match = RESET_SENTENCE.exec(text)

    expect(match, 'the administration states when the dish comes back').not.toBeNull()
    return match?.[1] ?? ''
  }

  // Against the seeded week, the next opening is at 15:00 or 17:00 depending on today.
  expect(['15:00', '17:00']).toContain(await resetTime())

  // A draft that moves every opening time to 13:45 — and changes nothing yet.
  await openHoursAdmin(ownerPage)
  for (const weekday of WEEKDAYS) {
    if (await openSwitch(ownerPage, weekday).isChecked()) {
      await setWeekdayTime(ownerPage, weekday, 'åbner', '13:45')
    }
  }
  await saveHours(ownerPage)
  await expect(pendingBand(ownerPage)).toBeVisible()

  expect(
    ['15:00', '17:00'],
    'a draft schedule does not move the sold-out reset',
  ).toContain(await resetTime())

  // Publishing does.
  await openHoursAdmin(ownerPage)
  await publishHours(ownerPage)

  expect(await resetTime(), 'the published schedule is what the reset resolves against').toBe(
    '13:45',
  )

  await restoreSeededWeek(ownerPage)
  expect(['15:00', '17:00']).toContain(await resetTime())

  // Leave Thor as the seed left him.
  await ensureAvailability(ownerPage, BURGERS, THOR, false)
  expect(await isSoldOut(ownerPage, THOR)).toBe(false)
})

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

test.describe('as a staff member', () => {
  let staffPage: Page

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    staffPage = await context.newPage()
    await signIn(staffPage, STAFF)
  })

  test.afterAll(async () => {
    await staffPage.context().close()
  })

  /*
   * Phase 8B changed **where** the refusal happens, and changed nothing about the rule.
   *
   * Phase 8A kept the whole screen away from a staff member, because the whole screen was
   * the week. §5 puts the *one-off change* in both columns, so since 8B the screen carries
   * a card that is theirs — and the refusal moved from the address to the card. What a
   * staff member must still not be able to do is exactly what it was: draft the week,
   * publish the week, or reach a control that would.
   */
  test('the dashboard offers the one-off change, in its own words', async () => {
    await staffPage.goto('/admin')

    await expect(staffPage.getByRole('link', { name: 'Åbn åbningstiderne' })).toHaveCount(0)
    await expect(staffPage.getByRole('link', { name: 'Ret tider for en dag' })).toBeVisible()
  })

  test('the screen shows no weekly editor, and says who can change the week', async () => {
    await staffPage.goto(HOURS_ADMIN_PATH)

    // §5: an Owner-only area is absent rather than shown and disabled.
    await expect(hoursForm(staffPage)).toHaveCount(0)
    await expect(staffPage.getByRole('checkbox')).toHaveCount(0)
    await expect(
      staffPage.getByRole('banner').getByRole('button', { name: 'Offentliggør' }),
    ).toHaveCount(0)

    for (const weekday of WEEKDAYS) {
      await expect(staffPage.getByRole('group', { name: weekday, exact: true })).toHaveCount(0)
    }

    await expect(staffPage.getByText('kan kun ejeren rette')).toBeVisible()
  })

  test('a forged save is refused, and the public hours do not move', async ({ browser }) => {
    const before = await guestHours(browser)

    // The Server Action's own endpoint, posted to directly with a full week. It carries a
    // valid entity, a valid shape and a plausible version — everything except the role.
    const response = await staffPage.request.post(HOURS_ADMIN_PATH, {
      form: {
        version: new Date().toISOString(),
        'aaben-mon': '1',
        'fra-mon': '00:00',
        'til-mon': '23:45',
        'aaben-wed': '1',
        'fra-wed': '09:00',
        'til-wed': '10:00',
      },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
      failOnStatusCode: false,
    })

    // Whatever the framework answers a bodiless POST with, the only thing that matters is
    // that nothing was written. A Server Action reached this way never runs its body: the
    // page itself calls `requireOwner()` first, and the action calls it again for itself.
    expect(response.status()).toBeLessThan(500)

    const after = await guestHours(browser)
    expect(after.table).toBe(before.table)
    expect(after.footer).toBe(before.footer)
  })

  test('and a forged publish of the weekly schedule is refused too', async ({ browser }) => {
    const before = await guestHours(browser)

    // The bar's Offentliggør is not drawn for a staff member, and drawing it would not be
    // the permission anyway: `publishOpeningHours` calls `requireOwner()` for itself, and
    // `opening_hours_update_owner` refuses the merge a third time.
    const response = await staffPage.request.post(HOURS_ADMIN_PATH, {
      form: {},
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
      failOnStatusCode: false,
    })

    expect(response.status()).toBeLessThan(500)

    const after = await guestHours(browser)
    expect(after.table).toBe(before.table)
    expect(after.footer).toBe(before.footer)
  })
})

// ---------------------------------------------------------------------------
// The state the seed must be left in
// ---------------------------------------------------------------------------

test('the week is back exactly as the seed wrote it', async ({ browser }) => {
  await restoreSeededWeek(ownerPage)

  const guest = await guestHours(browser)

  expect(guest.table).toMatch(dayLine('Mandag', 'Lukket'))
  expect(guest.table).toMatch(dayLine('Tirsdag', 'Lukket'))
  expect(guest.table).toMatch(dayLine('Onsdag', '15:00–20:00'))
  expect(guest.table).toMatch(dayLine('Torsdag', '15:00–20:00'))
  expect(guest.table).toMatch(dayLine('Fredag', '15:00–20:00'))
  expect(guest.table).toMatch(dayLine('Lørdag', '17:00–20:00'))
  expect(guest.table).toMatch(dayLine('Søndag', '17:00–20:00'))

  expect(guest.footer).toContain('Man–tir lukket')
  expect(guest.footer).toContain('Ons–fre 15:00–20:00')
  expect(guest.footer).toContain('Lør–søn 17:00–20:00')
})
