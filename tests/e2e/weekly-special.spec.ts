import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  availabilityForm,
  chooseWeek,
  copyButton,
  copyDialog,
  copyForm,
  guestWeek,
  isSoldOut,
  openWeeklyAdmin,
  openWeeklyAdminFromMenu,
  pendingBand,
  pressAndSettle,
  pressCopy,
  pressUndo,
  previewWeek,
  publishWeek,
  saturdayForm,
  saturdayToggle,
  saveSaturday,
  saveWeek,
  servingDay,
  setSaturdayChecked,
  setSaturdayEnabled,
  setServingDay,
  toggleAvailability,
  undoStrip,
  weekForm,
  weekSelect,
  weeklyVersion,
  WEEKLY_ADMIN_PATH,
} from './support/weekly-admin'

/**
 * Ugens ret & Lørdagsmenu — design 1ag (the editor), 1af (every public state); phase 6A.
 *
 * The promise this suite exists for: **the week is edited as a draft, and a guest sees
 * nothing until somebody presses Offentliggør** — with exactly two exceptions, both of
 * which 1ag draws as a switch and labels as immediate.
 *
 *     public   Retnavn — oplyses ugentligt        (the seed)
 *     admin    Stegt flæsk med persillesovs       (after Gem)
 *     public   Retnavn — oplyses ugentligt        (still)
 *     preview  Stegt flæsk med persillesovs
 *     public   Stegt flæsk med persillesovs       (after Offentliggør)
 *
 * It runs in order and shares one signed-in page, because it is one story. The last
 * scenario puts the seeded week back and publishes it, so an interrupted run leaves the
 * next one unaffected and the database ends where the seed left it.
 */

test.describe.configure({ mode: 'serial' })

/** The seeded week, exactly as `supabase/seed.sql` writes it. */
const SEEDED = {
  name: 'Retnavn — oplyses ugentligt',
  description: 'Beskrivelsen skrives af køkkenet hver uge i administrationen.',
  days: ['onsdag', 'torsdag', 'fredag'],
} as const

const NO_SATURDAY = 'Ingen lørdagsmenu denne uge'

let staffPage: Page

/** The week the row is on when the suite starts. Everything is restored to it. */
let seededWeekToken = ''

test.beforeAll(async ({ browser }) => {
  // An explicit context, as in the other write suites: `@axe-core/playwright` refuses a
  // page that was opened straight from the browser.
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  await openWeeklyAdmin(staffPage)
  seededWeekToken = await weekSelect(staffPage).inputValue()
})

test.afterAll(async () => {
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// Getting there, and what is on the screen
// ---------------------------------------------------------------------------

test('the menu screen’s Ugens ret chip leads to the editor', async () => {
  await openWeeklyAdminFromMenu(staffPage)

  expect(staffPage.url()).toContain(WEEKLY_ADMIN_PATH)
  await expect(staffPage.getByRole('heading', { level: 1, name: 'Ugens ret' })).toBeVisible()
  // Back to where they came from, as the frame's "‹ Rediger menu" promises.
  await expect(staffPage.getByRole('link', { name: 'Rediger menu' })).toBeVisible()
})

test('both parts of the week are on the one screen, as 1ag draws them', async () => {
  await openWeeklyAdmin(staffPage)

  await expect(weekForm(staffPage)).toBeVisible()
  await expect(saturdayForm(staffPage)).toBeVisible()

  // The frame's own fields, and no others.
  for (const label of ['Ugenummer', 'Retnavn', 'Beskrivelse', 'Lille portion (kr.)', 'Stor portion (kr.)']) {
    await expect(weekForm(staffPage).getByLabel(label, { exact: true })).toBeVisible()
  }

  for (const label of ['Retnavn', 'Beskrivelse', 'Pris (kr.)', 'Bestillingsfrist (valgfrit)']) {
    await expect(saturdayForm(staffPage).getByLabel(label, { exact: true })).toBeVisible()
  }

  // 1ag's standing note about the section, present and not a field.
  await expect(
    staffPage.getByText(/Alle ugens retter kan også laves glutenfrie og laktosefrie/),
  ).toBeVisible()
  await expect(
    staffPage.getByLabel(/glutenfrie/, { exact: false }),
  ).toHaveCount(0)
})

test('the image slot offers exactly a selection — never storage metadata (10C-1)', async () => {
  await openWeeklyAdmin(staffPage)

  // The 10C-1 slot: an empty library and no selection draw the dashed frame with
  // 1ag's own control. It is a link — opening the picker is a navigation.
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toBeVisible()

  const names = await staffPage
    .locator('main input, main select, main textarea')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('name')))

  // With nothing selected there is no removal form, so no image field is on the
  // page at all — and no field for a path, a MIME type or a dimension ever is
  // (the picker's whole vocabulary is `version` + `billede`, policy-tested).
  expect(names).not.toContain('billede')
  expect(names).not.toContain('image_id')
  expect(names).not.toContain('storage_path')
  // Nor is there any way to submit a sold-out date: §7b's "today, in Copenhagen" is the
  // server's to decide.
  expect(names).not.toContain('sold_out_on')
  expect(names).not.toContain('udsolgt_dato')
})

test('the seeded week is what the editor shows and what a guest reads', async ({ browser }) => {
  await openWeeklyAdmin(staffPage)

  await expect(weekForm(staffPage).getByLabel('Retnavn', { exact: true })).toHaveValue(SEEDED.name)

  for (const day of SEEDED.days) {
    await expect(servingDay(staffPage, day)).toBeChecked()
  }

  const guest = await guestWeek(browser)
  expect(guest.heading).toBe(SEEDED.name)
  expect(guest.saturday).toContain(NO_SATURDAY)
})

// ---------------------------------------------------------------------------
// Ugens ret — edit, Kladde, public unchanged, preview, publish
// ---------------------------------------------------------------------------

test('editing Ugens ret is a draft: Kladde, and the hjemmeside untouched', async ({
  browser,
}) => {
  await openWeeklyAdmin(staffPage)

  await saveWeek(staffPage, {
    Retnavn: 'Stegt flæsk',
    Beskrivelse: 'Med persillesovs og nye kartofler.',
    'Lille portion (kr.)': '89',
    'Stor portion (kr.)': '119',
  })

  await expect(staffPage.getByText(/gemt som kladde/)).toBeVisible()
  await expect(weekForm(staffPage).getByText('Kladde')).toBeVisible()
  await expect(pendingBand(staffPage)).toContainText('Ugens ret har ændringer')

  const guest = await guestWeek(browser)
  expect(guest.heading).toBe(SEEDED.name)
})

test('Forhåndsvis shows the draft before anybody has published it', async () => {
  const preview = await previewWeek(staffPage)

  expect(preview).toContain('Stegt flæsk')
  expect(preview).toContain('89 kr.')
  expect(preview).toContain('119 kr.')
})

test('Offentliggør puts it live, through phase 4 and nothing else', async ({ browser }) => {
  await publishWeek(staffPage)

  await expect(staffPage.getByText('Ugens ret er opdateret på hjemmesiden.')).toBeVisible()
  await expect(pendingBand(staffPage)).toHaveCount(0)

  const guest = await guestWeek(browser)
  expect(guest.heading).toBe('Stegt flæsk')
  expect(guest.saturday).toContain(NO_SATURDAY)
})

// ---------------------------------------------------------------------------
// Lørdagsmenu — configured, and the "no menu" state
// ---------------------------------------------------------------------------

test('a Saturday menu is configured as a draft and published separately', async ({
  browser,
}) => {
  await openWeeklyAdmin(staffPage)

  await setSaturdayChecked(staffPage, true)
  await saveSaturday(staffPage, {
    Retnavn: 'Helstegt pattegris',
    Beskrivelse: 'Til deling, med tilbehør.',
    'Pris (kr.)': '199',
    'Bestillingsfrist (valgfrit)': 'Bestilling senest fredag kl. 12:00',
  })

  await expect(pendingBand(staffPage)).toContainText('Lørdagsmenuen har ændringer')

  // Still no Saturday menu for a guest.
  expect((await guestWeek(browser)).saturday).toContain(NO_SATURDAY)

  const preview = await previewWeek(staffPage)
  expect(preview).toContain('Helstegt pattegris')
  expect(preview).not.toContain(NO_SATURDAY)

  await publishWeek(staffPage)

  const guest = await guestWeek(browser)
  expect(guest.saturday).toContain('Helstegt pattegris')
  expect(guest.saturday).toContain('199 kr.')
  expect(guest.saturday).toContain('Bestilling senest fredag kl. 12:00')
})

test('turning the Saturday menu off is a draft, and keeps every word', async ({ browser }) => {
  await openWeeklyAdmin(staffPage)
  await setSaturdayEnabled(staffPage, false)

  // The text is kept — 1ag's own promise, "Teksten bevares til næste gang".
  await expect(saturdayForm(staffPage).getByLabel('Retnavn', { exact: true })).toHaveValue(
    'Helstegt pattegris',
  )
  await expect(saturdayForm(staffPage).getByText(NO_SATURDAY)).toBeVisible()

  // A draft, not an immediate change: the guest still has a Saturday menu.
  expect((await guestWeek(browser)).saturday).toContain('Helstegt pattegris')

  const preview = await previewWeek(staffPage)
  expect(preview).toContain(NO_SATURDAY)

  await publishWeek(staffPage)

  const guest = await guestWeek(browser)
  expect(guest.saturday).toContain(NO_SATURDAY)
  expect(guest.saturday).not.toContain('Helstegt pattegris')
})

test('turning it back on restores the kept text in one press', async ({ browser }) => {
  await openWeeklyAdmin(staffPage)
  await setSaturdayEnabled(staffPage, true)
  await publishWeek(staffPage)

  expect((await guestWeek(browser)).saturday).toContain('Helstegt pattegris')

  // …and off again, for the scenarios that follow.
  await openWeeklyAdmin(staffPage)
  await setSaturdayEnabled(staffPage, false)
  await publishWeek(staffPage)
})

// ---------------------------------------------------------------------------
// Draft integrity — the property this screen most easily breaks
// ---------------------------------------------------------------------------

test('a pending Ugens ret price survives a Lørdagsmenu edit, and the reverse', async () => {
  await openWeeklyAdmin(staffPage)

  await saveWeek(staffPage, { 'Lille portion (kr.)': '95' })
  await expect(pendingBand(staffPage)).toContainText('Ugens ret har ændringer')

  await setSaturdayEnabled(staffPage, true)

  // Both are pending, and the price is still the one that was typed.
  await expect(pendingBand(staffPage)).toContainText('Ugens ret har ændringer')
  await expect(pendingBand(staffPage)).toContainText('Lørdagsmenuen har ændringer')
  await expect(weekForm(staffPage).getByLabel('Lille portion (kr.)', { exact: true })).toHaveValue(
    '95',
  )

  // And the other direction: an Ugens ret save after a Saturday one.
  await saveWeek(staffPage, { Beskrivelse: 'Med persillesovs, nye kartofler og rødbeder.' })

  await expect(saturdayToggle(staffPage)).toBeChecked()
  await expect(pendingBand(staffPage)).toContainText('Lørdagsmenuen har ændringer')

  // Put both back where the previous scenarios left them.
  await saveWeek(staffPage, {
    'Lille portion (kr.)': '89',
    Beskrivelse: 'Med persillesovs og nye kartofler.',
  })
  await setSaturdayEnabled(staffPage, false)

  await expect(pendingBand(staffPage)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// The week rollover (§7e item 5)
// ---------------------------------------------------------------------------

test('changing the week number starts a blank form, as a draft', async ({ browser }) => {
  await openWeeklyAdmin(staffPage)

  const options = await weekSelect(staffPage).evaluate((node) =>
    [...(node as HTMLSelectElement).options].map((option) => option.value),
  )
  const current = await weekSelect(staffPage).inputValue()
  const next = options[options.indexOf(current) + 1] ?? ''
  expect(next).not.toBe('')

  await chooseWeek(staffPage, next)

  await expect(staffPage.getByText(/Du er begyndt på en ny uge/)).toBeVisible()
  await expect(weekForm(staffPage).getByLabel('Retnavn', { exact: true })).toHaveValue('')
  await expect(weekForm(staffPage).getByLabel('Lille portion (kr.)', { exact: true })).toHaveValue('')

  // The serving days are the pattern, not the content — they are carried across.
  for (const day of SEEDED.days) {
    await expect(servingDay(staffPage, day)).toBeChecked()
  }

  // And the Saturday card is untouched: it has its own on/off state and its own promise.
  await expect(saturdayForm(staffPage).getByLabel('Retnavn', { exact: true })).toHaveValue(
    'Helstegt pattegris',
  )

  // The hjemmeside keeps the published week, including its number.
  const guest = await guestWeek(browser)
  expect(guest.heading).toBe('Stegt flæsk')
})

test('choosing the published week again restores the published dish', async () => {
  await openWeeklyAdmin(staffPage)
  await chooseWeek(staffPage, seededWeekToken)

  await expect(staffPage.getByText(/Du er tilbage på den uge/)).toBeVisible()
  await expect(weekForm(staffPage).getByLabel('Retnavn', { exact: true })).toHaveValue('Stegt flæsk')
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// The immediate path (§6, §7b)
// ---------------------------------------------------------------------------

test('Udsolgt on Ugens ret is immediate, and Fortryd puts it back', async ({ browser }) => {
  await openWeeklyAdmin(staffPage)
  expect(await isSoldOut(staffPage, 'Ugens ret')).toBe(false)

  await toggleAvailability(staffPage, 'Ugens ret')

  expect(await isSoldOut(staffPage, 'Ugens ret')).toBe(true)
  await expect(undoStrip(staffPage)).toContainText('Ugens ret er nu markeret som udsolgt')
  // §7b's computed reset sentence, not a stored expiry.
  await expect(availabilityForm(staffPage, 'Ugens ret')).toContainText(/Nulstilles/)

  // No draft was created: this is not a pending change.
  await expect(pendingBand(staffPage)).toHaveCount(0)

  /*
   * 1aa: *"De stjæler aldrig tastaturfokus."* The strip is `role="status"`, so it is
   * announced politely and nothing in it is focused — the Fortryd button has to be
   * tabbed to like any other control. The assertion is "focus is not *inside* the
   * strip" rather than "focus is still on the switch": the action answers with a
   * redirect, and a full navigation resets focus to the document by the platform's own
   * rules. That is the browser, not this strip. The monthly screen asserts the same
   * property of the same component, so the two halves of phase 6 are held to one bar.
   */
  const focusInsideStrip = await undoStrip(staffPage).evaluate((node) =>
    node.contains(document.activeElement),
  )
  expect(focusInsideStrip).toBe(false)

  const guest = await guestWeek(browser)
  expect(guest.soldOut).toBe(true)
  expect(guest.heading).toBe('Stegt flæsk')

  await pressUndo(staffPage)

  expect(await isSoldOut(staffPage, 'Ugens ret')).toBe(false)
  expect((await guestWeek(browser)).soldOut).toBe(false)
})

test('the Saturday menu has its own Udsolgt, independent of the weekly dish', async () => {
  await openWeeklyAdmin(staffPage)
  await setSaturdayEnabled(staffPage, true)
  await publishWeek(staffPage)
  await openWeeklyAdmin(staffPage)

  await toggleAvailability(staffPage, 'Lørdagsmenuen')

  expect(await isSoldOut(staffPage, 'Lørdagsmenuen')).toBe(true)
  // The weekly dish was not touched. One named column moved.
  expect(await isSoldOut(staffPage, 'Ugens ret')).toBe(false)
  await expect(undoStrip(staffPage)).toContainText('Lørdagsmenuen er nu markeret som udsolgt')

  await pressUndo(staffPage)
  expect(await isSoldOut(staffPage, 'Lørdagsmenuen')).toBe(false)

  await setSaturdayEnabled(staffPage, false)
  await publishWeek(staffPage)
})

// ---------------------------------------------------------------------------
// "Kopiér sidste uge" (§6, decision 4)
// ---------------------------------------------------------------------------

test('Kopiér sidste uge seeds a draft and publishes nothing', async ({ browser }) => {
  await openWeeklyAdmin(staffPage)
  await expect(copyButton(staffPage)).toBeEnabled()

  const before = await guestWeek(browser)
  const currentWeek = await weekSelect(staffPage).inputValue()

  await pressCopy(staffPage)

  await expect(staffPage.getByText(/Sidste uge er hentet ind som kladde/)).toBeVisible()
  await expect(pendingBand(staffPage)).toContainText('Ugens ret har ændringer')

  // The copy landed in the *next* week, with the live content in it.
  const copiedWeek = await weekSelect(staffPage).inputValue()
  expect(copiedWeek).not.toBe(currentWeek)
  await expect(weekForm(staffPage).getByLabel('Retnavn', { exact: true })).toHaveValue('Stegt flæsk')

  // Nothing a guest can see has moved — not the dish, and not the week number.
  const after = await guestWeek(browser)
  expect(after.heading).toBe(before.heading)
  expect(after.week).toBe(before.week)
})

test('a second copy asks before it overwrites the draft that is there', async () => {
  await openWeeklyAdmin(staffPage)

  // Something the person typed, which the copy would replace.
  await saveWeek(staffPage, { Retnavn: 'Noget jeg selv skrev' })

  await pressCopy(staffPage)

  await expect(copyDialog(staffPage)).toBeVisible()
  await expect(copyDialog(staffPage)).toContainText('Dette overskriver din nuværende kladde')
  // Nothing has happened yet.
  await expect(weekForm(staffPage).getByLabel('Retnavn', { exact: true })).toHaveValue(
    'Noget jeg selv skrev',
  )

  // The safe choice is focused, and cancelling changes nothing.
  await expect(copyDialog(staffPage).getByRole('link', { name: 'Behold min kladde' })).toBeFocused()
  await copyDialog(staffPage).getByRole('link', { name: 'Behold min kladde' }).click()
  await expect(copyDialog(staffPage)).toHaveCount(0)
  await expect(weekForm(staffPage).getByLabel('Retnavn', { exact: true })).toHaveValue(
    'Noget jeg selv skrev',
  )

  // Confirming replaces it with the live week.
  await pressCopy(staffPage)
  await copyDialog(staffPage).getByRole('button', { name: 'Kopiér alligevel' }).click()
  await staffPage.waitForURL(/ugens-ret\?.*status=/)

  await expect(weekForm(staffPage).getByLabel('Retnavn', { exact: true })).toHaveValue('Stegt flæsk')
})

test('the copied week goes live only when somebody presses Offentliggør', async ({
  browser,
}) => {
  const copiedWeek = await weekSelect(staffPage).inputValue()

  const preview = await previewWeek(staffPage)
  expect(preview).toContain('Stegt flæsk')

  await publishWeek(staffPage)

  const guest = await guestWeek(browser)
  expect(guest.heading).toBe('Stegt flæsk')
  expect(guest.week).toBe(`Uge ${String(Number(copiedWeek.slice(-2)))}`)
})

test('the copy is unavailable when there is nothing on the hjemmeside to copy', async () => {
  await openWeeklyAdmin(staffPage)

  // Empty the published week, the way a person would: clear the fields and publish.
  await saveWeek(staffPage, { Retnavn: '', Beskrivelse: '', 'Lille portion (kr.)': '', 'Stor portion (kr.)': '' })
  await publishWeek(staffPage)
  await openWeeklyAdmin(staffPage)

  await expect(copyButton(staffPage)).toBeDisabled()
  await expect(copyForm(staffPage)).toContainText('ikke noget på hjemmesiden at kopiere')

  // Put the dish back for the remaining scenarios.
  await saveWeek(staffPage, {
    Retnavn: 'Stegt flæsk',
    Beskrivelse: 'Med persillesovs og nye kartofler.',
    'Lille portion (kr.)': '89',
    'Stor portion (kr.)': '119',
  })
  await publishWeek(staffPage)
})

// ---------------------------------------------------------------------------
// Refusals — validation, concurrency, permission
// ---------------------------------------------------------------------------

test('a bad price is refused beneath its own field, and nothing is saved', async () => {
  await openWeeklyAdmin(staffPage)

  await saveWeek(staffPage, { 'Lille portion (kr.)': 'nioghalvfems' })

  const field = weekForm(staffPage).getByLabel('Lille portion (kr.)', { exact: true })
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(weekForm(staffPage)).toContainText('Prisen skal være et tal')
  // What was typed is still there to correct.
  await expect(field).toHaveValue('nioghalvfems')
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

test('a Saturday menu switched on without a name is refused', async () => {
  await openWeeklyAdmin(staffPage)

  await setSaturdayChecked(staffPage, true)
  await saturdayForm(staffPage).getByLabel('Retnavn', { exact: true }).fill('')
  await pressAndSettle(staffPage, () =>
    saturdayForm(staffPage).getByRole('button', { name: 'Gem' }).click(),
  )

  await expect(saturdayForm(staffPage)).toContainText(
    'Lørdagsmenuen skal have et navn, når den er slået til.',
  )
  await expect(pendingBand(staffPage)).toHaveCount(0)
})

test('a save from a stale version is refused rather than overwriting a colleague', async () => {
  // Two tabs on the same row. The second one is opened *first*, so it is holding the
  // version token from before the other person's save — which is exactly the situation
  // §7e item 2 is about, and the one a reload would quietly repair.
  const other = await staffPage.context().newPage()
  await other.goto(WEEKLY_ADMIN_PATH)
  await expect(weekForm(other)).toBeVisible()
  const staleVersion = await weeklyVersion(other)

  await openWeeklyAdmin(staffPage)
  await saveWeek(staffPage, { Beskrivelse: 'Rettet af en kollega.' })
  expect(await weeklyVersion(staffPage)).not.toBe(staleVersion)

  await weekForm(other).getByLabel('Beskrivelse', { exact: true }).fill('Rettet af mig')
  await weekForm(other).getByRole('button', { name: 'Gem' }).click()
  await other.waitForURL(/ugens-ret\?.*status=/)

  await expect(other.getByText('Nogen andre har rettet dette.')).toBeVisible()
  await other.close()

  // The colleague's text stands; nothing was silently overwritten.
  await openWeeklyAdmin(staffPage)
  await expect(weekForm(staffPage).getByLabel('Beskrivelse', { exact: true })).toHaveValue(
    'Rettet af en kollega.',
  )

  await saveWeek(staffPage, { Beskrivelse: 'Med persillesovs og nye kartofler.' })
  await publishWeek(staffPage)
})

test('an Owner can do everything Staff can', async ({ browser }) => {
  const context = await browser.newContext()
  const ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)

  await openWeeklyAdmin(ownerPage)
  await saveWeek(ownerPage, { Beskrivelse: 'Rettet af ejeren.' })
  await expect(pendingBand(ownerPage)).toContainText('Ugens ret har ændringer')

  await toggleAvailability(ownerPage, 'Ugens ret')
  expect(await isSoldOut(ownerPage, 'Ugens ret')).toBe(true)
  await pressUndo(ownerPage)

  await publishWeek(ownerPage)
  expect((await guestWeek(browser)).heading).toBe('Stegt flæsk')

  await context.close()

  await openWeeklyAdmin(staffPage)
  await saveWeek(staffPage, { Beskrivelse: 'Med persillesovs og nye kartofler.' })
  await publishWeek(staffPage)
})

test('an anonymous visitor cannot reach the editor at all', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(WEEKLY_ADMIN_PATH)
  await expect(page).toHaveURL(/\/admin\/login/)

  // …and the Server Actions are not a way round it. A POST with no session is refused
  // before it reaches a rule.
  const response = await page.request.post(WEEKLY_ADMIN_PATH, {
    form: { del: 'week', udsolgt: '1', version: new Date().toISOString() },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0,
    failOnStatusCode: false,
  })

  expect(response.status()).toBeGreaterThanOrEqual(300)

  // The hjemmeside is untouched by the attempt.
  const guest = await guestWeek(browser)
  expect(guest.soldOut).toBe(false)

  await context.close()
})

// ---------------------------------------------------------------------------
// Keyboard, accessibility and layout
// ---------------------------------------------------------------------------

test('the whole editor is reachable and operable from the keyboard', async () => {
  await openWeeklyAdmin(staffPage)

  const reached: string[] = []

  for (let step = 0; step < 60; step += 1) {
    await staffPage.keyboard.press('Tab')

    // Tag, form-field name and visible text, so a field and a button are both
    // identifiable by whichever of the two they actually have.
    const focused = await staffPage.evaluate(() => {
      const node = document.activeElement as HTMLElement | null
      if (node === null) return null

      const name = node.getAttribute('name') ?? ''
      const text = (node.innerText ?? '').trim().slice(0, 30)

      return `${node.tagName.toLowerCase()}|${name}|${text}`
    })

    if (focused !== null) reached.push(focused)
  }

  // Every control the screen offers is in the tab order, without a single tabindex.
  for (const field of ['|uge|', '|dag|', '|navn|', '|pris_lille|', '|loerdag_til|', '|loerdag_navn|']) {
    expect(reached.some((entry) => entry.includes(field)), `${field} is reachable`).toBe(true)
  }

  expect(reached.some((entry) => entry.endsWith('|Gem'))).toBe(true)
  // The immediate control and the copy are in it too — nothing is mouse-only.
  expect(reached.some((entry) => entry.includes('Kopiér sidste uge'))).toBe(true)
})

test('a serving day can be toggled with the keyboard alone', async () => {
  await openWeeklyAdmin(staffPage)

  const monday = servingDay(staffPage, 'mandag')
  await monday.focus()
  await staffPage.keyboard.press('Space')
  await expect(monday).toBeChecked()

  await staffPage.keyboard.press('Space')
  await expect(monday).not.toBeChecked()
})

test('the editor has no accessibility violations', async () => {
  await openWeeklyAdmin(staffPage)

  const results = await new AxeBuilder({ page: staffPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(results.violations.map((violation) => violation.id)).toEqual([])
})

test('the refusal state has no accessibility violations either', async () => {
  await openWeeklyAdmin(staffPage)
  await saveWeek(staffPage, { 'Stor portion (kr.)': 'meget' })

  const results = await new AxeBuilder({ page: staffPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(results.violations.map((violation) => violation.id)).toEqual([])

  await openWeeklyAdmin(staffPage)
})

test('the copy confirmation has no accessibility violations', async () => {
  await openWeeklyAdmin(staffPage)
  await saveWeek(staffPage, { Beskrivelse: 'Noget der venter.' })
  await pressCopy(staffPage)
  await expect(copyDialog(staffPage)).toBeVisible()

  const results = await new AxeBuilder({ page: staffPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(results.violations.map((violation) => violation.id)).toEqual([])

  await copyDialog(staffPage).getByRole('link', { name: 'Behold min kladde' }).click()
  await expect(copyDialog(staffPage)).toHaveCount(0)
})

test('every control a person presses is at least 44 px, at this width', async () => {
  await openWeeklyAdmin(staffPage)

  const small = await staffPage
    .locator('main button, main a[href], main select')
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

test('the editor does not make the screen scroll sideways', async () => {
  await openWeeklyAdmin(staffPage)

  const overflow = await staffPage.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
  }))

  expect(overflow.body).toBeLessThanOrEqual(overflow.client)
})

// ---------------------------------------------------------------------------
// Leaving the seed as it was found
// ---------------------------------------------------------------------------

test('the week is back to its seeded content, live, with nothing pending', async ({
  browser,
}) => {
  await openWeeklyAdmin(staffPage)

  await chooseWeek(staffPage, seededWeekToken)
  await saveWeek(staffPage, {
    Retnavn: SEEDED.name,
    Beskrivelse: SEEDED.description,
    'Lille portion (kr.)': '',
    'Stor portion (kr.)': '',
  })

  for (const day of SEEDED.days) await setServingDay(staffPage, day, true)
  for (const day of ['mandag', 'tirsdag', 'lørdag', 'søndag']) {
    await setServingDay(staffPage, day, false)
  }
  await pressAndSettle(staffPage, () =>
    weekForm(staffPage).getByRole('button', { name: 'Gem' }).click(),
  )

  await setSaturdayChecked(staffPage, false)
  await saveSaturday(staffPage, {
    Retnavn: '',
    Beskrivelse: '',
    'Pris (kr.)': '',
    'Bestillingsfrist (valgfrit)': '',
  })

  await publishWeek(staffPage)

  await openWeeklyAdmin(staffPage)
  await expect(pendingBand(staffPage)).toHaveCount(0)

  const guest = await guestWeek(browser)
  expect(guest.heading).toBe(SEEDED.name)
  expect(guest.week).toBe(`Uge ${String(Number(seededWeekToken.slice(-2)))}`)
  expect(guest.saturday).toContain(NO_SATURDAY)
  expect(guest.soldOut).toBe(false)
})
