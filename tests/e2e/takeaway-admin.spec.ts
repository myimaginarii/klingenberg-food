import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { signIn, STAFF } from './support/admin'
import { ownerRestClient } from './support/home-admin'
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
import { PRIMARY_TEL_HREF } from './support/site'
import {
  addSection,
  chooseTakeawayImage,
  guestTakeaway,
  openTakeawayAdmin,
  pendingBand,
  pickerDialog,
  pressSection,
  previewTakeaway,
  publishTakeaway,
  removeTakeawayImage,
  saveTakeawayCard,
  saveTakeawayVisibility,
  sectionBodies,
  sectionHeadings,
  sitemapListsTakeaway,
  statusNotice,
  TAKEAWAY_ADMIN_PATH,
  TAKEAWAY_CARDS,
  TAKEAWAY_SLOT_ANCHOR,
  takeawayForm,
  takeawayVersion,
  textCard,
} from './support/takeaway-admin'

/**
 * Mad ud af huset administration — phase 11B (brief §29); designs 1aj, 1ai;
 * technical plan §4, §5, §6, §9 (E2E 8), §20.
 *
 * The Staff story, end to end: open the editor, save a heading as a draft while the
 * first guest request stays unchanged, add, move and write sections, preview the draft
 * on the real page, switch the page off as a draft while the guest keeps the page and
 * the navigation item, preview the hidden state, publish — and read the FIRST guest
 * request: the page 404s, the navigation and the sitemap drop it. Then back on with
 * the new content, the photograph through the shared picker (draft, preview, publish,
 * the library's caption, a replacement by Staff, a confirmed deletion), a stale save
 * refused, a smuggled nested key refused at every door, anonymous writes refused, and
 * the seed restored.
 *
 * Every guest read is a fresh, cookie-free context — the FIRST request after the
 * commit under test — and nothing polls or retries. Both dedicated projects run it,
 * 375 first, then 1440.
 */

test.describe.configure({ mode: 'serial' })

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

let staffPage: Page
let rest: SupabaseClient

let seededHeading = ''
let seededIntro = ''
let seededCta = ''
let seededSections: string[] = []
let seededBodies: string[] = []

let imageA = ''

/** Derived from the seed at start, so a run that begins from a previous run's leftovers still differs from it. */
let DRAFT_HEADING = ''
const NEW_SECTION_HEADING = 'Sådan foregår det'
const NEW_SECTION_BODY = 'Ring, så aftaler vi menuen og antallet sammen.'

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

async function noOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
}

/** The stored row, read through the Owner's own JWT (the draft column is not anon's). */
async function storedTakeaway(): Promise<{
  published: Record<string, unknown>
  draft: unknown
  is_visible: boolean
  updated_at: string
}> {
  const { data, error } = await rest
    .from('pages')
    .select('published, draft, is_visible, updated_at')
    .eq('key', 'takeaway')
    .single()
  if (error) throw error
  return data as { published: Record<string, unknown>; draft: unknown; is_visible: boolean; updated_at: string }
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
  rest = await ownerRestClient()

  // Whatever a previous run left behind: no draft.
  await rest.from('pages').update({ draft: null }).eq('key', 'takeaway')

  await openTakeawayAdmin(staffPage)
  seededHeading = await takeawayForm(staffPage, TAKEAWAY_CARDS.text).getByLabel('Overskrift', { exact: true }).inputValue()
  seededIntro = await takeawayForm(staffPage, TAKEAWAY_CARDS.text).getByLabel('Intro', { exact: true }).inputValue()
  seededCta = await takeawayForm(staffPage, TAKEAWAY_CARDS.cta).getByLabel('Tekst på knappen', { exact: true }).inputValue()
  seededSections = await sectionHeadings(staffPage)
  seededBodies = await sectionBodies(staffPage)
  DRAFT_HEADING = `${seededHeading} — kladde`
})

test.afterAll(async () => {
  // Best-effort restoration even after a failure: no draft, no image, an empty library.
  if (rest === undefined) return
  const leftovers = await rest.from('images').select('id, updated_at')
  for (const row of (leftovers.data ?? []) as { id: string; updated_at: string }[]) {
    await rest.rpc('delete_image', { p_id: row.id, p_expected_updated_at: row.updated_at, p_confirmed: true })
  }
  await rest.from('pages').update({ draft: null }).eq('key', 'takeaway')
  await rest.auth.signOut()
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// 1–2. The editor, a draft, the unchanged guest
// ---------------------------------------------------------------------------

test('a staff member opens the editor: 1aj\'s four cards, accessibly, nothing waiting', async () => {
  await openTakeawayAdmin(staffPage)

  for (const card of Object.values(TAKEAWAY_CARDS)) {
    await expect(staffPage.getByRole('heading', { name: card, exact: true })).toBeVisible()
  }
  await expect(staffPage.getByRole('banner').getByRole('link', { name: 'Forhåndsvis' })).toHaveAttribute(
    'href',
    '/api/preview/start?maal=mad-ud-af-huset',
  )
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  // 1aj's own sentences.
  await expect(staffPage.getByText('Slå fra, og både siden og menupunktet forsvinder helt.')).toBeVisible()
  await expect(staffPage.getByText('To-tre linjer. Skriv det, som I ville sige det i telefonen.')).toBeVisible()
  await expect(staffPage.getByText('Uden billede fylder teksten hele bredden.')).toBeVisible()
  await expect(staffPage.getByText(/Knappen ringer altid til det primære nummer fra Kontaktoplysninger — \+45 63 90 83 00\./)).toBeVisible()
  await expect(staffPage.locator(TAKEAWAY_SLOT_ANCHOR)).toHaveText('Vælg billede')

  // The switch is on, and says so in words.
  await expect(takeawayForm(staffPage, TAKEAWAY_CARDS.visibility).getByRole('checkbox')).toBeChecked()
  await expect(staffPage.getByText('Siden og menupunktet vises på hjemmesiden.')).toBeVisible()

  // Nothing invented: no price, no package, no minimum anywhere on the screen.
  const body = (await staffPage.locator('main').innerText()).toLowerCase()
  for (const invented of ['pris', 'pakke', 'minimum', 'levering', 'kuverter']) {
    expect(body, invented).not.toContain(invented)
  }

  expect(await violations(staffPage)).toEqual([])
  expect(await noOverflow(staffPage), 'the editor does not scroll sideways').toBe(true)
})

test('every control in the bar and on the cards is a 44 px target', async () => {
  await openTakeawayAdmin(staffPage)

  const controls = [
    staffPage.getByRole('banner').getByRole('link', { name: 'Forhåndsvis' }),
    staffPage.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ }),
    takeawayForm(staffPage, TAKEAWAY_CARDS.visibility).getByRole('button', { name: 'Gem' }),
    takeawayForm(staffPage, TAKEAWAY_CARDS.text).getByRole('button', { name: 'Gem' }),
    takeawayForm(staffPage, TAKEAWAY_CARDS.sections).getByRole('button', { name: '+ Tilføj tekstafsnit' }),
    takeawayForm(staffPage, TAKEAWAY_CARDS.sections).getByRole('button', { name: 'Gem afsnit' }),
    takeawayForm(staffPage, TAKEAWAY_CARDS.sections).getByRole('button', { name: /^Fjern afsnit 1$/ }),
    takeawayForm(staffPage, TAKEAWAY_CARDS.cta).getByRole('button', { name: 'Gem' }),
    staffPage.locator(TAKEAWAY_SLOT_ANCHOR),
  ]

  for (const control of controls) {
    const box = await control.first().boundingBox()
    expect(box, 'the control is on screen').not.toBeNull()
    expect(box!.height, 'at least 44 px tall').toBeGreaterThanOrEqual(44)
  }

  // The switch's track is keyboard-operable: Tab to it, Space flips it, nothing saves.
  const toggle = takeawayForm(staffPage, TAKEAWAY_CARDS.visibility).getByRole('checkbox')
  await toggle.focus()
  await staffPage.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
  await staffPage.keyboard.press('Space')
  await expect(toggle).toBeChecked()
})

test('saving a heading writes a draft: the card says Kladde, the band names the card', async () => {
  await saveTakeawayCard(staffPage, TAKEAWAY_CARDS.text, { Overskrift: DRAFT_HEADING })

  await expect(statusNotice(staffPage)).toContainText('Gemt som kladde')
  await expect(pendingBand(staffPage)).toContainText('Tekst afventer offentliggørelse.')
  await expect(textCard(staffPage).getByText('Kladde', { exact: true })).toBeVisible()

  const stored = await storedTakeaway()
  expect(stored.draft).toEqual({ heading: DRAFT_HEADING })
  expect(stored.published.heading).toBe(seededHeading)

  expect(await violations(staffPage)).toEqual([])
})

test('the first guest request is unchanged — a draft moves nothing', async ({ browser }) => {
  const guest = await guestTakeaway(browser)
  expect(guest.status).toBe(200)
  expect(guest.heading).toBe(seededHeading)
  expect(guest.sections).toEqual(seededSections)
  expect(guest.inFooterNav).toBe(true)
  expect(guest.imageSrc).toBeNull()
})

test('Forhåndsvis shows the draft heading on the real page', async () => {
  const preview = await previewTakeaway(staffPage)
  expect(preview.status).toBe(200)
  expect(preview.heading).toBe(DRAFT_HEADING)
  expect(preview.sections).toEqual(seededSections)
})

test('a validation refusal is bound to its field and echoes what was typed', async () => {
  await openTakeawayAdmin(staffPage)
  const form = takeawayForm(staffPage, TAKEAWAY_CARDS.text)
  const tooLong = 'x'.repeat(121)

  const heading = form.getByLabel('Overskrift', { exact: true })
  await heading.evaluate((element) => element.removeAttribute('maxlength'))
  await heading.fill(tooLong)
  await form.getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/status=ugyldig/)

  const field = takeawayForm(staffPage, TAKEAWAY_CARDS.text).getByLabel('Overskrift', { exact: true })
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveValue(tooLong)
  const describedBy = await field.getAttribute('aria-describedby')
  await expect(staffPage.locator(`#${describedBy!.split(' ').pop()}`)).toContainText('højst være 120 tegn')

  expect((await storedTakeaway()).draft).toEqual({ heading: DRAFT_HEADING })
  expect(await violations(staffPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// 3. The sections: add, write, move, remove — all drafts
// ---------------------------------------------------------------------------

test('Tilføj tekstafsnit adds an empty section the person then writes and saves', async ({ browser }) => {
  await openTakeawayAdmin(staffPage)
  await addSection(staffPage)
  await expect(statusNotice(staffPage)).toContainText('Afsnittet er tilføjet i kladden')

  const count = seededSections.length + 1
  await expect(staffPage).toHaveURL(new RegExp(`#tekstafsnit-${count}$`))
  expect(await sectionHeadings(staffPage)).toEqual([...seededSections, ''])

  await saveTakeawayCard(
    staffPage,
    TAKEAWAY_CARDS.sections,
    {
      [`Afsnit ${count} Overskrift på afsnittet`]: NEW_SECTION_HEADING,
      [`Afsnit ${count} Skriv afsnittet her`]: NEW_SECTION_BODY,
    },
    'Gem afsnit',
  )
  await expect(statusNotice(staffPage)).toContainText('Gemt som kladde')
  await expect(pendingBand(staffPage)).toContainText('Tekst og Tekstafsnit afventer offentliggørelse.')

  const stored = await storedTakeaway()
  const sections = (stored.draft as { sections: { id: string; heading: string | null; sort: number }[] }).sections
  expect(sections).toHaveLength(count)
  expect(sections[count - 1]).toEqual({ id: `afsnit-${count}`, heading: NEW_SECTION_HEADING, body: NEW_SECTION_BODY, sort: count })

  // The guest still reads the seeded sections; the preview reads the new one.
  expect((await guestTakeaway(browser)).sections).toEqual(seededSections)
  expect((await previewTakeaway(staffPage)).sections).toEqual([...seededSections, NEW_SECTION_HEADING])
})

test('Flyt op and Fjern are drafts too, with a keyboard, and the list keeps every section once', async () => {
  await openTakeawayAdmin(staffPage)
  const count = seededSections.length + 1

  await pressSection(staffPage, 'Flyt op', count - 1, /status=afsnit_flyttet/)
  const moved = await sectionHeadings(staffPage)
  expect(moved[count - 2]).toBe(NEW_SECTION_HEADING)
  expect(moved).toHaveLength(count)

  // Keyboard: focus the first section's Fjern and press Enter.
  await takeawayForm(staffPage, TAKEAWAY_CARDS.sections).getByRole('button', { name: /^Fjern afsnit 1$/ }).focus()
  const version = await takeawayVersion(staffPage)
  await staffPage.keyboard.press('Enter')
  await expect.poll(async () => (await takeawayVersion(staffPage)) !== version).toBe(true)
  await expect(staffPage).toHaveURL(/status=afsnit_fjernet/)
  expect(await sectionHeadings(staffPage)).toHaveLength(count - 1)

  expect(await violations(staffPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// 4–6. The switch: a draft, previewed, published — page, navigation and sitemap
// ---------------------------------------------------------------------------

test('switching the page off is a draft: the guest keeps the page and the menu item', async ({ browser }) => {
  await openTakeawayAdmin(staffPage)
  await saveTakeawayVisibility(staffPage, false)

  await expect(statusNotice(staffPage)).toContainText('forsvinder både siden og menupunktet')
  await expect(pendingBand(staffPage)).toContainText('Synligheden')
  await expect(staffPage.getByText('Siden vises på hjemmesiden lige nu. Når du offentliggør, forsvinder både siden og menupunktet.')).toBeVisible()

  const stored = await storedTakeaway()
  expect((stored.draft as { is_visible: boolean }).is_visible).toBe(false)
  expect(stored.is_visible).toBe(true)

  const guest = await guestTakeaway(browser)
  expect(guest.status).toBe(200)
  expect(guest.inFooterNav).toBe(true)
  expect(await sitemapListsTakeaway(browser)).toBe(true)

  expect(await violations(staffPage)).toEqual([])
})

test('the preview shows the hidden state: 404, and no menu item beside it', async () => {
  const preview = await previewTakeaway(staffPage)
  expect(preview.status).toBe(404)
  expect(preview.inFooterNav).toBe(false)
})

test('publishing hides the page, the menu item and the sitemap entry on the FIRST guest request', async ({ browser }) => {
  await publishTakeaway(staffPage)
  await expect(statusNotice(staffPage)).toContainText('Mad ud af huset er opdateret på hjemmesiden.')
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(staffPage.getByText('Siden er skjult — hverken siden eller menupunktet vises på hjemmesiden.')).toBeVisible()

  const guest = await guestTakeaway(browser)
  expect(guest.status).toBe(404)
  expect(guest.inFooterNav).toBe(false)
  expect(guest.inDesktopNav).toBe(false)
  expect(await sitemapListsTakeaway(browser)).toBe(false)

  const stored = await storedTakeaway()
  expect(stored.is_visible).toBe(false)
  expect(stored.draft).toBeNull()
  expect(stored.published).not.toHaveProperty('is_visible')
  expect(stored.published.heading).toBe(DRAFT_HEADING)
})

test('the hidden public state has no accessibility violations, at this width', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/mad-ud-af-huset')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vi kunne ikke finde siden')
  expect(await violations(page)).toEqual([])
  expect(await noOverflow(page)).toBe(true)
  await context.close()
})

test('switching it back on, published, brings the page, the item and the sitemap entry back at once', async ({
  browser,
}) => {
  await openTakeawayAdmin(staffPage)
  await saveTakeawayVisibility(staffPage, true)
  await expect(statusNotice(staffPage)).toContainText('vises både siden og menupunktet på hjemmesiden igen')

  // Still hidden for the guest until publish.
  expect((await guestTakeaway(browser)).status).toBe(404)

  await publishTakeaway(staffPage)
  const guest = await guestTakeaway(browser)
  expect(guest.status).toBe(200)
  expect(guest.heading).toBe(DRAFT_HEADING)
  expect(guest.sections).toContain(NEW_SECTION_HEADING)
  expect(guest.inFooterNav).toBe(true)
  expect(guest.ctaHref).toBe(PRIMARY_TEL_HREF)
  expect(await sitemapListsTakeaway(browser)).toBe(true)
})

test('the published page works without scripting and has no accessibility violations', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/mad-ud-af-huset')
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(DRAFT_HEADING)
  await expect(page.getByRole('main').locator('a[href^="tel:"]').first()).toHaveAttribute('href', PRIMARY_TEL_HREF)
  await context.close()

  const scanned = await browser.newContext()
  const scan = await scanned.newPage()
  await scan.goto('/mad-ud-af-huset')
  expect(await violations(scan)).toEqual([])
  await scanned.close()
})

// ---------------------------------------------------------------------------
// 7–10. The photograph: chosen, previewed, published, replaced, deleted
// ---------------------------------------------------------------------------

test('a staff member uploads an image and chooses it for the page — a draft', async ({ browser }) => {
  await openImagesAdmin(staffPage)
  imageA = await uploadViaUi(staffPage, {
    name: 'selskab-a.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 900, 60),
  })

  await openTakeawayAdmin(staffPage)
  await staffPage.locator(TAKEAWAY_SLOT_ANCHOR).focus()
  await staffPage.keyboard.press('Enter')
  await expect(pickerDialog(staffPage)).toBeVisible()
  await expect(pickerDialog(staffPage).getByRole('link', { name: 'Annuller' })).toBeFocused()
  expect(await violations(staffPage)).toEqual([])
  await staffPage.keyboard.press('Escape')
  await expect(pickerDialog(staffPage)).toHaveCount(0)
  await expect(staffPage.locator(TAKEAWAY_SLOT_ANCHOR)).toBeFocused()

  await chooseTakeawayImage(staffPage, /selskab-a\.jpg/)
  await expect(statusNotice(staffPage)).toContainText('Billedet er gemt som kladde')
  await expect(textCard(staffPage).getByRole('button', { name: 'Fjern billede' })).toBeVisible()

  const stored = await storedTakeaway()
  expect(stored.draft).toEqual({ image_id: imageA })

  await openImagesAdmin(staffPage)
  await expect(staffPage.getByText('Bruges på: Mad ud af huset (kladde)', { exact: true }).first()).toBeVisible()

  expect((await guestTakeaway(browser)).imageSrc).toBeNull()
  expect((await previewTakeaway(staffPage)).imageSrc).toContain('/storage/v1/object/public/media/')
})

test('publishing puts the photograph on the FIRST guest request, in 1ai\'s frame', async ({ browser }) => {
  await publishTakeaway(staffPage)

  const guest = await guestTakeaway(browser)
  expect(guest.imageSrc).toContain('/storage/v1/object/public/media/')
  expect(guest.imageSrc).not.toContain('media-originals')
  expect(guest.heading).toBe(DRAFT_HEADING)

  const stored = await storedTakeaway()
  expect(stored.published.image_id).toBe(imageA)
  expect(stored.draft).toBeNull()

  await openImagesAdmin(staffPage)
  await expect(staffPage.getByText('Bruges på: Mad ud af huset', { exact: true }).first()).toBeVisible()

  const scanned = await browser.newContext()
  const scan = await scanned.newPage()
  await scan.goto('/mad-ud-af-huset')
  expect(await violations(scan)).toEqual([])
  await scanned.close()
})

test('a staff member may replace the page\'s image in the library — no owner_only — and the guest gets the successor', async ({
  browser,
}) => {
  const before = await guestTakeaway(browser)

  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /selskab-a\.jpg/).click()
  await expect(staffPage.getByText('Bruges på: Mad ud af huset. Sletter du det')).toBeVisible()
  await expect(staffPage.getByText('som kun ejeren kan rette')).toHaveCount(0)
  await staffPage.getByRole('link', { name: 'Erstat', exact: true }).click()
  await replaceInput(staffPage).setInputFiles({
    name: 'selskab-b.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 900, 200),
  })
  await staffPage.waitForURL(/status=erstattet/, { timeout: 30_000 })

  const after = await guestTakeaway(browser)
  expect(after.imageSrc).not.toBeNull()
  expect(after.imageSrc).not.toBe(before.imageSrc)
  expect((await storedTakeaway()).published.image_id).not.toBe(imageA)
})

test('Fjern billede is a pending removal; published, the text takes the whole width again', async ({ browser }) => {
  await openTakeawayAdmin(staffPage)
  await removeTakeawayImage(staffPage)
  await expect(statusNotice(staffPage)).toContainText('bliver i billedbiblioteket')
  expect((await storedTakeaway()).draft).toEqual({ image_id: null })
  expect((await guestTakeaway(browser)).imageSrc).not.toBeNull()
  expect((await previewTakeaway(staffPage)).imageSrc).toBeNull()

  await publishTakeaway(staffPage)
  const guest = await guestTakeaway(browser)
  expect(guest.imageSrc).toBeNull()
  expect((await storedTakeaway()).published.image_id).toBeNull()

  await openImagesAdmin(staffPage)
  await expect(staffPage.getByText('Bruges ikke endnu', { exact: true }).first()).toBeVisible()
})

test('a confirmed deletion of a draft-only image clears exactly the pending selection', async () => {
  await openTakeawayAdmin(staffPage)
  await chooseTakeawayImage(staffPage, /selskab-b\.jpg/)
  expect((await storedTakeaway()).draft).toHaveProperty('image_id')

  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /selskab-b\.jpg/).click()
  await openDeleteDialog(staffPage)
  await confirmDelete(staffPage)

  expect((await storedTakeaway()).draft).toBeNull()
  await openTakeawayAdmin(staffPage)
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(staffPage.locator(TAKEAWAY_SLOT_ANCHOR)).toHaveText('Vælg billede')
})

// ---------------------------------------------------------------------------
// 11–12. Two tabs; a smuggled nested key; anonymous writes
// ---------------------------------------------------------------------------

test('a second tab that started from an older version is refused, not overwritten', async ({ browser }) => {
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await signIn(otherPage, STAFF)

  await openTakeawayAdmin(staffPage)
  await openTakeawayAdmin(otherPage)
  const version = await takeawayVersion(staffPage)
  expect(await takeawayVersion(otherPage)).toBe(version)

  await saveTakeawayCard(otherPage, TAKEAWAY_CARDS.cta, { 'Tekst på knappen': 'Første redaktør vandt' })
  await expect(statusNotice(otherPage)).toContainText('Gemt som kladde')

  await saveTakeawayCard(staffPage, TAKEAWAY_CARDS.cta, { 'Tekst på knappen': 'Anden redaktør, for sent' })
  await expect(statusNotice(staffPage)).toContainText('Nogen andre har rettet dette')

  const stored = await storedTakeaway()
  expect((stored.draft as { cta_label: string }).cta_label).toBe('Første redaktør vandt')
  expect(stored.updated_at).not.toBe(version)

  // Reloading gives the current version; saving the published label takes it back out.
  await openTakeawayAdmin(staffPage)
  await saveTakeawayCard(staffPage, TAKEAWAY_CARDS.cta, { 'Tekst på knappen': seededCta })
  await expect(statusNotice(staffPage)).toContainText('venter ingen ændring')
  expect((await storedTakeaway()).draft).toBeNull()

  await other.close()
})

test('a section written past the editor with an unexpected key goes nowhere: unreadable, absent from the preview, refused at publish', async () => {
  const before = await storedTakeaway()
  const smuggled = {
    sections: [{ id: 'afsnit-1', heading: 'Smuglet', body: null, sort: 1, price_ore: 4900 }],
  }

  // A Staff JWT may write `pages.draft` directly — RLS admits the row — and the
  // strict schema is the application's door. So the draft must go NOWHERE.
  const staffRest = await staffRestClient()
  const written = await staffRest.from('pages').update({ draft: smuggled }).eq('key', 'takeaway').select('id')
  expect(written.error).toBeNull()
  expect(written.data).toHaveLength(1)
  await staffRest.auth.signOut({ scope: 'local' })

  await openTakeawayAdmin(staffPage)
  await expect(staffPage.getByText('Den gemte kladde kan ikke læses')).toBeVisible()
  await expect(pendingBand(staffPage)).toHaveCount(0)
  expect(await sectionHeadings(staffPage)).not.toContain('Smuglet')

  const preview = await previewTakeaway(staffPage)
  expect(preview.sections).not.toContain('Smuglet')

  await publishTakeaway(staffPage)
  await expect(staffPage).toHaveURL(/status=invalid_draft/)
  await expect(statusNotice(staffPage)).toContainText('kan ikke offentliggøres')

  const after = await storedTakeaway()
  expect(after.published).toEqual(before.published)
  expect(after.draft).toEqual(smuggled)

  // "Gem felterne igen" replaces the unreadable draft.
  await openTakeawayAdmin(staffPage)
  await saveTakeawayCard(staffPage, TAKEAWAY_CARDS.sections, {}, 'Gem afsnit')
  await expect(statusNotice(staffPage)).toContainText('venter ingen ændring')
  expect((await storedTakeaway()).draft).toBeNull()
})

test('an anonymous request cannot write the page, its draft or its switch', async () => {
  const anon = await staffRestClient()
  await anon.auth.signOut({ scope: 'local' })

  const draftWrite = await anon.from('pages').update({ draft: { heading: 'Kapret' } }).eq('key', 'takeaway').select('id')
  expect(draftWrite.error?.code ?? '42501').toBe('42501')
  const switchWrite = await anon.from('pages').update({ is_visible: false }).eq('key', 'takeaway').select('id')
  expect(switchWrite.error?.code ?? '42501').toBe('42501')

  // And a signed-in staff member is refused the switch column directly — the guard.
  const staffRest = await staffRestClient()
  const direct = await staffRest.from('pages').update({ is_visible: false }).eq('key', 'takeaway').select('id')
  expect(direct.error?.code).toBe('42501')
  await staffRest.auth.signOut({ scope: 'local' })

  expect((await storedTakeaway()).is_visible).toBe(true)
})

// ---------------------------------------------------------------------------
// 13. The seed, restored
// ---------------------------------------------------------------------------

test('the run restores the seed: the words, the sections, the button, visible, no image, no draft', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  await openTakeawayAdmin(staffPage)
  await saveTakeawayCard(staffPage, TAKEAWAY_CARDS.text, { Overskrift: seededHeading, Intro: seededIntro })

  // The sections back to the seeded list: remove everything, add and write in order.
  await openTakeawayAdmin(staffPage)
  while ((await sectionHeadings(staffPage)).length > 0) {
    await pressSection(staffPage, 'Fjern', 0, /status=afsnit_fjernet/)
  }
  for (let index = 0; index < seededSections.length; index += 1) {
    await addSection(staffPage)
  }
  expect(await sectionHeadings(staffPage)).toHaveLength(seededSections.length)
  const fields: Record<string, string> = {}
  seededSections.forEach((heading, index) => {
    fields[`Afsnit ${index + 1} Overskrift på afsnittet`] = heading
    fields[`Afsnit ${index + 1} Skriv afsnittet her`] = seededBodies[index] ?? ''
  })
  if (seededSections.length > 0) await saveTakeawayCard(staffPage, TAKEAWAY_CARDS.sections, fields, 'Gem afsnit')

  await publishTakeaway(staffPage)

  const guest = await guestTakeaway(browser)
  expect(guest.status).toBe(200)
  expect(guest.heading).toBe(seededHeading)
  expect(guest.sections).toEqual(seededSections)
  expect(guest.imageSrc).toBeNull()
  expect(guest.inFooterNav).toBe(true)

  await openImagesAdmin(staffPage)
  for (const name of [/selskab-a\.jpg/, /selskab-b\.jpg/]) {
    if ((await gridCard(staffPage, name).count()) === 0) continue
    await gridCard(staffPage, name).click()
    await openDeleteDialog(staffPage)
    await confirmDelete(staffPage)
    await openImagesAdmin(staffPage)
  }

  const { data } = await rest.from('images').select('id')
  expect(data).toEqual([])
  const stored = await storedTakeaway()
  expect(stored.draft).toBeNull()
  expect(stored.is_visible).toBe(true)
})

test('the tile is on the dashboard for a staff member, and the address is theirs', async () => {
  await staffPage.goto('/admin')
  await staffPage.getByRole('link', { name: 'Mad ud af huset', exact: true }).click()
  await expect(staffPage).toHaveURL(TAKEAWAY_ADMIN_PATH)
})
