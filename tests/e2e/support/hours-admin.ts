import { expect, type Browser, type Page } from '@playwright/test'

import { waitForPublicShell } from './public-shell'

/**
 * Driving Åbningstider, for the browser tests — design 1t, phase 8A.
 *
 * Everything on that screen is a link or a form, so these helpers do what a person does:
 * follow a link, flip a switch, choose a time, press a button, wait for the redirect the
 * Server Action performs. No selector here reaches for a class name or a test id — the
 * screen is addressed the way a screen reader addresses it, which is also the surest way
 * for these tests to catch an accessibility regression.
 */

export const HOURS_ADMIN_PATH = '/admin/aabningstider'

/** The seven weekdays, as the screen names them. Monday first, like the document. */
export const WEEKDAYS = [
  'Mandag',
  'Tirsdag',
  'Onsdag',
  'Torsdag',
  'Fredag',
  'Lørdag',
  'Søndag',
] as const

export type Weekday = (typeof WEEKDAYS)[number]

/**
 * The owner-confirmed week, as `supabase/seed.sql` writes it.
 *
 * Stated once here so a failure points at the site rather than at a time typed twice, and
 * so every scenario can restore exactly what it found.
 */
export const SEEDED_WEEK: Readonly<Record<Weekday, { open: boolean; from?: string; to?: string }>> =
  {
    Mandag: { open: false },
    Tirsdag: { open: false },
    Onsdag: { open: true, from: '15:00', to: '20:00' },
    Torsdag: { open: true, from: '15:00', to: '20:00' },
    Fredag: { open: true, from: '15:00', to: '20:00' },
    Lørdag: { open: true, from: '17:00', to: '20:00' },
    Søndag: { open: true, from: '17:00', to: '20:00' },
  }

/** The editor card, by its own accessible name. */
export function hoursForm(page: Page) {
  return page.getByRole('form', { name: 'Normale åbningstider', exact: true })
}

export async function openHoursAdmin(page: Page): Promise<void> {
  await page.goto(HOURS_ADMIN_PATH)
  await expect(hoursForm(page)).toBeVisible()
}

/** Reach the editor the way an owner does — from the dashboard tile. */
export async function openHoursAdminFromDashboard(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.getByRole('link', { name: 'Åbn åbningstiderne' }).click()
  await expect(hoursForm(page)).toBeVisible()
}

/** One weekday's row, by the group name a screen reader hears. */
export function weekdayRow(page: Page, weekday: Weekday) {
  return hoursForm(page).getByRole('group', { name: weekday, exact: true })
}

/**
 * The open/closed switch for one weekday, by the name a screen reader hears.
 *
 * The `<input>` is visually hidden and the switch a person sees is drawn by its sibling
 * label, so this is the locator for *asserting* the state; {@link setWeekdayOpen} is the
 * one for changing it, because pressing a hidden input is not something a person can do.
 */
export function openSwitch(page: Page, weekday: Weekday) {
  return weekdayRow(page, weekday).getByRole('checkbox')
}

/** The two dropdowns, by the names that repeat the weekday. */
export function timeSelect(page: Page, weekday: Weekday, edge: 'åbner' | 'lukker') {
  return weekdayRow(page, weekday).getByLabel(`${weekday} — ${edge}`, { exact: true })
}

/**
 * The version token the screen currently carries.
 *
 * The row's `updated_at`, re-rendered by the server after every write. It is the one
 * signal that distinguishes "the server has answered" from "the browser still shows what
 * I chose" — see {@link pressAndSettle}.
 */
export async function hoursVersion(page: Page): Promise<string> {
  return hoursForm(page).locator('input[name="version"]').first().inputValue()
}

/**
 * Press a control and wait until the server has actually answered.
 *
 * Two things can end the wait: a new version token, or a refusal in the address. Waiting
 * for the controls would not work — a select already holds what was just chosen in it, so
 * a poll on the values would pass against the page the click was made on, and the next
 * press would submit a stale token and be refused as a conflict. The same helper the
 * monthly and weekly suites use, for the same reason.
 */
export async function pressAndSettle(page: Page, press: () => Promise<void>): Promise<void> {
  const version = await hoursVersion(page)
  const address = page.url()

  await press()

  await expect
    .poll(
      async () => {
        try {
          if ((await hoursVersion(page)) !== version) return true
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

/** Flip a weekday open or closed the way a person does — by pressing the switch. */
export async function setWeekdayOpen(
  page: Page,
  weekday: Weekday,
  open: boolean,
): Promise<void> {
  if ((await openSwitch(page, weekday).isChecked()) === open) return

  // The visible target is the label the hidden checkbox points at, which is what a person
  // taps and what the 44 px assertion measures.
  await weekdayRow(page, weekday).locator('label').first().click()
  await expect(openSwitch(page, weekday)).toBeChecked({ checked: open })
}

/** Choose one of a weekday's two times. The day must be open for them to be visible. */
export async function setWeekdayTime(
  page: Page,
  weekday: Weekday,
  edge: 'åbner' | 'lukker',
  time: string,
): Promise<void> {
  await timeSelect(page, weekday, edge).selectOption(time)
}

/** Press Gem and wait for the server's answer. */
export async function saveHours(page: Page): Promise<void> {
  await pressAndSettle(page, () => hoursForm(page).getByRole('button', { name: 'Gem' }).click())
}

/**
 * The screen's own Offentliggør, in the burgundy bar.
 *
 * It waits for the address to **change**, compared against the one the click was made on
 * — never for a pattern. Every answer this action can give is another address on this same
 * screen, so a pattern would match the page the press started from and the helper would
 * return before the write had happened.
 */
export async function publishHours(page: Page): Promise<void> {
  const before = page.url()

  await page.getByRole('banner').getByRole('button', { name: 'Offentliggør' }).click()
  await page.waitForURL((url) => url.toString() !== before)
}

/** The pending band, which names the days that are waiting. */
export function pendingBand(page: Page) {
  return page.getByRole('status').filter({ hasText: /venter på at blive offentliggjort/ })
}

/** The Kladde pill in the burgundy bar. */
export function stateBadge(page: Page) {
  return page.getByRole('banner').getByText(/^(Kladde|Live)$/)
}

/** Every refusal currently on screen, in the order they appear. */
export async function fieldErrors(page: Page): Promise<string[]> {
  return hoursForm(page)
    .locator('p[id$="-fejl"]')
    .allInnerTexts()
    .then((texts) => texts.map((text) => text.replace(/\s+/g, ' ').trim()))
}

/** The whole week as the editor currently shows it. */
export async function readWeek(
  page: Page,
): Promise<Record<Weekday, { open: boolean; from: string; to: string }>> {
  const week = {} as Record<Weekday, { open: boolean; from: string; to: string }>

  for (const weekday of WEEKDAYS) {
    week[weekday] = {
      open: await openSwitch(page, weekday).isChecked(),
      from: await timeSelect(page, weekday, 'åbner').inputValue(),
      to: await timeSelect(page, weekday, 'lukker').inputValue(),
    }
  }

  return week
}

/**
 * Put the week back exactly as the seed wrote it, and publish it.
 *
 * Every scenario that moves the hours ends with this, so an interrupted run leaves the
 * next one — and every other suite, all of which read the same schedule — unaffected. It
 * is deliberately unconditional about the *save*: a draft left behind by a refused
 * scenario has to be cleared too, and saving the seeded week does exactly that (the delta
 * is empty, so the draft is removed).
 */
export async function restoreSeededWeek(page: Page): Promise<void> {
  await openHoursAdmin(page)

  for (const weekday of WEEKDAYS) {
    const wanted = SEEDED_WEEK[weekday]
    await setWeekdayOpen(page, weekday, wanted.open)

    if (wanted.open) {
      await setWeekdayTime(page, weekday, 'åbner', wanted.from ?? '')
      await setWeekdayTime(page, weekday, 'lukker', wanted.to ?? '')
    }
  }

  await saveHours(page)

  // A publish is only offered when something is pending. After a scenario that already
  // published its change back, the save above cleared the draft and there is nothing to do.
  if (await pendingBand(page).isVisible()) {
    await publishHours(page)
  }

  await expect(pendingBand(page)).toBeHidden()
}

// ---------------------------------------------------------------------------
// The guest's view
// ---------------------------------------------------------------------------

/**
 * What a guest reads, in a fresh anonymous context.
 *
 * Its own browser context, with no admin cookie, because "the public opening hours are
 * unchanged" is a claim about a visitor rather than about a logged-in owner — and Draft
 * Mode lives in a cookie, so an assertion made on the staff page could be reading a
 * preview.
 *
 * Two surfaces, because the schedule genuinely appears in two shapes: Find os prints all
 * seven days, and the footer — which is on every page — groups them into "Ons–fre
 * 15:00–20:00". A helper that read only one could not catch a change that reached the
 * table and not the grouping.
 */
export type GuestHours = {
  /** Find os's own text, flattened — including the seven-day table at either width. */
  readonly table: string
  /** The grouped footer lines, flattened. */
  readonly footer: string
}

export async function guestHours(browser: Browser): Promise<GuestHours> {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('/find-os')
  const hours = await readFindOs(page)

  await context.close()

  return hours
}

/** The same two surfaces, read through Draft Mode as the owner previewing them. */
export async function previewHours(page: Page): Promise<GuestHours> {
  await page.goto('/api/preview/start?maal=find-os')
  await page.waitForURL(/\/find-os/)

  const hours = await readFindOs(page)

  await page.goto('/api/preview/stop')
  await page.waitForURL(/\/admin/)

  return hours
}

/**
 * Read Find os and the footer, at whichever width the project is running at.
 *
 * The seven-day table is behind a disclosure on a phone and simply shown from `md` up
 * (design 1g / 1l), so a helper that read one `<dl>` would read the grouped summary at 375
 * and the seven-day list at 1440 — and every assertion about a weekday would pass at one
 * width and fail at the other for reasons that have nothing to do with the hours. Opening
 * the `<details>` first makes the same seven rows readable at both, which is what lets the
 * suite make one assertion rather than two.
 *
 * `innerText` rather than `textContent`, deliberately: it reports what is *rendered*, so a
 * branch the current width hides contributes nothing.
 */
async function readFindOs(page: Page): Promise<GuestHours> {
  // `count()` below answers immediately, so the shell has to be in the document first.
  await waitForPublicShell(page)

  const details = page.locator('main details')

  if ((await details.count()) > 0) {
    await details.first().evaluate((element) => {
      ;(element as HTMLDetailsElement).open = true
    })
  }

  return { table: await flatten(page, 'main'), footer: await flatten(page, 'footer') }
}

/**
 * One row of the public seven-day table, as a pattern.
 *
 * `DailyHoursList` marks today with "· i dag" as well as a tint (1k, and 1aa's rule that a
 * state is never carried by colour alone), so a plain substring assertion would pass six
 * days a week and fail on the seventh. The marker is optional in the pattern rather than
 * asserted away, because it is a real part of what the page says.
 */
export function dayLine(weekday: Weekday, hours: string): RegExp {
  // `hours` is always a time range or the word "Lukket" — digits, a colon, an en dash and
  // letters — so there is nothing in it a regular expression would read as syntax, and no
  // escaping step to get wrong. Callers pass what the page says, verbatim.
  return new RegExp(`${weekday}(?: · i dag)? ${hours}`)
}

async function flatten(page: Page, selector: string): Promise<string> {
  return (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ').trim()
}
