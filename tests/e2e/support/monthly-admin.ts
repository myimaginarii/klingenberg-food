import { expect, type Browser, type Page } from '@playwright/test'

/**
 * Driving Månedens burger, for the browser tests — design 1ah.
 *
 * Everything on that screen is a link or a form, so these helpers do what a person does:
 * follow a link, fill fields, press a button, wait for the redirect the Server Action
 * performs. No selector here reaches for a class name or a test id — the screen is
 * addressed the way a screen reader addresses it, which is also the surest way for these
 * tests to catch an accessibility regression.
 */

export const MONTHLY_ADMIN_PATH = '/admin/menu/maanedens-burger'

/** The editor card, by its own accessible name. */
export function monthlyForm(page: Page) {
  return page.getByRole('form', { name: 'Månedens burger', exact: true })
}

export async function openMonthlyAdmin(page: Page): Promise<void> {
  await page.goto(MONTHLY_ADMIN_PATH)
  await expect(monthlyForm(page)).toBeVisible()
}

/**
 * Reach the editor the way a person does — from the menu screen's Burgere section.
 *
 * Its own helper rather than a `goto`, because "there is a way to it from Rediger menu"
 * is one of phase 6B's requirements, and a test that navigated by address would not be
 * testing it.
 */
export async function openMonthlyAdminFromMenu(page: Page): Promise<void> {
  await page.goto('/admin/menu')
  await page
    .getByRole('navigation', { name: 'Menuens sektioner' })
    .getByRole('link', { name: /^Burgere/ })
    .click()

  await page.getByRole('link', { name: 'Rediger Månedens burger' }).click()
  await expect(monthlyForm(page)).toBeVisible()
}

/**
 * The version token the screen currently carries.
 *
 * The row's `updated_at`, re-rendered by the server after every write. It is the one
 * signal that distinguishes "the server has answered" from "the browser still shows what
 * I typed" — see `pressAndSettle`.
 */
export async function monthlyVersion(page: Page): Promise<string> {
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
  const version = await monthlyVersion(page)
  const address = page.url()

  await press()

  await expect
    .poll(
      async () => {
        try {
          if ((await monthlyVersion(page)) !== version) return true
        } catch {
          // Mid-navigation: the fields have gone. Poll again.
          return false
        }

        // A refusal writes nothing, so the token does not move and only the address
        // changes. The address must have *changed*: this screen already carries a
        // `status=` from the press before this one.
        return page.url() !== address && /[?&](status|fejl)=/.test(page.url())
      },
      { message: 'the press never reached the server' },
    )
    .toBe(true)
}

/** The fields 1ah draws, by their visible labels. */
export type MonthlyFields = Partial<
  Record<'Navn' | 'Beskrivelse' | 'Pris (kr.)' | 'Startdato' | 'Slutdato', string>
>

/** Fill the card and press Gem. */
export async function saveMonthly(page: Page, fields: MonthlyFields): Promise<void> {
  const form = monthlyForm(page)

  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value)
  }

  await pressAndSettle(page, () => form.getByRole('button', { name: 'Gem' }).click())
}

/**
 * The "Vis på forsiden" switch, by the name a screen reader hears.
 *
 * The `<input>` is visually hidden and the switch a person sees is drawn by its sibling.
 * So this is the locator for *asserting* the state, and {@link setShowOnHomepage} is the
 * one for changing it: pressing the hidden input is not something a person can do.
 */
export function homepageToggle(page: Page) {
  return monthlyForm(page).getByRole('checkbox', { name: 'Vis på forsiden' })
}

/** Flip the switch the way a person does — by pressing the words beside it. */
export async function setHomepageChecked(page: Page, on: boolean): Promise<void> {
  if ((await homepageToggle(page).isChecked()) === on) return

  await monthlyForm(page).getByText('Vis på forsiden', { exact: true }).click()
  await expect(homepageToggle(page)).toBeChecked({ checked: on })
}

/** Put "Vis på forsiden" on or off and save. A draft change, like every field beside it. */
export async function setShowOnHomepage(page: Page, on: boolean): Promise<void> {
  await setHomepageChecked(page, on)

  await pressAndSettle(page, () =>
    monthlyForm(page).getByRole('button', { name: 'Gem' }).click(),
  )
}

/** "Ryd felterne" — 1ah's footer control. Its own form, its own action. */
export async function clearMonthlyFields(page: Page): Promise<void> {
  await pressAndSettle(page, () =>
    page.getByRole('form', { name: 'Ryd felterne' }).getByRole('button').click(),
  )
}

/** The Udsolgt control. */
export function availabilityForm(page: Page) {
  return page.getByRole('form', { name: 'Tilgængelighed — Månedens burger' })
}

/**
 * Is the burger currently sold out, as the administration reads it right now?
 *
 * `exact`, because the block also *explains* what sold out does — "Burgeren bliver
 * stående … med “Udsolgt i dag”" — and a substring match would read that sentence as the
 * state and report every burger as sold out. The state line's own text is exactly the two
 * words.
 */
export async function isSoldOut(page: Page): Promise<boolean> {
  return availabilityForm(page).getByText('Udsolgt i dag', { exact: true }).isVisible()
}

/** Press the Udsolgt switch. The press flips whatever state it is in now. */
export async function toggleAvailability(page: Page): Promise<void> {
  await pressAndSettle(page, () =>
    availabilityForm(page)
      .getByRole('button', { name: /— Månedens burger\./ })
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

/** The computed state §7d asks the administration to always show. */
export function stateBanner(page: Page) {
  return page.getByRole('region', {
    name: 'Sådan ser Månedens burger ud på hjemmesiden lige nu',
  })
}

/** The pending band, which names the fields that are waiting. */
export function pendingBand(page: Page) {
  return page.getByRole('status').filter({ hasText: /venter på at blive offentliggjort/ })
}

/** The publish confirmation §7d asks for when the window has already ended. */
export function expiredDialog(page: Page) {
  return page.getByRole('dialog')
}

/**
 * The screen's own Offentliggør, in the burgundy bar.
 *
 * It does **not** wait for a *status*: an expired window answers with the confirmation
 * instead, and a helper that insisted on `status=` would hang on exactly the case that
 * matters. Callers assert what came back.
 *
 * It waits for the address to **change**, compared against the one the click was made
 * on — never for a pattern. Every answer this action can give is another address on this
 * same screen, so a pattern would match the page the press started from and the helper
 * would return before the write had happened. That is the same reason `pressAndSettle`
 * compares rather than matches, and the same trap `../../support/weekly-admin.ts`
 * records for a screen whose saves redirect to where they came from.
 */
export async function pressPublish(page: Page): Promise<void> {
  const before = page.url()

  await page.getByRole('banner').getByRole('button', { name: 'Offentliggør' }).click()
  await page.waitForURL((url) => url.toString() !== before)
}

/** Publish, expecting it to go straight through. */
export async function publishMonthly(page: Page): Promise<void> {
  await openMonthlyAdmin(page)
  await pressPublish(page)
  await page.waitForURL(/maanedens-burger\?.*status=/)
}

/** Publish an already-finished window: confirm first, as §7d requires. */
export async function publishExpiredMonthly(page: Page): Promise<void> {
  await openMonthlyAdmin(page)
  await pressPublish(page)
  await expect(expiredDialog(page)).toBeVisible()
  await expiredDialog(page).getByRole('button', { name: 'Offentliggør alligevel' }).click()
  await page.waitForURL(/maanedens-burger\?.*status=/)
}

// ---------------------------------------------------------------------------
// Dates, without hard-coding a month
// ---------------------------------------------------------------------------

/**
 * A Copenhagen calendar date, `offsetDays` from today, as `<input type="date">` wants it.
 *
 * Computed rather than written down, so the suite behaves the same in September as in
 * March — the one way a date-window test can be worse than no test at all is by passing
 * only in the month it was written in.
 */
export function copenhagenDate(offsetDays: number): string {
  const today = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Copenhagen' }),
  )
  today.setDate(today.getDate() + offsetDays)

  const pad = (value: number) => String(value).padStart(2, '0')

  return `${String(today.getFullYear())}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
}

// ---------------------------------------------------------------------------
// The guest's view
// ---------------------------------------------------------------------------

/**
 * What a guest reads, in a fresh anonymous context.
 *
 * Its own browser context, with no admin cookie, because "the public site is unchanged"
 * is a claim about a visitor rather than about a logged-in staff member — and Draft Mode
 * lives in a cookie, so an assertion made on the staff page could be reading a preview.
 *
 * The two surfaces are read separately on purpose: the Forside section is gated by
 * `show_on_homepage` and the menu card is not, and a helper that conflated them could
 * not tell the two rules apart (§7d, §7e item 3).
 */
export type GuestBurger = {
  /** The Forside's dedicated section: its heading, or `null` when it is absent. */
  readonly homepageHeading: string | null
  /** Does the Forside section carry "Udsolgt i dag"? */
  readonly homepageSoldOut: boolean
  /** Does the Forside section still offer the ordering action? */
  readonly homepageOrderCta: boolean
  /** How many normal featured dishes "Tre fra menuen" is showing. */
  readonly featuredCount: number
  /** The `/menu` card's text, flattened. */
  readonly menuCard: string
  readonly menuSoldOut: boolean
}

export async function guestBurger(browser: Browser): Promise<GuestBurger> {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('/')

  const heading = page.locator('#maanedens-burger-titel')
  const hasSection = (await heading.count()) > 0
  const section = page.locator('section').filter({ has: heading })

  const homepageHeading = hasSection ? (await heading.innerText()).trim() : null
  const homepageSoldOut =
    hasSection && (await section.getByText('Udsolgt i dag').count()) > 0
  const homepageOrderCta =
    hasSection && (await section.getByRole('link', { name: /Bestil på telefon/ }).count()) > 0

  const featuredCount = await page
    .getByRole('region', { name: 'Tre fra menuen' })
    .getByRole('listitem')
    .count()

  await page.goto('/menu')

  // 1h places the card at the end of Burgere, which is where `MenuCategorySection`
  // renders it and where the administration puts the way to its editor.
  const card = page.locator('#menu-burgere article').last()
  const menuCard = (await card.innerText()).replace(/\s+/g, ' ').trim()
  const menuSoldOut = (await card.getByText('Udsolgt i dag').count()) > 0

  await context.close()

  return {
    homepageHeading,
    homepageSoldOut,
    homepageOrderCta,
    featuredCount,
    menuCard,
    menuSoldOut,
  }
}

/** The Forside, read through Draft Mode as the staff member previewing it. */
export async function previewHomepage(page: Page): Promise<string> {
  await page.goto('/api/preview/start?maal=forside')
  await page.waitForURL((url) => url.pathname === '/')

  const text = (await page.getByRole('main').innerText()).replace(/\s+/g, ' ').trim()

  await page.goto('/api/preview/stop')
  await page.waitForURL(/\/admin/)

  return text
}

/** The menu page, read through Draft Mode. */
export async function previewMenu(page: Page): Promise<string> {
  await page.goto('/api/preview/start?maal=menu')
  await page.waitForURL(/\/menu/)

  const text = (await page.locator('#menu-burgere').innerText()).replace(/\s+/g, ' ').trim()

  await page.goto('/api/preview/stop')
  await page.waitForURL(/\/admin/)

  return text
}
