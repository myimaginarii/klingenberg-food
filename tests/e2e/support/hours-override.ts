import { expect, type APIRequestContext, type Page } from '@playwright/test'

import { findFirstOpeningFrom, getOpenState } from '@/lib/hours/engine'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { addDays, type IsoDate } from '@/lib/time/calendar'
import { copenhagenDateOf, copenhagenWallClock } from '@/lib/time/copenhagen'

import { closedOverride, CONFIRMED_SCHEDULE, customOverride } from '../../unit/fixtures/hours'

export { closedOverride, customOverride }

/**
 * Driving the one-off opening-hours card, for the browser tests — design 1t, phase 8B.
 *
 * Everything on that card is a link or a form, so these helpers do what a person does:
 * choose a date, press a chip, choose two times, press a button, wait for the redirect the
 * Server Action performs. No selector here reaches for a class name or a test id — the card
 * is addressed the way a screen reader addresses it, which is also the surest way for these
 * tests to catch an accessibility regression.
 *
 * WHAT A GUEST CAN ACTUALLY SEE, AND WHY IT IS THE BADGE
 *
 * A one-off override moves two things on the public site: the **open/closed badge** — which
 * is on every page, and is what `getOpenState` resolves from the weekly schedule *and* the
 * published overrides — and §7b's **sold-out reset**, which resolves through the same
 * engine. Find os's seven-day table is the recurring week and does not change, and the
 * *generated announcement* that would say "Ændrede åbningstider søndag" in so many words is
 * **phase 8C**. So the badge is the observable, and these helpers read it from the bytes a
 * guest is served rather than from a hydrated DOM.
 *
 * The distinctive marker is a closing time no weekly schedule in this system uses: the
 * seeded week closes at 20:00 every open day, so `til kl. 23:45` can only come from a
 * published override. That is what makes "the pending edit has not leaked" an assertion
 * about a *specific* value rather than about a page looking the same.
 */

/** The one closing time the seeded week never produces. */
export const LATE_CLOSING = '23:45'

/** A custom override that is open at every moment of the day up to {@link LATE_CLOSING}. */
export const OPEN_ALL_DAY = { from: '00:00', to: LATE_CLOSING } as const

/** The badge text the marker produces: "Åbent nu · til kl. 23:45". */
export const LATE_CLOSING_MARKER = `til kl. ${LATE_CLOSING}`

export const HOURS_ADMIN_PATH = '/admin/aabningstider'

/** Today, in the timezone the whole system reasons in (§7a) — never the machine's. */
export function todayInCopenhagen(): IsoDate {
  return copenhagenDateOf(new Date())
}

/**
 * Is there still enough of the day left for an override to make the restaurant *open*?
 *
 * An opening never crosses midnight (`opens_at < closes_at`, enforced by the shape CHECK
 * and relied on by the phase-2 engine), so no override can cover 23:45–00:00. In that last
 * quarter of an hour the badge says "Lukket" whatever anybody publishes, and the scenarios
 * that assert a *flip* have nothing to flip to. This is a property of the domain rather
 * than a flake, so the affected scenarios say so and stand down rather than retrying.
 */
export function tooLateToOpenToday(): boolean {
  const { time } = copenhagenWallClock(new Date())

  // Fifteen minutes of margin over the 23:45 closing the marker uses. A string comparison
  // is enough: both sides are zero-padded `HH:MM`.
  return time >= '23:30'
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/** The one-off card's form, by its own accessible name. */
export function overrideForm(page: Page) {
  return page.getByRole('form', { name: 'Ændrede tider en enkelt dag', exact: true })
}

/** The card itself, including the removal control and the list beneath the form. */
export function overrideCard(page: Page) {
  return page.getByRole('region', { name: 'Ændrede tider en enkelt dag', exact: true })
}

export function overrideHref(date?: IsoDate): string {
  return date === undefined
    ? HOURS_ADMIN_PATH
    : `${HOURS_ADMIN_PATH}?dato=${encodeURIComponent(date)}`
}

export async function openOverrideCard(page: Page, date?: IsoDate): Promise<void> {
  await page.goto(overrideHref(date))
  await expect(overrideForm(page)).toBeVisible()
}

/** The version token the card currently carries — the row's `updated_at`, or `''`. */
export async function overrideVersion(page: Page): Promise<string> {
  return overrideForm(page).locator('input[name="version"]').first().inputValue()
}

/**
 * Press a control and wait until the server has actually answered.
 *
 * Two things can end the wait: a new version token, or a different address. Waiting for
 * the fields would not work — a `<select>` already holds what was just chosen, so a poll on
 * the values would pass against the page the click was made on. The same helper the weekly
 * suite uses, for the same reason.
 */
export async function pressAndSettle(page: Page, press: () => Promise<void>): Promise<void> {
  const version = await overrideVersion(page)
  const address = page.url()

  await press()

  await expect
    .poll(
      async () => {
        try {
          if ((await overrideVersion(page)) !== version) return true
        } catch {
          // Mid-navigation: the fields have gone. Poll again.
          return false
        }

        return page.url() !== address
      },
      { message: 'the press never reached the server' },
    )
    .toBe(true)
}

export async function setOverrideDate(page: Page, date: IsoDate): Promise<void> {
  await overrideForm(page).getByLabel('Dato', { exact: true }).fill(date)
}

/** Choose one of 1t's two chips, the way a person does — by pressing the label. */
export async function setOverrideKind(
  page: Page,
  kind: 'closed' | 'custom',
): Promise<void> {
  const label = kind === 'closed' ? 'Lukket en bestemt dato' : 'Andre tider en enkelt dag'

  await overrideForm(page).getByText(label, { exact: true }).click()
  await expect(overrideForm(page).getByRole('radio', { name: label })).toBeChecked()
}

export async function setOverrideTime(
  page: Page,
  edge: 'Fra' | 'Til',
  time: string,
): Promise<void> {
  await overrideForm(page).getByLabel(edge, { exact: true }).selectOption(time)
}

/** Fill the whole card in one go. */
export async function fillOverride(
  page: Page,
  values: {
    readonly date: IsoDate
    readonly kind: 'closed' | 'custom'
    readonly from?: string
    readonly to?: string
  },
): Promise<void> {
  await setOverrideDate(page, values.date)
  await setOverrideKind(page, values.kind)

  if (values.kind === 'custom') {
    await setOverrideTime(page, 'Fra', values.from ?? '')
    await setOverrideTime(page, 'Til', values.to ?? '')
  }
}

export async function saveOverride(page: Page): Promise<void> {
  await pressAndSettle(page, () =>
    overrideForm(page).getByRole('button', { name: 'Gem', exact: true }).click(),
  )
}

export async function saveAndPublishOverride(page: Page): Promise<void> {
  await pressAndSettle(page, () =>
    overrideForm(page).getByRole('button', { name: 'Gem og offentliggør' }).click(),
  )
}

/** "Offentliggør" in the pending band — the other entrance to the same publish. */
export async function publishFromBand(page: Page): Promise<void> {
  const before = page.url()

  await overridePendingBand(page).getByRole('button', { name: 'Offentliggør' }).click()
  await page.waitForURL((url) => url.toString() !== before)
}

/**
 * "Fjern" — whichever of its three forms the card is currently offering.
 *
 * A pending removal is one press. A **published** one is a link to a confirmation and then
 * a press, because pressing it must not remove anything (the same rule phase 5D's Slet ret
 * follows). The helper walks whichever path is drawn, so a scenario says "remove it" and
 * the card decides what that means.
 */
export async function removeOverride(page: Page): Promise<void> {
  const confirmLink = overrideCard(page).getByRole('link', {
    name: 'Fjern ændringen fra hjemmesiden',
  })

  if ((await confirmLink.count()) > 0) {
    await confirmLink.click()
    await expect(
      overrideCard(page).getByRole('button', { name: /^Ja — fjern ændringen/ }),
    ).toBeVisible()
  }

  const before = page.url()

  await overrideCard(page)
    .getByRole('button', { name: /^(Fjern kladden|Fortryd den ventende ændring|Ja — fjern)/ })
    .click()

  await page.waitForURL((url) => url.toString() !== before)
}

/** The pending band above the card, which names the date and what is waiting. */
export function overridePendingBand(page: Page) {
  return page.getByRole('status').filter({ hasText: /venter på at blive offentliggjort/ })
}

/** The card's own state pill: "Kladde" or "På hjemmesiden". */
export function overrideStateBadge(page: Page) {
  return overrideCard(page).getByText(/^(Kladde|På hjemmesiden)$/)
}

/** The card's computed state sentence — the one the form points at with `aria-describedby`. */
export async function overrideStateSentence(page: Page): Promise<string> {
  const id = await overrideForm(page).getAttribute('aria-describedby')

  return (await page.locator(`#${id}`).innerText()).replace(/\s+/g, ' ').trim()
}

/** Every refusal currently on the card, in the order they appear. */
export async function overrideFieldErrors(page: Page): Promise<string[]> {
  return overrideForm(page)
    .locator('p[id$="-fejl"]')
    .allInnerTexts()
    .then((texts) => texts.map((text) => text.replace(/\s+/g, ' ').trim()))
}

/** The dates the "Kommende ændringer" list currently names. */
export async function listedOverrideDates(page: Page): Promise<string[]> {
  return overrideCard(page)
    .getByRole('list')
    .getByRole('listitem')
    .allInnerTexts()
    .then((texts) => texts.map((text) => text.replace(/\s+/g, ' ').trim()))
}

/**
 * Take every one-off change away again, so the next scenario — and every other suite —
 * finds the database as the seed left it.
 *
 * Deliberately unconditional and repeated until the list is empty: a scenario interrupted
 * halfway may have left a pending row, a published one, or a published one with an edit
 * behind it, and all three have to go.
 */
export async function removeAllOverrides(page: Page): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    await openOverrideCard(page)

    const dates = await overrideDatesFromList(page)
    if (dates.length === 0) return

    await openOverrideCard(page, dates[0])
    await removeOverride(page)
  }

  throw new Error('Could not clear the one-off opening-hours overrides.')
}

/** The `dato` of every row in the list, read from its own link. */
async function overrideDatesFromList(page: Page): Promise<IsoDate[]> {
  const links = overrideCard(page).getByRole('list').getByRole('link')

  return (await links.evaluateAll((elements) =>
    elements
      .map((element) => new URL((element as HTMLAnchorElement).href).searchParams.get('dato'))
      .filter((date): date is string => date !== null),
  )) as IsoDate[]
}

// ---------------------------------------------------------------------------
// The guest's view
// ---------------------------------------------------------------------------

export type GuestBadge = {
  /** True when the served page says the restaurant is open right now. */
  readonly open: boolean
  /** True when it says it closes at {@link LATE_CLOSING} — only an override can do that. */
  readonly marker: boolean
  readonly status: number
  readonly cacheState: string | undefined
}

/**
 * One request from nobody in particular: no session, no cookie, no browser cache.
 *
 * The same shape `tests/e2e/public-cache.spec.ts` uses, and for the same reason: §6's
 * promise is about the **first** request after a publish, and a poll would turn "the first
 * request carries it" into "some request eventually does".
 */
export async function guestBadge(
  request: APIRequestContext,
  path = '/',
): Promise<GuestBadge> {
  const response = await request.get(path)
  const html = await response.text()

  return {
    open: html.includes('Åbent nu'),
    marker: html.includes(LATE_CLOSING_MARKER),
    status: response.status(),
    cacheState: response.headers()['x-nextjs-cache'],
  }
}

/** The same two facts, read through Draft Mode as the staff member previewing them. */
export async function previewBadge(page: Page): Promise<{ open: boolean; marker: boolean }> {
  await page.goto('/api/preview/start?maal=forside')
  await page.waitForURL((url) => !url.pathname.startsWith('/api/'))

  const text = await page.locator('body').innerText()

  await page.goto('/api/preview/stop')
  await page.waitForURL(/\/admin/)

  return { open: text.includes('Åbent nu'), marker: text.includes(LATE_CLOSING_MARKER) }
}

// ---------------------------------------------------------------------------
// What the seeded week says — for the §7b integration case
// ---------------------------------------------------------------------------

/**
 * The seeded week, as the phase-2 engine reads it.
 *
 * Imported from the unit suite's own fixture rather than restated, so a change to the
 * seeded hours breaks one file instead of drifting silently between two.
 */
export const SEEDED_WEEK: WeeklySchedule = CONFIRMED_SCHEDULE

/**
 * The first date on or after `from` on which the seeded week is **closed**.
 *
 * Always within seven days, because the confirmed week closes on Monday and Tuesday. It is
 * the date §11's second direction needs: a day the engine would skip, which a published
 * custom override has to turn into the sold-out reset day.
 */
export function firstNormallyClosedDay(from: IsoDate): IsoDate {
  for (let offset = 0; offset < 8; offset += 1) {
    const date = addDays(from, offset)

    if (!getOpenState(new Date(`${date}T12:00:00Z`), SEEDED_WEEK, []).today.isOpen) {
      return date
    }
  }

  throw new Error('The seeded week has no closed day, which it must have.')
}

/** Every date strictly between `from` and `to`, exclusive at both ends. */
export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = []

  for (let date = addDays(from, 1); date < to; date = addDays(date, 1)) dates.push(date)

  return dates
}

/**
 * When §7b says a dish marked sold out today comes back, given a set of overrides.
 *
 * Computed with the **engine the application itself uses**, rather than with a second
 * implementation of the rule: what this suite is asserting is the *wiring* — that the
 * administration's sentence is resolved from the published overrides — and duplicating the
 * calendar arithmetic here would be asserting the engine twice and the wiring not at all.
 * Every rule the engine applies is unit-tested on its own in `tests/unit/menu/sold-out.ts`.
 */
export function expectedResetOpening(
  today: IsoDate,
  overrides: readonly OpeningHoursOverride[],
): { date: IsoDate; time: string } {
  const opening = findFirstOpeningFrom(addDays(today, 1), SEEDED_WEEK, overrides)

  if (opening === null) throw new Error('No opening was found inside the search window.')

  return { date: opening.date, time: opening.from }
}
