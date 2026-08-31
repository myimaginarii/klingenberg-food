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

/**
 * The band that appears when a draft is waiting.
 *
 * Matched on its own opening words rather than on the tail they share with the
 * "Der er ingen ændringer, der venter på at blive offentliggjort" notice — which is the
 * message a publish gives when there is *nothing* pending, and which a looser filter
 * would report as a pending band.
 */
export function pendingBand(page: Page) {
  return page
    .getByRole('status')
    .filter({ hasText: 'Ændringer venter på at blive offentliggjort' })
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

/**
 * 1ad's "Vis besked" card, by its own accessible name.
 *
 * It is a `<form>` in **both** directions since phase 7's completion pass (§0h): on while
 * the message is showing, off while it is switched off but still showable. It is replaced
 * by {@link visibilityUnavailableCard} — a region, not a form — only when the published
 * message could not be shown again at all, which is what makes "the press is offered
 * exactly while it can succeed" something a test can assert rather than infer.
 */
export function visibilityCard(page: Page) {
  return page.getByRole('form', { name: 'Vis besked', exact: true })
}

/**
 * Which direction the switch would move, read from the field it posts.
 *
 * `'off'` — the bar is showing and the press would hide it; `'on'` — the bar is hidden
 * and the press would show the same published message again; `'unavailable'` — there is
 * no press, because the published message has expired.
 */
export async function visibilitySwitchDirection(
  page: Page,
): Promise<'on' | 'off' | 'unavailable'> {
  if ((await visibilityCard(page).count()) === 0) return 'unavailable'

  const fields = await formFields(visibilityCard(page))
  return fields.vis === '1' ? 'on' : 'off'
}

/** The statement that replaces the switch once the published message has expired. */
export function visibilityUnavailableCard(page: Page) {
  return page.getByRole('region', { name: 'Vis besked — slået fra' })
}

/** 1ad's footer control. */
export function removeNowButton(page: Page) {
  return page.getByRole('button', { name: 'Fjern beskeden nu' })
}

/** The green strip a removal or a restore leaves behind (1aa, §6). */
export function undoStrip(page: Page) {
  return page.getByRole('status').filter({ hasText: /Beskeden (er fjernet|vises igen)/ })
}

/** The Fortryd inside it. */
export function undoButton(page: Page) {
  return undoStrip(page).getByRole('button', { name: /^Fortryd/ })
}

/**
 * Press 1ad's switch — the "Vis besked" entrance to the immediate path.
 *
 * One helper for both directions, because it is one control: what the press asks for is
 * whatever the switch is currently *not*.
 */
export async function pressVisibilitySwitch(page: Page): Promise<void> {
  await pressAndSettle(page, () => visibilityCard(page).getByRole('button').click())
}

/** Press "Fjern beskeden nu" — the footer entrance to the same operation. */
export async function pressRemoveNow(page: Page): Promise<void> {
  await pressAndSettle(page, () => removeNowButton(page).click())
}

/** Press Fortryd on the strip. */
export async function pressUndo(page: Page): Promise<void> {
  await pressAndSettle(page, () => undoButton(page).click())
}

/**
 * The field names and values a form would post, read straight out of the markup.
 *
 * Used to assert that 1ad's two controls are two entrances to **one** operation: same
 * names, same requested state, same version token.
 *
 * Next.js's own `$ACTION_*` dispatch fields are left out. They are the framework's, not
 * the screen's — a person cannot choose them and this application never reads them — and
 * `formActionId` below asserts the one thing they *are* good for.
 */
export async function formFields(
  locator: ReturnType<Page['getByRole']>,
): Promise<Record<string, string>> {
  return locator.evaluate((element) => {
    const form = element.tagName === 'FORM' ? element : element.closest('form')
    if (form === null) return {}

    const fields: Record<string, string> = {}
    for (const input of Array.from(form.querySelectorAll('input[name]'))) {
      const name = input.getAttribute('name') ?? ''
      if (name.startsWith('$ACTION')) continue
      fields[name] = (input as HTMLInputElement).value
    }
    return fields
  })
}

/**
 * Which Server Action a form dispatches to, as Next.js's own identifier.
 *
 * Two forms carrying the same id are two entrances to the same function — which is the
 * whole of 1ad's "'Vis besked' fra eller 'Fjern beskeden nu'" being one operation rather
 * than two implementations to keep in step.
 */
export async function formActionId(
  locator: ReturnType<Page['getByRole']>,
): Promise<string | null> {
  return locator.evaluate((element) => {
    const form = element.tagName === 'FORM' ? element : element.closest('form')
    if (form === null) return null

    const field = form.querySelector('input[name^="$ACTION_ID"]')
    return field === null ? null : field.getAttribute('name')
  })
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

/**
 * Wait until the public shell is actually **in the document**.
 *
 * `page.goto()` resolves on `load`, and on a streamed React 19 document that is too
 * early: the whole non-suspended shell — the announcement region, the header, `main`
 * and the footer — arrives inside `<body><div hidden>` and is moved into place by the
 * framework's own inline scripts a few milliseconds later. `document.readyState` is
 * already `"complete"` while that is still pending, so nothing about the navigation
 * says the body is populated.
 *
 * Every locator in {@link readAnnouncement} auto-waits for its element and is therefore
 * safe — **except `count()`, which answers immediately**. Asked one tick too early it
 * answers `0`, and the error is one-sided: it reports "there is no bar" on a page that
 * carries one. That is the whole of this suite's flakiness — a publish followed by a
 * guest read, or a poll waiting for the bar to *go*, resolving against a body that had
 * not been filled in yet.
 *
 * The footer is the anchor because it is the **last** element the public layout renders
 * (`app/(site)/layout.tsx`: announcement, header, main, footer): it is on every public
 * page whether or not there is an announcement, so waiting for it is not waiting for
 * the thing under test, and once it is in the document the announcement region's slot
 * has been filled in — with a bar, or with nothing.
 */
async function waitForPublicShell(page: Page): Promise<void> {
  await expect(page.getByRole('contentinfo')).toBeAttached()
}

/** Read the announcement region on whatever page `page` is currently showing. */
async function readAnnouncement(page: Page): Promise<GuestAnnouncement> {
  await waitForPublicShell(page)

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
