import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  addFeatured,
  chooseSlotImage,
  dishPicker,
  featuredNames,
  guestHome,
  HOME_ADMIN_PATH,
  HOME_CARDS,
  HOME_SLOT_ANCHOR,
  homeForm,
  homeVersion,
  openHomeAdmin,
  ownerRestClient,
  pendingBand,
  pickerDialog,
  pressFeatured,
  previewHome,
  publishHome,
  removeSlotImage,
  saveCard,
  slotCard,
  statusNotice,
} from './support/home-admin'
import {
  confirmDelete,
  gridCard,
  jpegFixture,
  openDeleteDialog,
  openImagesAdmin,
  replaceInput,
  staffRestClient,
  uploadViaUi,
} from './support/images-admin'
import { waitForPublicShell } from './support/public-shell'

/**
 * Forsiden administration — phase 11A (brief §26); designs 1u, 1g / 1l; technical
 * plan §4, §5, §6, §7e item 4, §20.
 *
 * The Owner story, end to end: open the editor, save a heading as a draft while the
 * first guest request stays unchanged, preview the draft on the real Forside, choose
 * a hero photograph through the shared picker, preview it, publish, and read the
 * first guest request with the new heading and the photograph from the derivative
 * ladder; then remove the photograph as a draft, publish the removal, change the
 * featured list, and meet a stale save with a refusal. The library lifecycle over a
 * Forside image — the "Forsiden" caption, a global replacement, a confirmed deletion
 * — and the Staff denial follow. The run restores the seed's Forside at the end.
 *
 * Every guest read is a fresh, cookie-free context — the FIRST request after the
 * commit under test — and nothing polls or retries. Both dedicated projects run it,
 * 375 first, then 1440.
 */

test.describe.configure({ mode: 'serial' })

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

let ownerPage: Page
let rest: SupabaseClient

/** The seeded words, read off the editor before anything moves, and restored at the end. */
let seededHeading = ''
let seededIntro = ''
let seededFeatured: string[] = []

let imageA = ''
let imageB = ''

const DRAFT_HEADING = 'Kladde — burgeren der vandt Fyn'

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/** The stored Forside row, read through the Owner's own JWT. */
async function storedHome(): Promise<{ published: Record<string, unknown>; draft: unknown; updated_at: string }> {
  const { data, error } = await rest.from('pages').select('published, draft, updated_at').eq('key', 'home').single()
  if (error) throw error
  return data as { published: Record<string, unknown>; draft: unknown; updated_at: string }
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)
  rest = await ownerRestClient()

  // Whatever a previous run left behind: no Forside draft.
  await rest.from('pages').update({ draft: null }).eq('key', 'home')

  await openHomeAdmin(ownerPage)
  seededHeading = await homeForm(ownerPage, HOME_CARDS.hero).getByLabel('Overskrift', { exact: true }).inputValue()
  seededIntro = await homeForm(ownerPage, HOME_CARDS.hero).getByLabel('Kort tekst under', { exact: true }).inputValue()
  seededFeatured = await featuredNames(ownerPage)
})

test.afterAll(async () => {
  // Best-effort restoration even after a failure: the seeded words and featured
  // list published, no draft, no image anywhere, an empty library. The document
  // itself is restored through the editor's own path where the run got that far;
  // this is the safety net.
  const leftovers = await rest.from('images').select('id, updated_at')
  for (const row of (leftovers.data ?? []) as { id: string; updated_at: string }[]) {
    await rest.rpc('delete_image', { p_id: row.id, p_expected_updated_at: row.updated_at, p_confirmed: true })
  }
  await rest.from('pages').update({ draft: null }).eq('key', 'home')
  await rest.auth.signOut()
  await ownerPage.context().close()
})

// ---------------------------------------------------------------------------
// 1–4. The editor, a draft, the unchanged guest, the preview
// ---------------------------------------------------------------------------

test('the Owner opens the Forsiden editor: 1u\'s four cards, accessibly, and nothing waiting', async () => {
  await openHomeAdmin(ownerPage)

  for (const card of Object.values(HOME_CARDS)) {
    await expect(ownerPage.getByRole('heading', { name: card })).toBeVisible()
  }
  await expect(ownerPage.getByRole('banner').getByRole('link', { name: 'Forhåndsvis' })).toHaveAttribute(
    'href',
    '/api/preview/start?maal=forside',
  )
  await expect(ownerPage.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ })).toBeVisible()
  await expect(pendingBand(ownerPage)).toHaveCount(0)
  await expect(ownerPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  // The three slots are the shared picker, empty, under 1u's own names.
  await expect(ownerPage.locator(HOME_SLOT_ANCHOR.hero)).toHaveText('Vælg billede')
  await expect(ownerPage.getByText('Hovedbillede', { exact: true })).toBeVisible()
  await expect(ownerPage.getByText('Udmærkelsesfoto (valgfrit)', { exact: true })).toBeVisible()
  await expect(ownerPage.getByText('Billede', { exact: true })).toBeVisible()
  await expect(ownerPage.getByText('Et bredt billede virker bedst. Mindst 2000 px.')).toBeVisible()

  expect(await violations(ownerPage)).toEqual([])

  const overflow = await ownerPage.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow, 'the editor does not scroll sideways').toBe(false)
})

test('every control in the bar and on the cards is a 44 px target', async () => {
  await openHomeAdmin(ownerPage)

  const controls = [
    ownerPage.getByRole('banner').getByRole('link', { name: 'Forhåndsvis' }),
    ownerPage.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ }),
    ...Object.values(HOME_CARDS)
      .filter((card) => card !== HOME_CARDS.featured)
      .map((card) => homeForm(ownerPage, card).getByRole('button', { name: 'Gem' })),
    ownerPage.locator(HOME_SLOT_ANCHOR.hero),
    ownerPage.locator('#vaelg-ret-ny').or(ownerPage.getByRole('link', { name: /^Skift plads 1/ })),
  ]

  for (const control of controls) {
    const box = await control.first().boundingBox()
    expect(box, 'the control is on screen').not.toBeNull()
    expect(box!.height, 'at least 44 px tall').toBeGreaterThanOrEqual(44)
  }
})

test('saving a heading writes a draft: the card says Kladde, the band names the section', async () => {
  await saveCard(ownerPage, HOME_CARDS.hero, { Overskrift: DRAFT_HEADING })

  await expect(statusNotice(ownerPage)).toContainText('gemt som kladde')
  await expect(pendingBand(ownerPage)).toContainText('Øverst på siden afventer offentliggørelse.')
  await expect(slotCard(ownerPage, HOME_CARDS.hero).getByText('Kladde', { exact: true })).toBeVisible()
  await expect(
    slotCard(ownerPage, HOME_CARDS.hero).getByText('Ændret — vises først på hjemmesiden, når du offentliggør.'),
  ).toBeVisible()
  // The other cards are not pending.
  await expect(slotCard(ownerPage, HOME_CARDS.award).getByText('Kladde', { exact: true })).toHaveCount(0)

  const stored = await storedHome()
  expect((stored.draft as { hero: { heading: string } }).hero.heading).toBe(DRAFT_HEADING)
  expect(Object.keys(stored.draft as object)).toEqual(['hero'])

  expect(await violations(ownerPage)).toEqual([])
})

test('the first guest request is unchanged — a draft moves nothing', async ({ browser }) => {
  const guest = await guestHome(browser)
  expect(guest.heading).toBe(seededHeading)
  expect(guest.heroSrc).toBeNull()
})

test('Forhåndsvis shows the draft heading on the real Forside, with every dynamic section intact', async () => {
  const preview = await previewHome(ownerPage)

  expect(preview.heading).toBe(DRAFT_HEADING)
  expect(preview.featured).toEqual(seededFeatured)
  expect(preview.hasOpeningHours).toBe(true)
  expect(preview.heroSrc).toBeNull()
})

test('a validation refusal is bound to its field and echoes what was typed', async () => {
  await openHomeAdmin(ownerPage)
  const form = homeForm(ownerPage, HOME_CARDS.hero)
  const tooLong = 'x'.repeat(121)

  // The field's own cap is the schema's limit, so a person cannot type past it; the
  // refusal under test is the server's, met by a submission the cap did not stop.
  const heading = form.getByLabel('Overskrift', { exact: true })
  await heading.evaluate((element) => element.removeAttribute('maxlength'))
  await heading.fill(tooLong)
  await form.getByRole('button', { name: 'Gem' }).click()
  await ownerPage.waitForURL(/status=ugyldig/)

  const field = homeForm(ownerPage, HOME_CARDS.hero).getByLabel('Overskrift', { exact: true })
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveValue(tooLong)
  const describedBy = await field.getAttribute('aria-describedby')
  await expect(ownerPage.locator(`#${describedBy!.split(' ').pop()}`)).toContainText('højst være 120 tegn')

  // The stored draft is exactly as before the refusal.
  expect((await storedHome()).draft).toEqual({ hero: { heading: DRAFT_HEADING, intro: seededIntro, image_id: null } })

  expect(await violations(ownerPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// 5–9. A photograph: chosen, previewed, published — on the first request
// ---------------------------------------------------------------------------

test('the Owner uploads two images to the library', async () => {
  await openImagesAdmin(ownerPage)
  imageA = await uploadViaUi(ownerPage, {
    name: 'forside-a.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 40),
  })
  await openImagesAdmin(ownerPage)
  imageB = await uploadViaUi(ownerPage, {
    name: 'forside-b.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 180),
  })
  expect(imageA).not.toBe(imageB)
})

test('the picker opens from the hero slot, keyboard first, and gives focus back', async () => {
  await openHomeAdmin(ownerPage)

  await ownerPage.locator(HOME_SLOT_ANCHOR.hero).focus()
  await ownerPage.keyboard.press('Enter')
  await expect(pickerDialog(ownerPage)).toBeVisible()
  await expect(pickerDialog(ownerPage).getByRole('link', { name: 'Annuller' })).toBeFocused()
  await expect(pickerDialog(ownerPage).getByRole('button', { name: /forside-a\.jpg/ })).toBeVisible()

  expect(await violations(ownerPage)).toEqual([])

  await ownerPage.keyboard.press('Escape')
  await expect(pickerDialog(ownerPage)).toHaveCount(0)
  await expect(ownerPage.locator(HOME_SLOT_ANCHOR.hero)).toBeFocused()
})

test('choosing image A for the hero is a draft: the slot shows it, the library says (kladde)', async () => {
  await chooseSlotImage(ownerPage, 'hero', /forside-a\.jpg/)

  await expect(statusNotice(ownerPage)).toContainText('Billedet er gemt som kladde')
  await expect(slotCard(ownerPage, HOME_CARDS.hero).getByRole('link', { name: /^Skift billede/ })).toBeVisible()
  await expect(slotCard(ownerPage, HOME_CARDS.hero).getByRole('button', { name: 'Fjern billede' })).toBeVisible()

  const stored = await storedHome()
  expect((stored.draft as { hero: { image_id: string; heading: string } }).hero).toEqual({
    heading: DRAFT_HEADING,
    intro: seededIntro,
    image_id: imageA,
  })
  expect(stored.published.hero).not.toHaveProperty('image_id', imageA)

  await openImagesAdmin(ownerPage)
  await expect(ownerPage.getByText('Bruges på: Forsiden (kladde)', { exact: true }).first()).toBeVisible()
})

test('the preview renders the pending photograph; the guest keeps the reserved frame', async ({ browser }) => {
  const preview = await previewHome(ownerPage)
  expect(preview.heroSrc).not.toBeNull()
  expect(preview.heroSrc).toContain('/storage/v1/object/public/media/')

  const guest = await guestHome(browser)
  expect(guest.heroSrc).toBeNull()
  expect(guest.heading).toBe(seededHeading)
})

test('publishing puts the heading and the photograph on the FIRST guest request', async ({ browser }) => {
  await publishHome(ownerPage)
  await expect(statusNotice(ownerPage)).toContainText('Forsiden er opdateret på hjemmesiden.')
  await expect(pendingBand(ownerPage)).toHaveCount(0)

  const guest = await guestHome(browser)
  expect(guest.heading).toBe(DRAFT_HEADING)
  expect(guest.heroSrc).toContain('/storage/v1/object/public/media/')
  expect(guest.heroSrc).not.toContain('media-originals')
  expect(guest.hasOpeningHours).toBe(true)

  const stored = await storedHome()
  expect(stored.draft).toBeNull()
  expect((stored.published.hero as { image_id: string }).image_id).toBe(imageA)

  await openImagesAdmin(ownerPage)
  await expect(ownerPage.getByText('Bruges på: Forsiden', { exact: true }).first()).toBeVisible()
})

test('the published Forside with a photograph has no accessibility violations, and works with scripting off', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.locator('h1#forside-titel')).toHaveText(DRAFT_HEADING)
  await expect(page.locator('section[aria-labelledby="forside-titel"] picture img')).toHaveCount(1)
  await context.close()

  const scanned = await browser.newContext()
  const scan = await scanned.newPage()
  await scan.goto('/')
  await waitForPublicShell(scan)
  expect(await violations(scan)).toEqual([])
  await scanned.close()
})

// ---------------------------------------------------------------------------
// 10–13. A pending removal, published; the featured list
// ---------------------------------------------------------------------------

test('Fjern billede is a pending removal: the guest keeps A, the preview shows the frame', async ({ browser }) => {
  await openHomeAdmin(ownerPage)
  await removeSlotImage(ownerPage, HOME_CARDS.hero)
  await expect(statusNotice(ownerPage)).toContainText('bliver i billedbiblioteket')

  const stored = await storedHome()
  expect((stored.draft as { hero: { image_id: null } }).hero.image_id).toBeNull()
  expect((stored.published.hero as { image_id: string }).image_id).toBe(imageA)

  expect((await guestHome(browser)).heroSrc).not.toBeNull()
  expect((await previewHome(ownerPage)).heroSrc).toBeNull()
})

test('publishing the removal returns the guest to the reserved frame on the first request', async ({ browser }) => {
  await publishHome(ownerPage)

  const guest = await guestHome(browser)
  expect(guest.heroSrc).toBeNull()
  expect(guest.heading).toBe(DRAFT_HEADING)

  await openImagesAdmin(ownerPage)
  await expect(ownerPage.getByText('Bruges ikke endnu', { exact: true }).first()).toBeVisible()
})

test('the featured list: remove, add from the menu, move — all drafts, then published', async ({ browser }) => {
  test.skip(seededFeatured.length < 2, 'the seed features fewer than two dishes')

  await openHomeAdmin(ownerPage)
  const [first, second] = seededFeatured

  await pressFeatured(ownerPage, 'Fjern', 0, /status=ret_fjernet/)
  expect(await featuredNames(ownerPage)).toEqual(seededFeatured.slice(1))
  await expect(pendingBand(ownerPage)).toContainText('Udvalgte burgere')

  // The guest still reads three.
  expect((await guestHome(browser)).featured).toEqual(seededFeatured)

  await ownerPage.locator('#vaelg-ret-ny').click()
  await expect(dishPicker(ownerPage)).toBeVisible()
  // A dish already featured is offered disabled and marked, never twice.
  await expect(dishPicker(ownerPage).getByRole('button', { name: new RegExp(`^${second}`) })).toBeDisabled()
  expect(await violations(ownerPage)).toEqual([])
  await dishPicker(ownerPage).getByRole('link', { name: 'Annuller' }).click()

  await addFeatured(ownerPage, first!)
  expect(await featuredNames(ownerPage)).toEqual([...seededFeatured.slice(1), first])

  await pressFeatured(ownerPage, 'Flyt op', seededFeatured.length - 1, /status=ret_flyttet/)
  const reordered = await featuredNames(ownerPage)
  expect(reordered).not.toEqual(seededFeatured)

  expect((await previewHome(ownerPage)).featured).toEqual(reordered)

  await publishHome(ownerPage)
  expect((await guestHome(browser)).featured).toEqual(reordered)
})

test('a second Owner tab that started from an older version is refused, not overwritten', async ({
  browser,
}) => {
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await signIn(otherPage, OWNER)

  await openHomeAdmin(ownerPage)
  await openHomeAdmin(otherPage)
  const version = await homeVersion(ownerPage)
  expect(await homeVersion(otherPage)).toBe(version)

  await saveCard(otherPage, HOME_CARDS.award, { 'Tekst om udmærkelsen': 'Første redaktør vandt' })
  await expect(statusNotice(otherPage)).toContainText('gemt som kladde')

  // The stale form: the version it carries no longer matches the row.
  await saveCard(ownerPage, HOME_CARDS.award, { 'Tekst om udmærkelsen': 'Anden redaktør, for sent' })
  await expect(statusNotice(ownerPage)).toContainText('Nogen andre har rettet dette')

  const stored = await storedHome()
  expect((stored.draft as { award: { title: string } }).award.title).toBe('Første redaktør vandt')
  // A refused save writes no audit row and moves no version.
  expect(stored.updated_at).not.toBe(version)

  // Reloading gives the current version, and the delta rule takes the section back
  // out when it is saved as the hjemmeside already has it.
  await openHomeAdmin(ownerPage)
  const seededTitle = (stored.published.award as { title: string }).title
  await saveCard(ownerPage, HOME_CARDS.award, { 'Tekst om udmærkelsen': seededTitle })
  await expect(statusNotice(ownerPage)).toContainText('venter ingen ændring')
  expect((await storedHome()).draft).toBeNull()

  await other.close()
})

// ---------------------------------------------------------------------------
// 13b. The document contract, past the editor (the 11A completion pass)
// ---------------------------------------------------------------------------

test('a section written past the editor with an unexpected key goes nowhere: unreadable in the editor, absent from the preview, refused at publish', async () => {
  // The Owner's own JWT may write `pages.draft` directly — RLS scopes the row to the
  // Owner, and the schema is the application's door, not the database's. What has to
  // hold is that such a draft goes NOWHERE: the strict section refuses the key on the
  // way in (unit-tested), and the same strictness on the stored parse makes the editor
  // call the draft unreadable, the preview show the published words, and Offentliggør
  // answer `invalid_draft` rather than merge the section with its extra key attached.
  const before = await storedHome()
  const liveHero = before.published.hero as { heading: string; intro: string | null }
  const smuggled = {
    hero: { heading: 'Smuglet', intro: liveHero.intro, image_id: null, storage_path: 'x/original.jpg' },
  }

  const written = await rest.from('pages').update({ draft: smuggled }).eq('key', 'home').select('id')
  expect(written.error).toBeNull()
  expect(written.data).toHaveLength(1)

  // The editor: the draft is named as unreadable, nothing is pending, the card shows
  // the published words — not "Smuglet".
  await openHomeAdmin(ownerPage)
  await expect(ownerPage.getByText('Den gemte kladde kan ikke læses')).toBeVisible()
  await expect(pendingBand(ownerPage)).toHaveCount(0)
  await expect(homeForm(ownerPage, HOME_CARDS.hero).getByLabel('Overskrift', { exact: true })).toHaveValue(
    liveHero.heading,
  )

  // The preview: the same overlay, the same refusal.
  const preview = await previewHome(ownerPage)
  expect(preview.heading).toBe(liveHero.heading)

  // Offentliggør: the stored draft is re-validated before the merge and refused.
  await publishHome(ownerPage)
  await expect(ownerPage).toHaveURL(/status=invalid_draft/)
  await expect(statusNotice(ownerPage)).toContainText('kan ikke offentliggøres')

  const after = await storedHome()
  expect(after.published).toEqual(before.published)
  expect(after.draft).toEqual(smuggled)

  // "Gem afsnittene igen" — the notice's own advice — replaces the unreadable draft:
  // the section saved as the hjemmeside has it leaves the draft, and the draft is gone.
  await openHomeAdmin(ownerPage)
  await saveCard(ownerPage, HOME_CARDS.hero, {
    Overskrift: liveHero.heading,
    'Kort tekst under': liveHero.intro ?? '',
  })
  await expect(statusNotice(ownerPage)).toContainText('venter ingen ændring')
  expect((await storedHome()).draft).toBeNull()
})

// ---------------------------------------------------------------------------
// 14. The library lifecycle over a Forside image
// ---------------------------------------------------------------------------

test('a published award photograph: replacing it in the library reaches the first guest request', async ({
  browser,
}) => {
  await openHomeAdmin(ownerPage)
  await chooseSlotImage(ownerPage, 'award', /forside-a\.jpg/)
  await publishHome(ownerPage)

  const before = await guestHome(browser)
  expect(before.awardSrc).not.toBeNull()

  await openImagesAdmin(ownerPage)
  await gridCard(ownerPage, /forside-a\.jpg/).click()
  await expect(ownerPage.getByText('Bruges på: Forsiden. Sletter du det')).toBeVisible()
  await ownerPage.getByRole('link', { name: 'Erstat', exact: true }).click()
  await replaceInput(ownerPage).setInputFiles({
    name: 'forside-c.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 90),
  })
  await ownerPage.waitForURL(/status=erstattet/, { timeout: 30_000 })

  const after = await guestHome(browser)
  expect(after.awardSrc).not.toBeNull()
  expect(after.awardSrc).not.toBe(before.awardSrc)

  const stored = await storedHome()
  expect((stored.published.award as { image_id: string }).image_id).not.toBe(imageA)
  expect(stored.draft).toBeNull()
})

test('a Staff member cannot delete or replace an image the Forside uses', async ({ browser }) => {
  const context = await browser.newContext()
  const staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /forside-c\.jpg/).click()
  await expect(staffPage.getByText('som kun ejeren kan rette')).toBeVisible()
  await expect(staffPage.getByRole('link', { name: 'Slet', exact: true })).toHaveCount(0)
  await expect(staffPage.getByRole('link', { name: 'Erstat', exact: true })).toHaveCount(0)

  // The trusted transition refuses it too, before any write.
  const staffRest = await staffRestClient()
  const { data: row } = await staffRest.from('images').select('id, updated_at').ilike('original_filename', 'forside-c%').single()
  const { data: reply } = await staffRest.rpc('delete_image', {
    p_id: (row as { id: string }).id,
    p_expected_updated_at: (row as { updated_at: string }).updated_at,
    p_confirmed: true,
  })
  expect((reply as { status: string }).status).toBe('owner_only')
  await staffRest.auth.signOut()

  expect((await storedHome()).published.award).toHaveProperty('image_id', (row as { id: string }).id)
  await context.close()
})

test('a confirmed deletion by the Owner clears the live award slot on the first guest request', async ({
  browser,
}) => {
  await openImagesAdmin(ownerPage)
  await gridCard(ownerPage, /forside-c\.jpg/).click()
  const dialog = await openDeleteDialog(ownerPage)
  await expect(dialog).toContainText('Billedet bruges på: Forsiden.')
  await confirmDelete(ownerPage)

  expect((await guestHome(browser)).awardSrc).toBeNull()

  const stored = await storedHome()
  expect((stored.published.award as { image_id: null }).image_id).toBeNull()
  expect((stored.published.award as { title: string }).title).toBeTruthy()

  await openHomeAdmin(ownerPage)
  await expect(ownerPage.locator(HOME_SLOT_ANCHOR.award)).toHaveText('Vælg billede')
})

test('a draft-only reference: deleting the image clears exactly the pending selection', async () => {
  await openHomeAdmin(ownerPage)
  await chooseSlotImage(ownerPage, 'about', /forside-b\.jpg/)
  expect((await storedHome()).draft).toEqual({
    about_excerpt: expect.objectContaining({ image_id: imageB }),
  })

  await openImagesAdmin(ownerPage)
  await gridCard(ownerPage, /forside-b\.jpg/).click()
  await openDeleteDialog(ownerPage)
  await confirmDelete(ownerPage)

  // The section returned to its published values and left the draft — nothing waits.
  expect((await storedHome()).draft).toBeNull()
  await openHomeAdmin(ownerPage)
  await expect(pendingBand(ownerPage)).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 15. Staff denial — the screen, a forged post, a direct write
// ---------------------------------------------------------------------------

test('a Staff member is refused the editor, the action and the row', async ({ browser }) => {
  const context = await browser.newContext()
  const staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  // No tile on the dashboard, and the address itself is refused.
  await expect(staffPage.getByRole('link', { name: 'Rediger forsiden', exact: true })).toHaveCount(0)
  await staffPage.goto(HOME_ADMIN_PATH)
  await expect(staffPage).toHaveURL(/\/admin\/ingen-adgang/)
  await expect(staffPage.getByRole('form', { name: HOME_CARDS.hero })).toHaveCount(0)

  // A forged Server Action POST is not carried out.
  const forged = await staffPage.request.post(HOME_ADMIN_PATH, {
    headers: { 'Next-Action': 'forged', 'Content-Type': 'text/plain;charset=UTF-8' },
    data: '[]',
    maxRedirects: 0,
  })
  expect(forged.status()).not.toBe(200)

  // A plain POST carrying the editor's own field names writes nothing.
  const before = await storedHome()
  await staffPage.request.post(HOME_ADMIN_PATH, {
    form: { afsnit: 'hero', overskrift: 'Kapret', tekst: 'Kapret', version: before.updated_at },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0,
    failOnStatusCode: false,
  })

  // And the row refuses a direct write from the Staff JWT: zero rows, RLS.
  const staffRest = await staffRestClient()
  const draftWrite = await staffRest
    .from('pages')
    .update({ draft: { hero: { heading: 'Kapret', intro: null, image_id: null } } })
    .eq('key', 'home')
    .select('id')
  expect(draftWrite.data).toEqual([])
  const publishedWrite = await staffRest
    .from('pages')
    .update({ published: { heading: 'Kapret' } })
    .eq('key', 'home')
    .select('id')
  expect(publishedWrite.data).toEqual([])
  await staffRest.auth.signOut()

  const after = await storedHome()
  expect(after.updated_at).toBe(before.updated_at)
  expect(after.published).toEqual(before.published)

  await context.close()
})

test('the Owner is refused a direct write of a published image path — the guard, not the policy', async () => {
  const stored = await storedHome()
  const forged = await rest
    .from('pages')
    .update({ published: { ...stored.published, hero: { ...(stored.published.hero as object), image_id: imageA } } })
    .eq('key', 'home')
    .select('id')

  expect(forged.error?.code).toBe('42501')
  expect((await storedHome()).published).toEqual(stored.published)
})

// ---------------------------------------------------------------------------
// 16. The seed, restored
// ---------------------------------------------------------------------------

test('the run restores the seed: the words, the featured list, no images, no draft', async ({ browser }) => {
  // Six list presses, a save, a publish, a guest read and a library deletion: more
  // round trips than any other test here, so it gets the budget those take.
  test.setTimeout(120_000)

  await openHomeAdmin(ownerPage)
  await saveCard(ownerPage, HOME_CARDS.hero, { Overskrift: seededHeading, 'Kort tekst under': seededIntro })

  // The featured list back to the seeded order: remove everything, add in order.
  await openHomeAdmin(ownerPage)
  while ((await featuredNames(ownerPage)).length > 0) {
    await pressFeatured(ownerPage, 'Fjern', 0, /status=ret_fjernet/)
  }
  for (const name of seededFeatured) {
    await addFeatured(ownerPage, name)
  }
  expect(await featuredNames(ownerPage)).toEqual(seededFeatured)

  await publishHome(ownerPage)

  const guest = await guestHome(browser)
  expect(guest.heading).toBe(seededHeading)
  expect(guest.featured).toEqual(seededFeatured)
  expect(guest.heroSrc).toBeNull()
  expect(guest.awardSrc).toBeNull()
  expect(guest.aboutSrc).toBeNull()

  // The library: A became C in the replacement and C and B were deleted, so nothing
  // should be left — and whatever a failed step might have left is removed through
  // the real confirmation, so the next run starts from an empty library.
  await openImagesAdmin(ownerPage)
  for (const name of [/forside-a\.jpg/, /forside-b\.jpg/, /forside-c\.jpg/]) {
    if ((await gridCard(ownerPage, name).count()) === 0) continue
    await gridCard(ownerPage, name).click()
    await openDeleteDialog(ownerPage)
    await confirmDelete(ownerPage)
    await openImagesAdmin(ownerPage)
  }
  await expect(ownerPage.getByText('Træk billeder hertil')).toBeVisible()

  const { data } = await rest.from('images').select('id')
  expect(data).toEqual([])
  expect((await storedHome()).draft).toBeNull()
})
