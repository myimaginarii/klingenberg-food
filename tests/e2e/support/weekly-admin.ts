import { expect, type Browser, type Page } from '@playwright/test'

import { waitForPublicShell } from './public-shell'

/**
 * Driving Ugens ret & Lørdagsmenu, for the browser tests — design 1ag.
 *
 * Everything on that screen is a link or a form, so these helpers do what a person
 * does: follow a link, fill fields, press a button, wait for the redirect the Server
 * Action performs. No selector here reaches for a class name or a test id — the screen
 * is addressed the way a screen reader addresses it, which is also the surest way for
 * these tests to catch an accessibility regression.
 */

export const WEEKLY_ADMIN_PATH = '/admin/menu/ugens-ret'

/** The two cards, by their own accessible names. */
export function weekForm(page: Page) {
  return page.getByRole('form', { name: 'Ugens ret', exact: true })
}

export function saturdayForm(page: Page) {
  return page.getByRole('form', { name: 'Lørdagsmenu denne uge', exact: true })
}

export async function openWeeklyAdmin(page: Page): Promise<void> {
  await page.goto(WEEKLY_ADMIN_PATH)
  await expect(weekForm(page)).toBeVisible()
}

/**
 * Reach the editor the way a person does — from the menu screen's Ugens ret chip.
 *
 * Its own helper rather than a `goto`, because "the chip leads to the editor" is one of
 * phase 6A's requirements, and a test that navigated by address would not be testing it.
 */
export async function openWeeklyAdminFromMenu(page: Page): Promise<void> {
  await page.goto('/admin/menu')
  await page
    .getByRole('navigation', { name: 'Menuens sektioner' })
    .getByRole('link', { name: /^Ugens ret/ })
    .click()

  await page.getByRole('link', { name: /^Rediger Ugens ret/ }).click()
  await expect(weekForm(page)).toBeVisible()
}

/**
 * The version token the screen currently carries.
 *
 * The row's `updated_at`, re-rendered by the server after every write. It is the one
 * signal that distinguishes "the server has answered" from "the browser still shows what
 * I typed" — see `pressAndSettle`, and the note in `menu-admin.ts` about why waiting for
 * the address is not enough on a screen whose saves redirect to the same place.
 */
export async function weeklyVersion(page: Page): Promise<string> {
  return page.locator('input[name="version"]').first().inputValue()
}

/**
 * Press a control and wait until the server has actually answered.
 *
 * Two things can end the wait: a new version token, or a refusal in the address. Waiting
 * for the fields would not work — a field already holds what was just typed into it, so
 * a poll on the values would pass against the page the click was made on, and the next
 * press would submit a stale token and be refused as a conflict.
 */
export async function pressAndSettle(page: Page, press: () => Promise<void>): Promise<void> {
  const version = await weeklyVersion(page)
  const address = page.url()

  await press()

  await expect
    .poll(
      async () => {
        try {
          // A write always moves `updated_at`, so a new token is the answer to a save
          // that succeeded.
          if ((await weeklyVersion(page)) !== version) return true
        } catch {
          // Mid-navigation: the fields have gone. Poll again.
          return false
        }

        // A refusal writes nothing, so the token does not move and only the address
        // changes. The address must have *changed*: this screen already carries a
        // `status=` from the press before this one, and checking for one without
        // comparing would resolve instantly against the page the click was made on —
        // whereupon the next press would submit a stale token and be refused.
        return page.url() !== address && /[?&](status|fejl)=/.test(page.url())
      },
      { message: 'the press never reached the server' },
    )
    .toBe(true)
}

/** Fill the Ugens ret card and press Gem. */
export async function saveWeek(
  page: Page,
  fields: Partial<Record<'Retnavn' | 'Beskrivelse' | 'Lille portion (kr.)' | 'Stor portion (kr.)', string>>,
): Promise<void> {
  const form = weekForm(page)

  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value)
  }

  await pressAndSettle(page, () => form.getByRole('button', { name: 'Gem' }).click())
}

/** Fill the Lørdagsmenu card and press Gem. */
export async function saveSaturday(
  page: Page,
  fields: Partial<
    Record<'Retnavn' | 'Beskrivelse' | 'Pris (kr.)' | 'Bestillingsfrist (valgfrit)', string>
  >,
): Promise<void> {
  const form = saturdayForm(page)

  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value)
  }

  await pressAndSettle(page, () => form.getByRole('button', { name: 'Gem' }).click())
}

/**
 * The Saturday menu's on/off control, by the name a screen reader hears.
 *
 * The `<input>` itself is visually hidden and the switch a person sees is drawn by its
 * sibling — the same shape `LabelFields` uses for the dish label chips. So this is the
 * locator for *asserting* the state (and for asserting the accessible name, which is the
 * point of addressing it this way), and {@link setSaturdayChecked} is the one for
 * changing it: pressing the hidden input is not something a person can do.
 */
export function saturdayToggle(page: Page) {
  return saturdayForm(page).getByRole('checkbox', { name: 'Der er lørdagsmenu denne uge' })
}

/** Flip the switch the way a person does — by pressing the words beside it. */
export async function setSaturdayChecked(page: Page, enabled: boolean): Promise<void> {
  if ((await saturdayToggle(page).isChecked()) === enabled) return

  await saturdayForm(page).getByText('Der er lørdagsmenu denne uge').click()
  await expect(saturdayToggle(page)).toBeChecked({ checked: enabled })
}

/** Put the Saturday menu on or off and save. A draft change, like every field beside it. */
export async function setSaturdayEnabled(page: Page, enabled: boolean): Promise<void> {
  await setSaturdayChecked(page, enabled)

  await pressAndSettle(page, () =>
    saturdayForm(page).getByRole('button', { name: 'Gem' }).click(),
  )
}

/** The week dropdown, and the token it currently holds. */
export function weekSelect(page: Page) {
  return weekForm(page).getByLabel('Ugenummer', { exact: true })
}

/** Choose a week by its `2026-W36` token and save. */
export async function chooseWeek(page: Page, token: string): Promise<void> {
  await weekSelect(page).selectOption(token)
  await pressAndSettle(page, () => weekForm(page).getByRole('button', { name: 'Gem' }).click())
}

/**
 * The schedule keys behind the seven boxes, by the Danish name a screen reader hears.
 *
 * The boxes are drawn from `WEEKDAY_KEYS`, so this is the same vocabulary read the other
 * way round — needed because a box is *asserted* by its accessible name and *pressed* by
 * its label, and the label is found through the input's value.
 */
const WEEKDAY_KEY_BY_NAME: Record<string, string> = {
  mandag: 'mon',
  tirsdag: 'tue',
  onsdag: 'wed',
  torsdag: 'thu',
  fredag: 'fri',
  lørdag: 'sat',
  søndag: 'sun',
}

/** One serving-day box, by the weekday a screen reader hears. */
export function servingDay(page: Page, weekday: string) {
  return weekForm(page).getByRole('checkbox', { name: weekday, exact: true })
}

/**
 * Press one serving-day box the way a person does — on the box, not on the hidden input.
 *
 * The `<input>` is `sr-only` and the visible box is its sibling, so a click aimed at the
 * input is intercepted. Clicking the `<label>` is both what a person does and what makes
 * the assertion meaningful.
 */
export async function setServingDay(
  page: Page,
  weekday: string,
  on: boolean,
): Promise<void> {
  if ((await servingDay(page, weekday).isChecked()) === on) return

  const key = WEEKDAY_KEY_BY_NAME[weekday]
  await weekForm(page).locator(`label:has(input[value="${key ?? ''}"])`).click()
  await expect(servingDay(page, weekday)).toBeChecked({ checked: on })
}

/** The availability control on one of the two cards. */
export function availabilityForm(page: Page, card: 'Ugens ret' | 'Lørdagsmenuen') {
  return page.getByRole('form', { name: `Tilgængelighed — ${card}` })
}

/** Is this card currently sold out, as the administration reads it right now? */
export async function isSoldOut(
  page: Page,
  card: 'Ugens ret' | 'Lørdagsmenuen',
): Promise<boolean> {
  return availabilityForm(page, card).getByText('Udsolgt i dag').isVisible()
}

/** Press a card's Udsolgt switch. `card` names it; the press flips whatever it is now. */
export async function toggleAvailability(
  page: Page,
  card: 'Ugens ret' | 'Lørdagsmenuen',
): Promise<void> {
  await pressAndSettle(page, () =>
    availabilityForm(page, card)
      .getByRole('button', { name: new RegExp(`— ${card}\\.`) })
      .click(),
  )
}

/** The green Fortryd strip an immediate availability change leaves behind (1aa). */
export function undoStrip(page: Page) {
  return page.getByRole('status').filter({ has: page.getByRole('button', { name: /^Fortryd/ }) })
}

export async function pressUndo(page: Page): Promise<void> {
  await pressAndSettle(page, () =>
    undoStrip(page).getByRole('button', { name: /^Fortryd/ }).click(),
  )
}

/** "Kopiér sidste uge" and its confirmation. */
export function copyForm(page: Page) {
  return page.getByRole('form', { name: 'Kopiér sidste uge' })
}

export function copyButton(page: Page) {
  return copyForm(page).getByRole('button', { name: 'Kopiér sidste uge' })
}

export function copyDialog(page: Page) {
  return page.getByRole('dialog')
}

/**
 * Press Kopiér sidste uge.
 *
 * The wait names something only an answer carries, because the confirmation and the
 * success both come back to a `/admin/menu/ugens-ret?…` address.
 */
export async function pressCopy(page: Page): Promise<void> {
  await copyButton(page).click()
  await page.waitForURL(/ugens-ret\?.*(status=|kopier=)/)
}

/** The screen's own Offentliggør, scoped to the burgundy bar. */
export async function publishWeek(page: Page): Promise<void> {
  await page.goto(WEEKLY_ADMIN_PATH)
  await page.getByRole('banner').getByRole('button', { name: 'Offentliggør' }).click()
  await page.waitForURL(/ugens-ret\?.*status=/)
}

/** The pending band, which names which of the two cards is waiting (§11). */
export function pendingBand(page: Page) {
  return page
    .getByRole('status')
    .filter({ hasText: /venter på at blive offentliggjort/ })
}

// ---------------------------------------------------------------------------
// The guest's view
// ---------------------------------------------------------------------------

/**
 * What a guest reads in the Ugens ret section, in a fresh anonymous context.
 *
 * Its own browser context, with no admin cookie, because "the public site is unchanged"
 * is a claim about a visitor rather than about a logged-in staff member — and Draft Mode
 * lives in a cookie, so an assertion made on the staff page could be reading a preview.
 */
export type GuestWeek = {
  readonly heading: string | null
  readonly week: string | null
  readonly saturday: string
  readonly soldOut: boolean
  readonly saturdaySoldOut: boolean
}

export async function guestWeek(browser: Browser): Promise<GuestWeek> {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('/menu')
  // `count()` below answers immediately, so the shell has to be in the document first.
  await waitForPublicShell(page)

  const section = page.locator('#menu-ugens-ret')
  const dish = section.locator('article').first()

  const heading = (await dish.locator('h3').count()) > 0 ? await dish.locator('h3').innerText() : null
  const week = (await dish.getByText(/^Uge /).count()) > 0
    ? (await dish.getByText(/^Uge /).innerText()).trim()
    : null

  const saturdayCard = section.locator('aside').first()
  const saturday = (await saturdayCard.innerText()).replace(/\s+/g, ' ').trim()

  const result: GuestWeek = {
    heading: heading === null ? null : heading.trim(),
    week,
    saturday,
    soldOut: (await dish.getByText('Udsolgt i dag').count()) > 0,
    saturdaySoldOut: (await saturdayCard.getByText('Udsolgt i dag').count()) > 0,
  }

  await context.close()

  return result
}

/** The same section, read through Draft Mode as the staff member previewing it. */
export async function previewWeek(page: Page): Promise<string> {
  await page.goto('/api/preview/start?maal=menu')
  await page.waitForURL(/\/menu/)

  const text = (await page.locator('#menu-ugens-ret').innerText()).replace(/\s+/g, ' ').trim()

  await page.goto('/api/preview/stop')
  await page.waitForURL(/\/admin/)

  return text
}
