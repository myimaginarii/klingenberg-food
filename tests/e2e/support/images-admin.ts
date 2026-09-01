import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, type Locator, type Page } from '@playwright/test'
import sharp from 'sharp'

/**
 * Driving the image library — design 1w, phase 10B.
 *
 * The helpers speak the screen's own language: accessible names, visible labels
 * and the status vocabulary the actions redirect with. The one deliberate
 * exception to "nothing reaches the database" is the usage fixture: no editor
 * owns `image_id` before 10C, so pointing a dish at an image has no UI to drive —
 * the suite performs that one write through PostgREST with the staff member's own
 * JWT, which is a write the §5 matrix genuinely grants them today, and restores
 * it the same way.
 */

export const IMAGES_ADMIN_PATH = '/admin/billeder'

/** The Supabase credentials, resolved the way the application resolves them. */
function loadLocalEnv(): void {
  // Playwright runs from the config's own directory — the repository root.
  const envFile = resolve(process.cwd(), '.env.local')
  if (!existsSync(envFile)) return

  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]!] === undefined) {
      process.env[match[1]!] = match[2]!
    }
  }
}

/**
 * A PostgREST client signed in as the local staff identity — the usage fixture's
 * one door, and the suite's way of asserting stored rows the screen deliberately
 * never shows (a stored width proves the client downscale ran; no pixel figure is
 * ever on screen to read instead).
 */
export async function staffRestClient(): Promise<SupabaseClient> {
  loadLocalEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('The image-library suite needs the local Supabase URL and anon key.')
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: 'staff@example.test',
    password: 'LocalStaff12345',
  })
  if (error) {
    throw new Error(`Could not sign in as staff@example.test (${error.message}).`)
  }

  return client
}

export async function openImagesAdmin(page: Page): Promise<void> {
  await page.goto(IMAGES_ADMIN_PATH)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Billeder')
}

/** The main dropzone's file input, by its stable element id. */
export function uploadInput(page: Page): Locator {
  return page.locator('#billede-upload')
}

/** The replace panel's own file input. */
export function replaceInput(page: Page): Locator {
  return page.locator('#erstat-upload')
}

/** The uploader's polite status sentence. */
export function uploadStatus(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: /./ }).first()
}

/** One grid card, by the accessible name the library gives it. */
export function gridCard(page: Page, name: string | RegExp): Locator {
  return page.getByRole('link', { name })
}

/** The image id the detail panel is open for, read from the address. */
export function selectedImageId(page: Page): string {
  const id = new URL(page.url()).searchParams.get('billede')
  expect(id, `the address names an open image: ${page.url()}`).not.toBeNull()
  return id!
}

/** A run-time JPEG fixture — a smooth gradient, so bytes stay small at any size. */
export async function jpegFixture(width: number, height: number, hue = 30): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120 + hue, g: 60 + Math.round(hue / 2), b: 45 },
    },
  })
    .jpeg({ quality: 88 })
    .toBuffer()
}

/**
 * Choose a file in the main dropzone and wait for the finished upload to land the
 * screen on the new image's detail panel.
 */
export async function uploadViaUi(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<string> {
  await uploadInput(page).setInputFiles(file)
  await page.waitForURL(/status=uploadet/, { timeout: 30_000 })
  await expect(page.getByText('Billedet er uploadet og ligger i biblioteket.')).toBeVisible()
  return selectedImageId(page)
}

/** The detail panel's description field. */
export function altField(page: Page): Locator {
  return page.getByLabel('Beskrivelse af billedet')
}

/** Save the open image's description and wait for the named outcome. */
export async function saveAlt(
  page: Page,
  text: string,
  expected: RegExp = /status=tekst_gemt/,
): Promise<void> {
  await altField(page).fill(text)
  await page.getByRole('button', { name: 'Gem beskrivelse' }).click()
  await page.waitForURL(expected)
}

/** Open the delete confirmation for the open image. Nothing has happened yet. */
export async function openDeleteDialog(page: Page): Promise<Locator> {
  await page.getByRole('link', { name: 'Slet', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Slet billedet?')
  return dialog
}

/** Confirm the open delete dialog and wait for the outcome. */
export async function confirmDelete(page: Page, expected: RegExp = /status=slettet/): Promise<void> {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Slet billede/ })
    .click()
  await page.waitForURL(expected)
}

/** Delete the image whose card carries `name`, through the real confirmation. */
export async function deleteImageNamed(page: Page, name: string | RegExp): Promise<void> {
  await openImagesAdmin(page)
  await gridCard(page, name).click()
  await expect(page.getByRole('link', { name: 'Slet', exact: true })).toBeVisible()
  await openDeleteDialog(page)
  await confirmDelete(page)
}

// ---------------------------------------------------------------------------
// The editors' picker (phase 10C-1) — shared by the editor and public-image suites
// ---------------------------------------------------------------------------

/** The picker dialog, by its stable element id (its heading names it for people). */
export function pickerDialog(page: Page): Locator {
  return page.locator('#vaelg-billede-dialog')
}

/** The slot's way in — 1ag/1ah/1s's "Vælg billede", or 1r's chosen-state sibling. */
export function chooseLink(page: Page): Locator {
  return page.getByRole('link', { name: /^(Vælg billede|Skift billede)/ })
}

/** Open the picker on the current editor and choose the image whose button matches. */
export async function choose(page: Page, imageName: RegExp): Promise<void> {
  await chooseLink(page).click()
  await expect(pickerDialog(page)).toBeVisible()
  await pickerDialog(page).getByRole('button', { name: imageName }).click()
  await page.waitForURL(/status=billede_gemt/)
}

/** "Fjern billede" on the current editor — a pending removal, never a deletion. */
export async function removeSelection(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Fjern billede' }).click()
  await page.waitForURL(/status=billede_fjernet/)
}
