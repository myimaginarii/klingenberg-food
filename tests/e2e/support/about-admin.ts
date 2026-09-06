import { expect, type Browser, type Locator, type Page } from '@playwright/test'

import { waitForPublicShell } from './public-shell'

/**
 * Driving the Om os editor, for the browser tests — design 1i; phase 14B1.
 *
 * Everything on that screen is a link or a form, so these helpers do what a person
 * does: follow a link, fill fields, press a button, wait for the redirect the Server
 * Action performs. No selector reaches for a class name or a test id — the screen is
 * addressed the way a screen reader addresses it.
 */

export const ABOUT_ADMIN_PATH = '/admin/om-os'
export const ABOUT_PUBLIC_PATH = '/om-os'

/** The three cards, by their eyebrows and their forms' accessible names. */
export const ABOUT_CARDS = {
  story: 'Historien',
  team: 'Holdet',
  method: 'Køkken og tilberedning',
} as const

/** The three image slots' choose/change controls, by their stable ids. */
export const ABOUT_SLOT_ANCHOR = {
  sted: '#vaelg-billede-sted',
  holdet: '#vaelg-billede-holdet',
  koekken: '#vaelg-billede-koekken',
} as const

export type AboutSlot = keyof typeof ABOUT_SLOT_ANCHOR

export async function openAboutAdmin(page: Page): Promise<void> {
  await page.goto(ABOUT_ADMIN_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Om os')
}

/** One card's form, by its accessible name. */
export function aboutForm(page: Page, card: string): Locator {
  return page.getByRole('form', { name: card, exact: true })
}

/** The version token the screen currently carries. */
export async function aboutVersion(page: Page): Promise<string> {
  return page.locator('input[name="version"]').first().inputValue()
}

/** Press a control and wait until the server has actually answered. */
export async function pressAndSettle(page: Page, press: () => Promise<void>): Promise<void> {
  const version = await aboutVersion(page)
  const address = page.url()

  await press()

  await expect
    .poll(
      async () => {
        try {
          if ((await aboutVersion(page)) !== version) return true
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
export async function saveAboutCard(page: Page, card: string, fields: Record<string, string>): Promise<void> {
  const form = aboutForm(page, card)

  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value)
  }

  await pressAndSettle(page, () => form.getByRole('button', { name: 'Gem', exact: true }).click())
}

/** The bar's "Offentliggør ændringer"; waits for the redirect. */
export async function publishAbout(page: Page): Promise<void> {
  await openAboutAdmin(page)
  const before = page.url()
  await page.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ }).click()
  await page.waitForURL((url) => url.toString() !== before)
  await page.waitForURL(/om-os\?.*status=/)
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

/** Open a slot's picker and choose the image whose button matches. */
export async function chooseSlotImage(page: Page, slot: AboutSlot, imageName: RegExp): Promise<void> {
  await page.locator(ABOUT_SLOT_ANCHOR[slot]).click()
  await expect(pickerDialog(page)).toBeVisible()
  await pickerDialog(page).getByRole('button', { name: imageName }).click()
  await page.waitForURL(/status=billede_gemt/)
}

/** The slot's card (the section it sits in), for scoping "Fjern billede". */
export function slotCard(page: Page, card: string): Locator {
  return page.locator('section').filter({ has: aboutForm(page, card) })
}

/** "Fjern billede" inside one card — a pending removal, never a deletion. */
export async function removeSlotImage(page: Page, card: string): Promise<void> {
  await slotCard(page, card).getByRole('button', { name: 'Fjern billede' }).click()
  await page.waitForURL(/status=billede_fjernet/)
}

// ---------------------------------------------------------------------------
// The guest's view, and the Draft Mode preview
// ---------------------------------------------------------------------------

const MEDIA = '/storage/v1/object/public/media/'

export type AboutImageSnapshot = { readonly src: string; readonly alt: string } | null

export type AboutSnapshot = {
  readonly heading: string
  /** The story's paragraphs, in order. */
  readonly story: string[]
  readonly teamText: string | null
  readonly methodHeading: string
  readonly methodText: string | null
  /** Each slot's `<picture>` WebP src and alt, or null for the reserved frame. */
  readonly venue: AboutImageSnapshot
  readonly team: AboutImageSnapshot
  readonly kitchen: AboutImageSnapshot
  /** Whether any served image address names the private originals bucket. */
  readonly namesOriginal: boolean
}

async function imageOf(scope: Locator): Promise<AboutImageSnapshot> {
  const img = scope.locator(`picture img[src*="${MEDIA}"]`)
  if ((await img.count()) === 0) return null
  return {
    src: (await img.first().getAttribute('src')) ?? '',
    alt: (await img.first().getAttribute('alt')) ?? '',
  }
}

async function snapshot(page: Page): Promise<AboutSnapshot> {
  await waitForPublicShell(page)

  const main = page.getByRole('main')
  const storyContainer = main.locator('> div').first()
  const teamSection = main.locator('section[aria-labelledby="om-os-holdet"]')
  const methodSection = main.locator('section[aria-labelledby="om-os-metode"]')

  const story = storyContainer.locator('p.max-w-\\[52ch\\]')
  const teamText = teamSection.locator('p.max-w-\\[62ch\\]')
  const methodText = methodSection.locator('p.max-w-\\[48ch\\]')

  return {
    heading: (await main.getByRole('heading', { level: 1 }).innerText()).trim(),
    story: (await story.count()) === 0 ? [] : (await story.allInnerTexts()).map((text) => text.trim()),
    teamText: (await teamText.count()) === 0 ? null : (await teamText.first().innerText()).trim(),
    methodHeading: (await main.locator('h2#om-os-metode').innerText()).trim(),
    methodText: (await methodText.count()) === 0 ? null : (await methodText.first().innerText()).trim(),
    venue: await imageOf(storyContainer),
    team: await imageOf(teamSection),
    kitchen: await imageOf(methodSection),
    namesOriginal: (await main.locator('img[src*="media-originals"], source[srcset*="media-originals"]').count()) > 0,
  }
}

/** The page as a guest reads it — a fresh, cookie-free context: the FIRST request. */
export async function guestAbout(browser: Browser): Promise<AboutSnapshot> {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    const response = await page.goto(ABOUT_PUBLIC_PATH)
    expect(response?.status()).toBe(200)
    return await snapshot(page)
  } finally {
    await context.close()
  }
}

/** The page through Draft Mode, as the signed-in staff member. Leaves Draft Mode again. */
export async function previewAbout(page: Page): Promise<AboutSnapshot> {
  await page.goto('/api/preview/start?maal=om-os')
  await page.waitForURL((url) => url.pathname === ABOUT_PUBLIC_PATH)
  await expect(page.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()

  const result = await snapshot(page)

  await page.goto('/api/preview/stop')
  await page.waitForURL(/\/admin/)

  return result
}
