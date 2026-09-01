import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  altField,
  confirmDelete,
  gridCard,
  jpegFixture,
  openDeleteDialog,
  openImagesAdmin,
  replaceInput,
  saveAlt,
  selectedImageId,
  staffRestClient,
  uploadInput,
  uploadViaUi,
  IMAGES_ADMIN_PATH,
} from './support/images-admin'

/**
 * The image library — design 1w; phase 10B; technical plan §1 (adjustments 2–3),
 * §4, §5, §8, §15.
 *
 * The promise this suite exists for: **a staff member's photo goes through the
 * whole 10A pipeline from the real screen — downscaled in the browser, uploaded
 * to one signed address, validated and re-encoded on the server — and the library
 * then manages it honestly: the description is the one edit, usage is stated
 * wherever the image is referenced, deletion asks and takes the references with
 * it atomically, and replacement never destroys the old image before the new one
 * is ready.**
 *
 * It runs in order and shares one signed-in page, because it is one story. Both
 * dedicated projects run it — 375 first, then 1440 — and it restores what it
 * touches: every image it creates it also deletes through the real Slet flow (the
 * only flow that also removes the files), and the one fixture write no UI can
 * perform before 10C — pointing Thor at an image — is made and unmade through
 * PostgREST with the staff member's own JWT.
 */

test.describe.configure({ mode: 'serial' })

/** WCAG 2.2 A and AA, the same bar every other screen is held to. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

let staffPage: Page
let rest: SupabaseClient

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow, 'the screen does not scroll sideways').toBe(false)
}

/** Walk the keyboard to a control — bounded, so a broken tab order fails loudly. */
async function tabUntilFocused(page: Page, target: Locator, maxTabs = 80): Promise<void> {
  for (let presses = 0; presses < maxTabs; presses += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
      return
    }
    await page.keyboard.press('Tab')
  }
  throw new Error('the control was never reached by keyboard')
}

/** The dish fixture: point Thor at an image, or clear it, via the staff JWT. */
async function pointThorAt(imageId: string | null): Promise<void> {
  const { error } = await rest.from('dishes').update({ image_id: imageId }).eq('name', 'Thor')
  expect(error, `pointing Thor at ${imageId}: ${error?.message}`).toBeNull()
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
  rest = await staffRestClient()
})

test.afterAll(async () => {
  // Best-effort restoration even after a failure: the reference cleared, so the
  // seeded menu is exactly as the suite found it.
  await rest.from('dishes').update({ image_id: null }).eq('name', 'Thor')
  await rest.auth.signOut()
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// The way in, and the empty library
// ---------------------------------------------------------------------------

test('the dashboard leads to the image library', async () => {
  await staffPage.goto('/admin')
  await staffPage.getByRole('link', { name: 'Åbn billederne' }).click()

  await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Billeder')
})

test('the empty library states itself, with the chooser ready', async () => {
  await openImagesAdmin(staffPage)

  await expect(
    staffPage.getByText('Der er ingen billeder endnu. Det første, du uploader, vises her.'),
  ).toBeVisible()
  await expect(staffPage.getByText('Træk billeder hertil')).toBeVisible()
  await expect(uploadInput(staffPage)).toBeEnabled()

  await noSidewaysScroll(staffPage)
  expect(await violations(staffPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// Refusals, before anything exists
// ---------------------------------------------------------------------------

test('a file that is not an accepted image type is refused in Danish', async () => {
  await openImagesAdmin(staffPage)

  await uploadInput(staffPage).setInputFiles({
    name: 'menu.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('ikke et billede'),
  })

  await expect(
    staffPage.getByText('Billedtypen understøttes ikke. Brug JPEG, PNG eller WebP.'),
  ).toBeVisible()
  // Nothing travelled and nothing was created: the empty state stands.
  await expect(staffPage.getByText('Der er ingen billeder endnu', { exact: false })).toBeVisible()
})

test('bytes that are not an image are refused without an upload', async () => {
  await openImagesAdmin(staffPage)

  await uploadInput(staffPage).setInputFiles({
    name: 'oedelagt.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('definitivt ikke en JPEG'),
  })

  await expect(
    staffPage.getByText(
      'Filen ser ikke ud til at være et billede. Vælg et JPEG-, PNG- eller WebP-billede.',
    ),
  ).toBeVisible()
})

test('an image over the size cap is refused with the size sentence', async () => {
  await openImagesAdmin(staffPage)

  // A real, decodable JPEG padded past 10 MiB: small enough in pixels that the
  // browser never downscales it, so the original's declared size is what the
  // server judges — and refuses.
  const jpeg = await jpegFixture(800, 600)
  const oversized = Buffer.concat([jpeg, Buffer.alloc(11 * 1024 * 1024)])

  await uploadInput(staffPage).setInputFiles({
    name: 'kaempe.jpg',
    mimeType: 'image/jpeg',
    buffer: oversized,
  })

  await expect(
    staffPage.getByText('Billedet fylder for meget. Det må højst fylde 10 MB.'),
  ).toBeVisible()
})

// ---------------------------------------------------------------------------
// The real upload — downscale, pipeline, first thumbnail
// ---------------------------------------------------------------------------

let firstImageId: string

test('a camera-sized photo uploads through the whole pipeline', async () => {
  await openImagesAdmin(staffPage)

  const photo = await jpegFixture(4000, 2600, 60)
  await uploadInput(staffPage).setInputFiles({
    name: 'burger-tæt-på.jpg',
    mimeType: 'image/jpeg',
    buffer: photo,
  })

  // While the attempt is in flight the chooser is disabled — the double-click
  // guard, observed rather than assumed (brief §6).
  await expect(staffPage.getByText(/Gør .* klar…|Uploader .*…|Behandler .*…/)).toBeVisible()
  await expect(uploadInput(staffPage)).toBeDisabled()

  await staffPage.waitForURL(/status=uploadet/, { timeout: 30_000 })
  await expect(
    staffPage.getByText('Billedet er uploadet og ligger i biblioteket.'),
  ).toBeVisible()

  firstImageId = selectedImageId(staffPage)

  // The card is on screen with 1w's unused caption, and the real thumbnail —
  // the first ever served — actually loaded pixels.
  const card = gridCard(staffPage, /burger-tæt-på\.jpg/)
  await expect(card).toBeVisible()
  await expect(card).toContainText('Bruges ikke endnu')

  const thumbnail = card.locator('img')
  await expect(thumbnail).toBeVisible()
  expect(await thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

  // The stored original proves the browser downscale ran: 4000 px went in,
  // at most 2560 px landed (§1 adjustment 3). The screen itself never shows a
  // pixel figure — 1w promises staff never see one — so the row is the witness.
  const { data: row } = await rest
    .from('images')
    .select('width, height, mime')
    .eq('id', firstImageId)
    .single()
  expect(row!.width).toBe(2560)
  expect(row!.height).toBe(1664)
  expect(row!.mime).toBe('image/jpeg')

  await noSidewaysScroll(staffPage)
})

test('the detail panel shows the image without sizes, formats or pixel talk', async () => {
  await expect(staffPage.getByRole('heading', { name: 'burger-tæt-på.jpg' })).toBeVisible()
  await expect(staffPage.getByText(/^Uploadet \d{2}\.\d{2}\.\d{4}$/)).toBeVisible()

  // 1w: "Personalet ser aldrig filstørrelser, formater eller pixelmål."
  const main = staffPage.getByRole('main')
  await expect(main).not.toContainText(/\d+\s*(px|MB|MiB|KB|kB)/)
  await expect(main).not.toContainText(/2560|1664/)

  expect(await violations(staffPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// The description
// ---------------------------------------------------------------------------

test('the description is edited, saved, and survives a reload', async () => {
  await saveAlt(staffPage, 'Burgeren fotograferet tæt på, fra siden.')
  await expect(staffPage.getByText('Beskrivelsen er gemt.')).toBeVisible()

  await staffPage.reload()
  await expect(altField(staffPage)).toHaveValue('Burgeren fotograferet tæt på, fra siden.')
})

test('a stale description save is refused, keeping what was typed', async () => {
  // The panel is rendered; a colleague (the REST client) then edits first, so
  // the version token this form carries goes stale.
  await staffPage.goto(`${IMAGES_ADMIN_PATH}?billede=${firstImageId}`)
  await expect(altField(staffPage)).toBeVisible()

  const { error } = await rest
    .from('images')
    .update({ alt_text: 'Kollegaens beskrivelse' })
    .eq('id', firstImageId)
  expect(error).toBeNull()

  await saveAlt(staffPage, 'Min egen beskrivelse', /status=konflikt/)

  await expect(
    staffPage.getByText('En kollega har ændret billedet i mellemtiden', { exact: false }),
  ).toBeVisible()
  // The echo keeps the refused text on screen beside the fresh version token.
  await expect(altField(staffPage)).toHaveValue('Min egen beskrivelse')

  // And saving again — from the fresh render — goes through.
  await saveAlt(staffPage, 'Burgeren fotograferet tæt på, fra siden.')
  await expect(staffPage.getByText('Beskrivelsen er gemt.')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Usage labels, and deletion while used
// ---------------------------------------------------------------------------

test('a referenced image says where it is used', async () => {
  await pointThorAt(firstImageId)

  await openImagesAdmin(staffPage)
  await expect(gridCard(staffPage, /Burgeren fotograferet/)).toContainText('Bruges på: Thor')

  await gridCard(staffPage, /Burgeren fotograferet/).click()
  await expect(
    staffPage.getByText('Billedet bruges på: Thor. Sletter du det, forsvinder det også der.'),
  ).toBeVisible()
})

test('deleting a used image asks with its usages, and Behold changes nothing', async () => {
  const dialog = await openDeleteDialog(staffPage)

  await expect(dialog).toContainText('Billedet bruges på: Thor.')
  await expect(dialog).toContainText('fjernes fra alle de nævnte steder')
  // The safe way out holds focus (1aa: dialogs focus the safe choice).
  await expect(dialog.getByRole('link', { name: 'Behold billedet' })).toBeFocused()

  await dialog.getByRole('link', { name: 'Behold billedet' }).click()
  await expect(staffPage.getByRole('dialog')).toHaveCount(0)

  // Nothing happened: the row stands and Thor still points at it.
  const { data } = await rest.from('dishes').select('image_id').eq('name', 'Thor').single()
  expect(data!.image_id).toBe(firstImageId)
})

test('a delete confirmed for an unused image meets a fresh reference honestly', async () => {
  // The race the confirmation bit exists for: rendered over "unused", confirmed
  // over "used". First give the dialog an unused image to describe…
  await pointThorAt(null)
  await staffPage.goto(`${IMAGES_ADMIN_PATH}?billede=${firstImageId}&slet=${firstImageId}`)
  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toContainText('Billedet fjernes fra biblioteket')

  // …then the reference appears while the dialog is open.
  await pointThorAt(firstImageId)

  await confirmDelete(staffPage, /status=i_brug/)

  // Nothing was deleted; the reopened confirmation names the fresh usage.
  await expect(staffPage.getByText('Billedet er taget i brug', { exact: false })).toBeVisible()
  await expect(staffPage.getByRole('dialog')).toContainText('Billedet bruges på: Thor.')

  const { count } = await rest
    .from('images')
    .select('id', { count: 'exact', head: true })
    .eq('id', firstImageId)
  expect(count).toBe(1)
})

test('the confirmed deletion removes the row, the references and the files', async () => {
  // Still on the reopened in-use confirmation from the previous step.
  const thumbnailSrc = await staffPage
    .locator('main img')
    .first()
    .getAttribute('src')
  expect(thumbnailSrc).not.toBeNull()

  await confirmDelete(staffPage)
  await expect(staffPage.getByText('Billedet er slettet.')).toBeVisible()

  // Row gone, reference nulled atomically — never a dangling id (§7e item 4).
  const { count } = await rest
    .from('images')
    .select('id', { count: 'exact', head: true })
    .eq('id', firstImageId)
  expect(count).toBe(0)

  const { data } = await rest.from('dishes').select('image_id').eq('name', 'Thor').single()
  expect(data!.image_id).toBeNull()

  // The public derivative stopped existing — storage cleanup ran (brief §15).
  const response = await staffPage.request.get(thumbnailSrc!)
  expect(response.ok()).toBe(false)

  await expect(
    staffPage.getByText('Der er ingen billeder endnu. Det første, du uploader, vises her.'),
  ).toBeVisible()
})

// ---------------------------------------------------------------------------
// Replacement
// ---------------------------------------------------------------------------

test('Erstat uploads the new image first, then moves the references', async () => {
  await openImagesAdmin(staffPage)
  const oldId = await uploadViaUi(staffPage, {
    name: 'gammelt-foto.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 10),
  })
  await pointThorAt(oldId)

  // Reload so the panel shows the usage, then open the replace panel.
  await staffPage.goto(`${IMAGES_ADMIN_PATH}?billede=${oldId}`)
  await staffPage.getByRole('link', { name: 'Erstat' }).click()

  await expect(staffPage.getByRole('heading', { name: 'Erstat billedet' })).toBeVisible()
  await expect(
    staffPage.getByText('Det nye billede overtager alle de steder', { exact: false }),
  ).toBeVisible()
  await expect(staffPage.getByText('Thor', { exact: false }).first()).toBeVisible()

  const oldThumbnail = await staffPage.locator('main img').first().getAttribute('src')

  await replaceInput(staffPage).setInputFiles({
    name: 'nyt-foto.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 90),
  })
  await staffPage.waitForURL(/status=erstattet/, { timeout: 30_000 })
  await expect(staffPage.getByText('Billedet er erstattet.', { exact: false })).toBeVisible()

  const newId = selectedImageId(staffPage)
  expect(newId).not.toBe(oldId)

  // The reference moved, the old row is gone, the old files stopped existing,
  // and the new image's card says where it is now used.
  const { data } = await rest.from('dishes').select('image_id').eq('name', 'Thor').single()
  expect(data!.image_id).toBe(newId)

  const { count } = await rest
    .from('images')
    .select('id', { count: 'exact', head: true })
    .eq('id', oldId)
  expect(count).toBe(0)

  const oldDerivative = await staffPage.request.get(oldThumbnail!)
  expect(oldDerivative.ok()).toBe(false)

  await expect(gridCard(staffPage, /nyt-foto\.jpg/)).toContainText('Bruges på: Thor')

  // Restore: clear the reference and delete the replacement through the UI.
  await pointThorAt(null)
  await staffPage.goto(`${IMAGES_ADMIN_PATH}?billede=${newId}`)
  await openDeleteDialog(staffPage)
  await confirmDelete(staffPage)
})

test('Fortryd backs out of a replacement having changed nothing', async () => {
  await openImagesAdmin(staffPage)
  const id = await uploadViaUi(staffPage, {
    name: 'bliver-beholdt.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(900, 600, 40),
  })

  await staffPage.getByRole('link', { name: 'Erstat' }).click()
  await expect(staffPage.getByRole('heading', { name: 'Erstat billedet' })).toBeVisible()

  await staffPage
    .getByRole('link', { name: 'Fortryd — behold det nuværende billede' })
    .click()
  await expect(staffPage.getByRole('heading', { name: 'bliver-beholdt.jpg' })).toBeVisible()

  const { count } = await rest
    .from('images')
    .select('id', { count: 'exact', head: true })
    .eq('id', id)
  expect(count).toBe(1)

  await openDeleteDialog(staffPage)
  await confirmDelete(staffPage)
})

// ---------------------------------------------------------------------------
// Stale deletion, keyboard, and the confirmation's accessibility
// ---------------------------------------------------------------------------

test('a stale delete is refused as a conflict, deleting nothing', async () => {
  await openImagesAdmin(staffPage)
  const id = await uploadViaUi(staffPage, {
    name: 'konflikt-billede.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(700, 500, 70),
  })

  await openDeleteDialog(staffPage)

  // A colleague edits the description while the confirmation is open; the
  // version the dialog carries goes stale.
  const { error } = await rest
    .from('images')
    .update({ alt_text: 'Ændret i mellemtiden' })
    .eq('id', id)
  expect(error).toBeNull()

  await confirmDelete(staffPage, /status=konflikt/)
  await expect(
    staffPage.getByText('En kollega har ændret billedet i mellemtiden', { exact: false }),
  ).toBeVisible()

  const { count } = await rest
    .from('images')
    .select('id', { count: 'exact', head: true })
    .eq('id', id)
  expect(count).toBe(1)

  // Fresh render, real deletion, state restored.
  await staffPage.goto(`${IMAGES_ADMIN_PATH}?billede=${id}`)
  await openDeleteDialog(staffPage)
  await confirmDelete(staffPage)
})

test('the description and the deletion are keyboard-operable end to end', async () => {
  await openImagesAdmin(staffPage)
  const id = await uploadViaUi(staffPage, {
    name: 'tastatur-billede.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(600, 400, 20),
  })

  // The keyboard reaches the description, writes it, and submits it.
  await tabUntilFocused(staffPage, altField(staffPage))
  await staffPage.keyboard.type('Skrevet med tastaturet.')
  await tabUntilFocused(staffPage, staffPage.getByRole('button', { name: 'Gem beskrivelse' }))
  await staffPage.keyboard.press('Enter')
  await staffPage.waitForURL(/status=tekst_gemt/)
  await expect(altField(staffPage)).toHaveValue('Skrevet med tastaturet.')

  // The keyboard reaches Slet; the dialog holds focus on the safe way out; the
  // committing control is one Tab further.
  await tabUntilFocused(staffPage, staffPage.getByRole('link', { name: 'Slet', exact: true }))
  await staffPage.keyboard.press('Enter')

  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toContainText('Slet billedet?')
  await expect(dialog.getByRole('link', { name: 'Behold billedet' })).toBeFocused()
  expect(await violations(staffPage)).toEqual([])

  await staffPage.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: /^Slet billede/ })).toBeFocused()
  await staffPage.keyboard.press('Enter')
  await staffPage.waitForURL(/status=slettet/)

  const { count } = await rest
    .from('images')
    .select('id', { count: 'exact', head: true })
    .eq('id', id)
  expect(count).toBe(0)
})

test('every control meets the 44 px minimum at this width', async () => {
  await openImagesAdmin(staffPage)

  const small = await staffPage
    .locator('a:visible, button:visible, input:visible, textarea:visible')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect()
          const visuallyHidden = box.height <= 2 || box.width <= 2
          return !visuallyHidden && box.height > 0 && box.height < 44
        })
        .map(
          (element) =>
            `${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 40)}"`,
        ),
    )

  expect(small, 'no control on the image library is under 44 px').toEqual([])
})

// ---------------------------------------------------------------------------
// The owner — the same authority, exercised rather than assumed
// ---------------------------------------------------------------------------

test('the owner can upload, describe and delete an image too', async ({ browser }) => {
  const context = await browser.newContext()
  const ownerPage = await context.newPage()

  try {
    await signIn(ownerPage, OWNER)
    await openImagesAdmin(ownerPage)

    await uploadViaUi(ownerPage, {
      name: 'ejerens-foto.jpg',
      mimeType: 'image/jpeg',
      buffer: await jpegFixture(800, 500, 50),
    })

    await saveAlt(ownerPage, 'Ejerens eget billede.')
    await expect(ownerPage.getByText('Beskrivelsen er gemt.')).toBeVisible()

    await openDeleteDialog(ownerPage)
    await confirmDelete(ownerPage)
    await expect(ownerPage.getByText('Billedet er slettet.')).toBeVisible()
  } finally {
    await context.close()
  }
})

// ---------------------------------------------------------------------------
// The library ends as it began
// ---------------------------------------------------------------------------

test('the run leaves an empty library and an untouched menu', async () => {
  await openImagesAdmin(staffPage)
  await expect(
    staffPage.getByText('Der er ingen billeder endnu. Det første, du uploader, vises her.'),
  ).toBeVisible()

  const { count } = await rest.from('images').select('id', { count: 'exact', head: true })
  expect(count).toBe(0)

  const { data } = await rest.from('dishes').select('image_id').eq('name', 'Thor').single()
  expect(data!.image_id).toBeNull()
})
