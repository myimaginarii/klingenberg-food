import { expect, type Browser, type Locator, type Page } from '@playwright/test'

import { waitForPublicShell } from './public-shell'

/**
 * Driving the Kontaktoplysninger editor, for the browser tests — design 1v, 1k, 1o,
 * 1g; phase 11B.
 */

export const CONTACT_ADMIN_PATH = '/admin/kontakt'

/** 1v's labels, by the row's column names. */
export const CONTACT_LABELS = {
  primary_phone: 'Primært telefonnummer',
  secondary_phone: 'Ekstra telefonnummer (valgfrit)',
  address_line1: 'Adresse',
  postal_code: 'Postnummer',
  city: 'By',
  email: 'E-mail (valgfrit)',
  facebook_url: 'Facebook',
} as const

export async function openContactAdmin(page: Page): Promise<void> {
  await page.goto(CONTACT_ADMIN_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kontaktoplysninger')
}

export function contactForm(page: Page): Locator {
  return page.getByRole('form', { name: 'Kontaktoplysninger', exact: true })
}

export async function contactVersion(page: Page): Promise<string> {
  return page.locator('input[name="version"]').first().inputValue()
}

export async function pressAndSettle(page: Page, press: () => Promise<void>): Promise<void> {
  const version = await contactVersion(page)
  const address = page.url()

  await press()

  await expect
    .poll(
      async () => {
        try {
          if ((await contactVersion(page)) !== version) return true
        } catch {
          return false
        }
        return page.url() !== address && /[?&](status|fejl)=/.test(page.url())
      },
      { message: 'the press never reached the server' },
    )
    .toBe(true)
}

/** Fill fields (by their visible labels) and press Gem. */
export async function saveContact(page: Page, fields: Record<string, string>): Promise<void> {
  const form = contactForm(page)

  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value)
  }

  await pressAndSettle(page, () => form.getByRole('button', { name: 'Gem' }).click())
}

/** The bar's "Offentliggør ændringer". */
export function publishButton(page: Page): Locator {
  return page.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ })
}

export async function publishContact(page: Page): Promise<void> {
  await openContactAdmin(page)
  const before = page.url()
  await publishButton(page).click()
  await page.waitForURL((url) => url.toString() !== before)
  await page.waitForURL(/kontakt\?.*status=/)
}

export function pendingBand(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: /venter på at blive offentliggjort/ })
}

export function statusNotice(page: Page): Locator {
  return page.getByRole('status').first()
}

// ---------------------------------------------------------------------------
// The guest's view — the contact facts wherever the public site prints them
// ---------------------------------------------------------------------------

export type ContactSnapshot = {
  /** The header's "Ring" href (desktop only; null below 1024 px). */
  readonly headerTelHref: string | null
  /** The persistent bottom bar's "Bestil" href (mobile only). */
  readonly bottomNavTelHref: string | null
  /** The footer's two numbers as printed, and their hrefs. */
  readonly footerPrimary: { text: string; href: string } | null
  readonly footerSecondary: { text: string; href: string } | null
  /** The footer's Facebook link, or null when the column is gone. */
  readonly footerFacebookHref: string | null
  /** The footer's address line. */
  readonly footerAddress: string | null
}

export type FindOsSnapshot = {
  readonly ringHref: string | null
  readonly primaryText: string | null
  readonly secondaryText: string | null
  readonly directionsHref: string | null
  readonly addressText: string | null
  readonly facebookHref: string | null
}

async function readShell(page: Page): Promise<ContactSnapshot> {
  await waitForPublicShell(page)

  const header = page.getByRole('banner')
  const footer = page.getByRole('contentinfo')
  const bottomNav = page.getByRole('navigation', { name: 'Genveje' })

  const headerTel = header.locator('a[href^="tel:"]').first()
  const bottomTel = bottomNav.locator('a[href^="tel:"]').first()
  const footerTels = footer.locator('address a[href^="tel:"]')
  const footerFacebook = footer.getByRole('link', { name: 'Facebook' })
  const footerAddress = footer.locator('address')

  const tel = async (locator: Locator) =>
    (await locator.count()) === 0 || !(await locator.first().isVisible())
      ? null
      : await locator.first().getAttribute('href')

  const footerLink = async (index: number) =>
    (await footerTels.count()) <= index
      ? null
      : {
          text: (await footerTels.nth(index).innerText()).trim(),
          href: (await footerTels.nth(index).getAttribute('href')) ?? '',
        }

  return {
    headerTelHref: await tel(headerTel),
    bottomNavTelHref: await tel(bottomTel),
    footerPrimary: await footerLink(0),
    footerSecondary: await footerLink(1),
    footerFacebookHref: (await footerFacebook.count()) === 0 ? null : await footerFacebook.getAttribute('href'),
    footerAddress: (await footerAddress.count()) === 0 ? null : (await footerAddress.innerText()).trim(),
  }
}

async function readFindOs(page: Page): Promise<FindOsSnapshot> {
  await waitForPublicShell(page)
  const main = page.getByRole('main')

  const ring = main.getByRole('link', { name: /^Ring/ }).first()
  const primary = main.locator('p.font-display.text-brand-700')
  const secondary = main.getByText('Ekstra nummer', { exact: false })
  const directions = main.locator('a[href*="google.com/maps/dir"]').first()
  const address = main.locator('address').first()
  const facebook = main.getByRole('link', { name: 'Facebook' })

  return {
    ringHref: (await ring.count()) === 0 ? null : await ring.getAttribute('href'),
    primaryText: (await primary.count()) === 0 ? null : (await primary.first().innerText()).trim(),
    secondaryText: (await secondary.count()) === 0 ? null : (await secondary.first().innerText()).trim(),
    directionsHref: (await directions.count()) === 0 ? null : await directions.getAttribute('href'),
    addressText: (await address.count()) === 0 ? null : (await address.innerText()).trim(),
    facebookHref: (await facebook.count()) === 0 ? null : await facebook.first().getAttribute('href'),
  }
}

/** The shell (header, footer, bottom bar) on `path`, read by a fresh guest: the FIRST request. */
export async function guestShell(browser: Browser, path = '/'): Promise<ContactSnapshot> {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(path)
    return await readShell(page)
  } finally {
    await context.close()
  }
}

/** Find os as a fresh guest reads it. */
export async function guestFindOs(browser: Browser): Promise<FindOsSnapshot> {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto('/find-os')
    return await readFindOs(page)
  } finally {
    await context.close()
  }
}

/** Find os through Draft Mode, as the signed-in Owner. Leaves Draft Mode again. */
export async function previewFindOs(page: Page): Promise<FindOsSnapshot & ContactSnapshot> {
  await page.goto('/api/preview/start?maal=find-os')
  await page.waitForURL((url) => url.pathname === '/find-os')
  await expect(page.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()

  const result = { ...(await readFindOs(page)), ...(await readShell(page)) }

  await page.goto('/api/preview/stop')
  await page.waitForURL(/\/admin/)

  return result
}
