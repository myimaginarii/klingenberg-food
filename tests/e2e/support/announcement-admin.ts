import { expect, type Browser, type Page } from '@playwright/test'

/**
 * Driving Besked på hjemmesiden, for the browser tests — design 1ad, 1ac.
 *
 * Everything on that screen is a link, a form field or a button, so these helpers do what
 * a person does: follow a link, fill a field, choose a chip, press a button, wait for the
 * redirect the Server Action performs. No selector here reaches for a class name or a
 * test id — the screen is addressed the way a screen reader addresses it, which is also
 * the surest way for these tests to catch an accessibility regression.
 */

export const ANNOUNCEMENT_ADMIN_PATH = '/admin/besked'

/** The editor card, by its own accessible name. */
export function announcementForm(page: Page) {
  return page.getByRole('form', { name: 'Besked på hjemmesiden', exact: true })
}

/** The band that appears when a draft is waiting. */
export function pendingBand(page: Page) {
  return page.getByRole('status').filter({ hasText: 'venter på at blive offentliggjort' })
}

/** The computed statement of what the hjemmeside is showing right now. */
export function stateBanner(page: Page) {
  return page.getByRole('region', { name: 'Sådan ser beskeden ud på hjemmesiden lige nu' })
}

export async function openAnnouncementAdmin(page: Page): Promise<void> {
  await page.goto(ANNOUNCEMENT_ADMIN_PATH)
  await expect(announcementForm(page)).toBeVisible()
}

/**
 * Reach the editor the way a person does — from the dashboard.
 *
 * Its own helper rather than a `goto`, because "there is a way to it from Oversigt" is
 * one of phase 7A's requirements, and a test that navigated by address would not be
 * testing it.
 */
export async function openAnnouncementAdminFromDashboard(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.getByRole('link', { name: 'Åbn beskeden' }).click()
  await expect(announcementForm(page)).toBeVisible()
}

/**
 * The version token the screen currently carries.
 *
 * The row's `updated_at`, re-rendered by the server after every write. It is the one
 * signal that distinguishes "the server has answered" from "the browser still shows what
 * I typed" — see `pressAndSettle`.
 */
async function announcementVersion(page: Page): Promise<string> {
  return page.locator('input[name="version"]').first().inputValue()
}

/** Press a control and wait until the server has actually answered. */
async function pressAndSettle(page: Page, press: () => Promise<void>): Promise<void> {
  const version = await announcementVersion(page)
  const address = page.url()

  await press()

  await expect
    .poll(
      async () => {
        try {
          if ((await announcementVersion(page)) !== version) return true
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

/** The fields 1ad draws, by their visible labels. */
export type AnnouncementFields = {
  readonly message?: string
  /** The visible option text in "Link (valgfrit)" — "Intet link", "Find os", … */
  readonly link?: string
  readonly linkLabel?: string
  readonly address?: string
  /**
   * Which of 1ad's chips to choose, by its accessible name.
   *
   * The name comes from the chip's `<label>`, not from the radio itself — the input is
   * `sr-only` behind the pill it draws — so a `RegExp` is the honest way to name the
   * closing chip, whose words carry a weekday and a time that depend on the day the suite
   * runs on.
   */
  readonly expiryChip?: string | RegExp
  readonly date?: string
  readonly time?: string
}

/**
 * Choose one of 1ad's chips the way a person does — by pressing the pill.
 *
 * The radio itself is `sr-only`, so it is one clipped pixel behind the label that draws
 * the pill; clicking the input directly is intercepted by that label, which is exactly
 * what a real pointer would hit. So the label is clicked and the radio is then asserted
 * to have taken the value — the same shape `setHomepageChecked` uses for the Forside
 * switch, which is the same `peer` pattern one control up.
 */
async function chooseExpiryChip(page: Page, name: string | RegExp): Promise<void> {
  const form = announcementForm(page)
  const chip = form.getByRole('radio', { name })

  const id = await chip.getAttribute('id')
  expect(id, 'a chip carries an id its label points at').not.toBeNull()

  await form.locator(`label[for="${id}"]`).click()
  await expect(chip).toBeChecked()
}

/** Fill 1ad's card and press Gem. */
export async function saveAnnouncement(
  page: Page,
  fields: AnnouncementFields,
): Promise<void> {
  const form = announcementForm(page)

  if (fields.message !== undefined) await form.getByLabel('Besked').fill(fields.message)
  if (fields.link !== undefined) {
    await form.getByLabel('Link (valgfrit)').selectOption({ label: fields.link })
  }
  if (fields.linkLabel !== undefined) {
    await form.getByLabel('Tekst på linket').fill(fields.linkLabel)
  }
  if (fields.address !== undefined) {
    await form.getByLabel('Anden adresse').fill(fields.address)
  }
  if (fields.expiryChip !== undefined) await chooseExpiryChip(page, fields.expiryChip)
  if (fields.date !== undefined) await form.getByLabel('Dato').fill(fields.date)
  if (fields.time !== undefined) await form.getByLabel('Klokkeslæt').fill(fields.time)

  await pressAndSettle(page, () => form.getByRole('button', { name: 'Gem' }).click())
}

/** Press this screen's own Offentliggør, in the bar. */
export async function publishAnnouncement(page: Page): Promise<void> {
  await pressAndSettle(page, () =>
    page.getByRole('banner').getByRole('button', { name: 'Offentliggør' }).click(),
  )
}

/** Whether the bar's Offentliggør is available at all (1ad: "nedtonet indtil …"). */
export function publishButton(page: Page) {
  return page.getByRole('banner').getByRole('button', { name: 'Offentliggør' })
}

/** Open the real public site in Draft Mode and return what a previewer reads. */
export async function previewHomepage(page: Page): Promise<GuestAnnouncement> {
  await page.goto('/api/preview/start?maal=forside')
  await expect(page.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()

  const seen = await readAnnouncement(page)

  await page.goto('/api/preview/stop')

  return seen
}

/** What a visitor reads at the top of a public page — or that there is nothing there. */
export type GuestAnnouncement = {
  /** True when the labelled region exists at all. */
  readonly present: boolean
  readonly message: string | null
  readonly linkText: string | null
  readonly linkHref: string | null
  /** The region's own height. Zero when the bar reserves no space (1ac). */
  readonly height: number
  /** The header's distance from the top of the document. */
  readonly headerTop: number
}

/** Read the announcement region on whatever page `page` is currently showing. */
async function readAnnouncement(page: Page): Promise<GuestAnnouncement> {
  const region = page.getByRole('region', { name: 'Besked fra restauranten' })
  const present = (await region.count()) > 0

  const link = region.getByRole('link')
  const hasLink = present && (await link.count()) > 0

  const box = present ? await region.boundingBox() : null

  const headerTop = await page
    .getByRole('banner')
    .evaluate((element) => element.getBoundingClientRect().top + window.scrollY)

  return {
    present,
    message: present ? ((await region.innerText()).trim() || null) : null,
    linkText: hasLink ? (await link.innerText()).trim() : null,
    linkHref: hasLink ? await link.getAttribute('href') : null,
    height: box?.height ?? 0,
    headerTop,
  }
}

/**
 * What an ordinary visitor sees, in a context of their own.
 *
 * A fresh context every time, so no admin session and no draft-mode cookie can leak into
 * a "the guest sees…" assertion — which is the promise the draft model exists to keep.
 */
export async function guestAnnouncement(
  browser: Browser,
  path = '/',
): Promise<GuestAnnouncement & { cookies: number }> {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(path)

  const seen = await readAnnouncement(page)
  const cookies = (await context.cookies()).length

  await context.close()

  return { ...seen, cookies }
}

/** Today's Copenhagen date, offset by whole days — for an expiry that is always ahead. */
export function copenhagenDate(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() + offsetDays * 86_400_000))

  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''

  return `${read('year')}-${read('month')}-${read('day')}`
}
