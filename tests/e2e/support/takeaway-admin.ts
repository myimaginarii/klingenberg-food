import { expect, type Browser, type Locator, type Page } from '@playwright/test'

import { waitForPublicShell } from './public-shell'

/**
 * Driving the Mad ud af huset editor, for the browser tests — design 1aj, 1ai;
 * phase 11B.
 *
 * Everything on that screen is a link or a form, so these helpers do what a person
 * does: follow a link, fill fields, press a button, wait for the redirect the Server
 * Action performs. No selector reaches for a class name or a test id — the screen is
 * addressed the way a screen reader addresses it.
 */

export const TAKEAWAY_ADMIN_PATH = '/admin/mad-ud-af-huset'
export const TAKEAWAY_PUBLIC_PATH = '/mad-ud-af-huset'

/** The four cards, by the eyebrows 1aj draws and their forms' accessible names. */
export const TAKEAWAY_CARDS = {
  visibility: 'Vis siden på hjemmesiden',
  text: 'Tekst',
  sections: 'Tekstafsnit',
  cta: 'Knap nederst',
} as const

/** The image slot's choose/change control, by its stable id. */
export const TAKEAWAY_SLOT_ANCHOR = '#vaelg-billede'

export async function openTakeawayAdmin(page: Page): Promise<void> {
  await page.goto(TAKEAWAY_ADMIN_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mad ud af huset')
}

/** One card's form, by its accessible name. */
export function takeawayForm(page: Page, card: string): Locator {
  return page.getByRole('form', { name: card, exact: true })
}

/** The version token the screen currently carries. */
export async function takeawayVersion(page: Page): Promise<string> {
  return page.locator('input[name="version"]').first().inputValue()
}

/** Press a control and wait until the server has actually answered. */
export async function pressAndSettle(page: Page, press: () => Promise<void>): Promise<void> {
  const version = await takeawayVersion(page)
  const address = page.url()

  await press()

  await expect
    .poll(
      async () => {
        try {
          if ((await takeawayVersion(page)) !== version) return true
        } catch {
          return false
        }
        return page.url() !== address && /[?&](status|fejl)=/.test(page.url())
      },
      { message: 'the press never reached the server' },
    )
    .toBe(true)
}

/** Fill one card's fields (by their visible labels) and press its Gem. */
export async function saveTakeawayCard(
  page: Page,
  card: string,
  fields: Record<string, string>,
  button = 'Gem',
): Promise<void> {
  const form = takeawayForm(page, card)

  // By role and computed name rather than `getByLabel`: a section's fields point at
  // the section's heading as well as their own label, so the name a person hears is
  // "Afsnit 2 Overskrift på afsnittet" (the Tapas suite's arrangement).
  for (const [name, value] of Object.entries(fields)) {
    await form.getByRole('textbox', { name, exact: true }).fill(value)
  }

  await pressAndSettle(page, () => form.getByRole('button', { name: button, exact: true }).click())
}

/** Move 1aj's switch to the requested state and press Gem. */
export async function saveTakeawayVisibility(page: Page, visible: boolean): Promise<void> {
  const form = takeawayForm(page, TAKEAWAY_CARDS.visibility)
  const toggle = form.getByRole('checkbox')
  const id = await toggle.getAttribute('id')
  expect(id).not.toBeNull()

  if ((await toggle.isChecked()) !== visible) {
    // The input is `sr-only` behind the label that draws the track; clicking the
    // label is what a pointer would hit.
    await form.locator(`label[for="${id}"]`).last().click()
  }
  await expect(toggle).toBeChecked({ checked: visible })

  await pressAndSettle(page, () => form.getByRole('button', { name: 'Gem' }).click())
}

/** A section control by its words and position: "Fjern afsnit 2", "Flyt op afsnit 3". */
export async function pressSection(
  page: Page,
  control: 'Fjern' | 'Flyt op' | 'Flyt ned',
  index: number,
  expected: RegExp,
): Promise<void> {
  await pressAndSettle(page, () =>
    takeawayForm(page, TAKEAWAY_CARDS.sections)
      .getByRole('button', { name: new RegExp(`^${control} afsnit ${index + 1}$`) })
      .click(),
  )
  await expect(page).toHaveURL(expected)
}

/** "+ Tilføj tekstafsnit". */
export async function addSection(page: Page): Promise<void> {
  await pressAndSettle(page, () =>
    takeawayForm(page, TAKEAWAY_CARDS.sections).getByRole('button', { name: '+ Tilføj tekstafsnit' }).click(),
  )
  await expect(page).toHaveURL(/status=afsnit_tilfoejet/)
}

/** The section blocks' headings, as typed in the fields, in order. */
export async function sectionHeadings(page: Page): Promise<string[]> {
  const form = takeawayForm(page, TAKEAWAY_CARDS.sections)
  const fields = form.getByRole('textbox', { name: /^Afsnit \d+ Overskrift på afsnittet$/ })
  if ((await fields.count()) === 0) return []
  const values: string[] = []
  for (const field of await fields.all()) values.push(await field.inputValue())
  return values
}

/** The section blocks' texts, as typed in the fields, in order. */
export async function sectionBodies(page: Page): Promise<string[]> {
  const form = takeawayForm(page, TAKEAWAY_CARDS.sections)
  const fields = form.getByRole('textbox', { name: /^Afsnit \d+ Skriv afsnittet her$/ })
  if ((await fields.count()) === 0) return []
  const values: string[] = []
  for (const field of await fields.all()) values.push(await field.inputValue())
  return values
}

/** The bar's "Offentliggør ændringer"; waits for the redirect. */
export async function publishTakeaway(page: Page): Promise<void> {
  await openTakeawayAdmin(page)
  const before = page.url()
  await page.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ }).click()
  await page.waitForURL((url) => url.toString() !== before)
  await page.waitForURL(/mad-ud-af-huset\?.*status=/)
}

/** The pending band, which names the cards that are waiting. */
export function pendingBand(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: /venter på at blive offentliggjort/ })
}

/** The status sentence the last action redirected back with. */
export function statusNotice(page: Page): Locator {
  return page.getByRole('status').first()
}

export function pickerDialog(page: Page): Locator {
  return page.locator('#vaelg-billede-dialog')
}

/** Open the slot's picker and choose the image whose button matches. */
export async function chooseTakeawayImage(page: Page, imageName: RegExp): Promise<void> {
  await page.locator(TAKEAWAY_SLOT_ANCHOR).click()
  await expect(pickerDialog(page)).toBeVisible()
  await pickerDialog(page).getByRole('button', { name: imageName }).click()
  await page.waitForURL(/status=billede_gemt/)
}

/** The text card's section, for scoping "Fjern billede". */
export function textCard(page: Page): Locator {
  return page.locator('section').filter({ has: takeawayForm(page, TAKEAWAY_CARDS.text) })
}

export async function removeTakeawayImage(page: Page): Promise<void> {
  await textCard(page).getByRole('button', { name: 'Fjern billede' }).click()
  await page.waitForURL(/status=billede_fjernet/)
}

// ---------------------------------------------------------------------------
// The guest's view, and the Draft Mode preview
// ---------------------------------------------------------------------------

const MEDIA = '/storage/v1/object/public/media/'

export type TakeawaySnapshot = {
  /** 200 while the page is switched on, 404 while it is off. */
  readonly status: number
  readonly heading: string | null
  readonly intro: string | null
  /** The section cards' headings, in order. */
  readonly sections: string[]
  /** The page's own `<picture>` WebP src, or null for no image. */
  readonly imageSrc: string | null
  /** The primary call's label and href. */
  readonly ctaLabel: string | null
  readonly ctaHref: string | null
  /** Whether the footer's "Sider" column lists the page — the navigation at every width. */
  readonly inFooterNav: boolean
  /** Whether the desktop bar lists it (only meaningful at ≥1024 px). */
  readonly inDesktopNav: boolean
}

async function snapshot(page: Page, status: number): Promise<TakeawaySnapshot> {
  await waitForPublicShell(page)

  const main = page.getByRole('main')
  const h1 = main.getByRole('heading', { level: 1 })
  const intro = main.locator('p.max-w-\\[50ch\\]')
  const sections = main.locator('article h3')
  const img = main.locator(`picture img[src*="${MEDIA}"]`)
  const cta = main.locator('a[href^="tel:"]').first()

  const footerNav = page.getByRole('navigation', { name: 'Sider i bunden' })
  const desktopNav = page.getByRole('navigation', { name: 'Hovedmenu' })

  return {
    status,
    heading: (await h1.count()) === 0 ? null : (await h1.first().innerText()).trim(),
    intro: (await intro.count()) === 0 ? null : (await intro.first().innerText()).trim(),
    sections: (await sections.count()) === 0 ? [] : (await sections.allInnerTexts()).map((text) => text.trim()),
    imageSrc: (await img.count()) === 0 ? null : await img.first().getAttribute('src'),
    ctaLabel: (await cta.count()) === 0 ? null : (await cta.innerText()).trim().split('\n')[0] ?? null,
    ctaHref: (await cta.count()) === 0 ? null : await cta.getAttribute('href'),
    inFooterNav: (await footerNav.getByRole('link', { name: 'Mad ud af huset' }).count()) > 0,
    inDesktopNav: (await desktopNav.getByRole('link', { name: 'Mad ud af huset' }).count()) > 0,
  }
}

/** The page as a guest reads it — a fresh, cookie-free context: the FIRST request. */
export async function guestTakeaway(browser: Browser): Promise<TakeawaySnapshot> {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    const response = await page.goto(TAKEAWAY_PUBLIC_PATH)
    return await snapshot(page, response?.status() ?? 0)
  } finally {
    await context.close()
  }
}

/** Whether the sitemap offers the page, read by a fresh guest. */
export async function sitemapListsTakeaway(browser: Browser): Promise<boolean> {
  const context = await browser.newContext()
  try {
    const response = await context.request.get('/sitemap.xml')
    expect(response.status()).toBe(200)
    return (await response.text()).includes(TAKEAWAY_PUBLIC_PATH)
  } finally {
    await context.close()
  }
}

/** The page through Draft Mode, as the signed-in staff member. Leaves Draft Mode again. */
export async function previewTakeaway(page: Page): Promise<TakeawaySnapshot> {
  const response = await page.goto('/api/preview/start?maal=mad-ud-af-huset')
  await page.waitForURL((url) => url.pathname === TAKEAWAY_PUBLIC_PATH)
  await expect(page.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()

  const result = await snapshot(page, response?.status() ?? 0)

  await page.goto('/api/preview/stop')
  await page.waitForURL(/\/admin/)

  return result
}
