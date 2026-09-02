import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, type Browser, type Locator, type Page } from '@playwright/test'

import { waitForPublicShell } from './public-shell'

/**
 * Driving the Forsiden editor, for the browser tests — design 1u, phase 11A.
 *
 * Everything on that screen is a link or a form, so these helpers do what a person
 * does: follow a link, fill fields, press a button, wait for the redirect the Server
 * Action performs. No selector reaches for a class name or a test id — the screen is
 * addressed the way a screen reader addresses it.
 *
 * The one thing that reaches the database is the Owner's REST client, used to read
 * back stored state the screen deliberately never shows (the raw document) and to
 * prove a Staff JWT cannot write the row at all.
 */

export const HOME_ADMIN_PATH = '/admin/forsiden'

/** The four cards, by the eyebrows 1u draws and their forms' accessible names. */
export const HOME_CARDS = {
  hero: 'Øverst på siden',
  award: 'Udmærkelsen',
  featured: 'Udvalgte burgere (vælg 3)',
  about: 'Om os (uddrag)',
} as const

/** The three image slots' choose/change controls, by their stable ids. */
export const HOME_SLOT_ANCHOR = {
  hero: '#vaelg-billede-oeverst-paa-siden',
  award: '#vaelg-billede-udmaerkelsen',
  about: '#vaelg-billede-om-os-uddrag',
} as const

function loadLocalEnv(): void {
  const envFile = resolve(process.cwd(), '.env.local')
  if (!existsSync(envFile)) return

  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]!] === undefined) {
      process.env[match[1]!] = match[2]!
    }
  }
}

async function restClient(email: string, password: string): Promise<SupabaseClient> {
  loadLocalEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('The homepage suite needs the local Supabase URL and anon key.')
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Could not sign in as ${email} (${error.message}).`)

  return client
}

/** A PostgREST client signed in as the local owner identity. */
export async function ownerRestClient(): Promise<SupabaseClient> {
  return restClient('owner@example.test', 'LocalOwner12345')
}

export async function openHomeAdmin(page: Page): Promise<void> {
  await page.goto(HOME_ADMIN_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rediger forsiden')
}

/** One card's form, by its accessible name. */
export function homeForm(page: Page, card: string): Locator {
  return page.getByRole('form', { name: card, exact: true })
}

/** The version token the screen currently carries. */
export async function homeVersion(page: Page): Promise<string> {
  return page.locator('input[name="version"]').first().inputValue()
}

/**
 * Press a control and wait until the server has actually answered — a new version
 * token, or a refusal in the address (the monthly suite's `pressAndSettle`, restated).
 */
export async function pressAndSettle(page: Page, press: () => Promise<void>): Promise<void> {
  const version = await homeVersion(page)
  const address = page.url()

  await press()

  await expect
    .poll(
      async () => {
        try {
          if ((await homeVersion(page)) !== version) return true
        } catch {
          return false
        }
        return page.url() !== address && /[?&](status|fejl)=/.test(page.url())
      },
      { message: 'the press never reached the server' },
    )
    .toBe(true)
}

/** Fill one card's two fields (by their visible labels) and press its Gem. */
export async function saveCard(
  page: Page,
  card: string,
  fields: Record<string, string>,
): Promise<void> {
  const form = homeForm(page, card)

  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value)
  }

  await pressAndSettle(page, () => form.getByRole('button', { name: 'Gem' }).click())
}

/** The bar's "Offentliggør ændringer". Waits for the address to change. */
export async function pressPublish(page: Page): Promise<void> {
  const before = page.url()
  // "Offentliggør ændringer" from `md`; the phone bar keeps the short word (1y).
  await page.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ }).click()
  await page.waitForURL((url) => url.toString() !== before)
}

export async function publishHome(page: Page): Promise<void> {
  await openHomeAdmin(page)
  await pressPublish(page)
  await page.waitForURL(/forsiden\?.*status=/)
}

/** The pending band, which names the sections that are waiting. */
export function pendingBand(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: /venter på at blive offentliggjort/ })
}

/** The status sentence the last action redirected back with. */
export function statusNotice(page: Page): Locator {
  return page.getByRole('status').first()
}

// ---------------------------------------------------------------------------
// The image slots (the 10C-1 picker pair, three times on one screen)
// ---------------------------------------------------------------------------

export function pickerDialog(page: Page): Locator {
  return page.locator('#vaelg-billede-dialog')
}

/** Open a slot's picker and choose the image whose button matches. */
export async function chooseSlotImage(
  page: Page,
  slot: keyof typeof HOME_SLOT_ANCHOR,
  imageName: RegExp,
): Promise<void> {
  await page.locator(HOME_SLOT_ANCHOR[slot]).click()
  await expect(pickerDialog(page)).toBeVisible()
  await pickerDialog(page).getByRole('button', { name: imageName }).click()
  await page.waitForURL(/status=billede_gemt/)
}

/** The slot's card (the section it sits in), for scoping "Fjern billede". */
export function slotCard(page: Page, card: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('form', { name: card, exact: true }) })
}

/** "Fjern billede" inside one card — a pending removal, never a deletion. */
export async function removeSlotImage(page: Page, card: string): Promise<void> {
  await slotCard(page, card).getByRole('button', { name: 'Fjern billede' }).click()
  await page.waitForURL(/status=billede_fjernet/)
}

// ---------------------------------------------------------------------------
// The featured list and the dish picker
// ---------------------------------------------------------------------------

export function dishPicker(page: Page): Locator {
  return page.locator('#vaelg-ret-dialog')
}

/** The featured slots' dish names, in order, as the card shows them. */
export async function featuredNames(page: Page): Promise<string[]> {
  // The card is in the document before its list is asked about — `count()` answers
  // at once, and an empty list is a real state (no slot left), not a timing gap.
  await expect(page.getByRole('heading', { name: HOME_CARDS.featured })).toBeVisible()

  const items = page.getByRole('list', { name: 'Udvalgte retter' }).getByRole('listitem')
  if ((await items.count()) === 0) return []

  const names: string[] = []
  for (const item of await items.all()) {
    names.push((await item.locator('p.font-semibold').first().innerText()).trim())
  }
  return names
}

/** "+ Vælg en burger fra menuen" → pick the named dish for the next free slot. */
export async function addFeatured(page: Page, dish: string): Promise<void> {
  await page.locator('#vaelg-ret-ny').click()
  await expect(dishPicker(page)).toBeVisible()
  // Settled on the version token, not on the address: two adds in a row land on the
  // same `status=`, and a pattern would match the page the press started from.
  await pressAndSettle(page, () =>
    dishPicker(page).getByRole('button', { name: new RegExp(`^${dish}$`) }).click(),
  )
  await expect(page).toHaveURL(/status=ret_tilfoejet/)
}

/** A slot's Fjern / Flyt op / Flyt ned, by the words and the slot's own name. */
export async function pressFeatured(
  page: Page,
  control: 'Fjern' | 'Flyt op' | 'Flyt ned',
  index: number,
  expected: RegExp,
): Promise<void> {
  await pressAndSettle(page, () =>
    homeForm(page, HOME_CARDS.featured)
      .getByRole('button', { name: new RegExp(`^${control} plads ${index + 1}`) })
      .click(),
  )
  await expect(page).toHaveURL(expected)
}

// ---------------------------------------------------------------------------
// The guest's view, and the Draft Mode preview
// ---------------------------------------------------------------------------

const MEDIA = '/storage/v1/object/public/media/'

export type HomeSnapshot = {
  readonly heading: string
  readonly intro: string | null
  readonly awardTitle: string
  readonly aboutHeading: string | null
  /** The hero `<picture>`'s WebP src, or null for the reserved frame. */
  readonly heroSrc: string | null
  readonly awardSrc: string | null
  readonly aboutSrc: string | null
  /** "Tre fra menuen" card headings, in order; empty when the section is absent. */
  readonly featured: string[]
  /** The dynamic sections are still there: the Besøg panel's opening hours. */
  readonly hasOpeningHours: boolean
}

async function snapshot(page: Page): Promise<HomeSnapshot> {
  const hero = page.locator('section[aria-labelledby="forside-titel"]')
  const award = page.locator('section[aria-labelledby="udmaerkelse-titel"]')
  const about = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Om os' }) }).first()

  const srcOf = async (scope: Locator): Promise<string | null> => {
    const img = scope.locator(`picture img[src*="${MEDIA}"]`)
    return (await img.count()) === 0 ? null : img.first().getAttribute('src')
  }

  const introText = hero.locator('p.max-w-\\[44ch\\]')
  const aboutHeading = about.locator('h3')
  const featured = page.getByRole('region', { name: 'Tre fra menuen' })

  return {
    heading: (await page.locator('h1#forside-titel').innerText()).trim(),
    intro: (await introText.count()) === 0 ? null : (await introText.innerText()).trim(),
    awardTitle: (await page.locator('h2#udmaerkelse-titel').innerText()).trim(),
    aboutHeading: (await aboutHeading.count()) === 0 ? null : (await aboutHeading.first().innerText()).trim(),
    heroSrc: await srcOf(hero),
    awardSrc: await srcOf(award),
    aboutSrc: await srcOf(about),
    featured:
      (await featured.count()) === 0
        ? []
        : await featured.getByRole('listitem').getByRole('heading').allInnerTexts(),
    hasOpeningHours: (await page.getByRole('heading', { name: 'Åbningstider' }).count()) > 0,
  }
}

/** The Forside as a guest reads it — a fresh, cookie-free context: the FIRST request. */
export async function guestHome(browser: Browser): Promise<HomeSnapshot> {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto('/')
    await waitForPublicShell(page)
    return await snapshot(page)
  } finally {
    await context.close()
  }
}

/** The Forside through Draft Mode, as the signed-in owner. Leaves Draft Mode again. */
export async function previewHome(page: Page): Promise<HomeSnapshot> {
  await page.goto('/api/preview/start?maal=forside')
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()

  const result = await snapshot(page)

  await page.goto('/api/preview/stop')
  await page.waitForURL(/\/admin/)

  return result
}
