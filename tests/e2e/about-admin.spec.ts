import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  ABOUT_ADMIN_PATH,
  ABOUT_CARDS,
  ABOUT_SLOT_ANCHOR,
  aboutForm,
  aboutVersion,
  chooseSlotImage,
  guestAbout,
  openAboutAdmin,
  pendingBand,
  pickerDialog,
  previewAbout,
  publishAbout,
  removeSlotImage,
  saveAboutCard,
  slotCard,
  statusNotice,
} from './support/about-admin'
import { signIn, STAFF } from './support/admin'
import { ownerRestClient } from './support/home-admin'
import {
  confirmDelete,
  gridCard,
  jpegFixture,
  openDeleteDialog,
  openImagesAdmin,
  replaceInput,
  saveAlt,
  staffRestClient,
  uploadViaUi,
} from './support/images-admin'

/**
 * Om os administration — phase 14B1; design 1i; technical plan §4, §5, §6, §9, §20.
 *
 * The Staff story, end to end: open the editor, save the story as a draft while the
 * first guest request stays unchanged, preview it on the real page, save the team and
 * the method, choose the facade, team and kitchen photographs through the shared
 * picker (draft, preview with the library's alt, publish, the library's caption, a
 * replacement by Staff, a pending removal, a confirmed deletion of a draft-only
 * image), a stale save refused, smuggled nested keys and a malformed image id refused
 * at every door, anonymous and direct writes refused, the longest content the schema
 * allows kept legible, and the seed restored.
 *
 * Every guest read is a fresh, cookie-free context — the FIRST request after the
 * commit under test — and nothing polls or retries. Both dedicated projects run it,
 * 375 first, then 1440.
 */

test.describe.configure({ mode: 'serial' })

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

let staffPage: Page
let rest: SupabaseClient

let seeded: { heading: string; story: string; team: string; methodHeading: string; methodText: string }

let imageA = ''
let imageB = ''

const ALT_A = 'Indgangen ved hallen, en sommereftermiddag.'
const DRAFT_STORY = ['Første afsnit fra kladden.', 'Andet afsnit fra kladden.']
const DRAFT_TEAM = 'Holdet fra kladden — ingen navne.'
const DRAFT_METHOD_HEADING = 'Sådan laver vi burgere — kladde'
const DRAFT_METHOD_TEXT = 'Metoden fra kladden.'

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

async function isPhone(page: Page): Promise<boolean> {
  return (page.viewportSize()?.width ?? 1440) < 768
}

/** The stored row, read through the Owner's own JWT (the draft column is not anon's). */
async function storedAbout(): Promise<{ published: Record<string, unknown>; draft: unknown; updated_at: string }> {
  const { data, error } = await rest.from('pages').select('published, draft, updated_at').eq('key', 'about').single()
  if (error) throw error
  return data as { published: Record<string, unknown>; draft: unknown; updated_at: string }
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
  rest = await ownerRestClient()

  // Whatever a previous run left behind: no draft.
  await rest.from('pages').update({ draft: null }).eq('key', 'about')

  await openAboutAdmin(staffPage)
  seeded = {
    heading: await aboutForm(staffPage, ABOUT_CARDS.story).getByLabel('Overskrift', { exact: true }).inputValue(),
    story: await aboutForm(staffPage, ABOUT_CARDS.story).getByLabel('Historien', { exact: true }).inputValue(),
    team: await aboutForm(staffPage, ABOUT_CARDS.team).getByLabel('Tekst om holdet', { exact: true }).inputValue(),
    methodHeading: await aboutForm(staffPage, ABOUT_CARDS.method).getByLabel('Overskrift', { exact: true }).inputValue(),
    methodText: await aboutForm(staffPage, ABOUT_CARDS.method).getByLabel('Tekst', { exact: true }).inputValue(),
  }
})

test.afterAll(async () => {
  // Best-effort restoration even after a failure: no draft, no images, an empty library.
  if (rest === undefined) return
  const leftovers = await rest.from('images').select('id, updated_at')
  for (const row of (leftovers.data ?? []) as { id: string; updated_at: string }[]) {
    await rest.rpc('delete_image', { p_id: row.id, p_expected_updated_at: row.updated_at, p_confirmed: true })
  }
  await rest.from('pages').update({ draft: null }).eq('key', 'about')
  await rest.auth.signOut()
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// 1–2. The editor, a draft, the unchanged guest
// ---------------------------------------------------------------------------

test('a staff member opens the editor: three cards, three slots, accessibly, nothing waiting', async () => {
  await openAboutAdmin(staffPage)

  for (const card of Object.values(ABOUT_CARDS)) {
    await expect(staffPage.getByRole('heading', { name: card, exact: true })).toBeVisible()
  }
  await expect(staffPage.getByRole('banner').getByRole('link', { name: 'Forhåndsvis' })).toHaveAttribute(
    'href',
    '/api/preview/start?maal=om-os',
  )
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  // 1i's own guidance, as the slots' helpers, and the three empty slots.
  await expect(staffPage.getByText(/Facaden eller indgangen ved hallen/)).toBeVisible()
  await expect(staffPage.getByText(/Ét bredt billede af hele holdet samlet/)).toBeVisible()
  await expect(staffPage.getByText(/Køkkenet eller tilberedningen/)).toBeVisible()
  for (const anchor of Object.values(ABOUT_SLOT_ANCHOR)) {
    await expect(staffPage.locator(anchor)).toHaveText('Vælg billede')
  }

  // The published words are in the fields, the story as paragraphs separated by a blank line.
  expect(seeded.heading.length).toBeGreaterThan(0)
  expect(seeded.story.split('\n\n').length).toBeGreaterThanOrEqual(1)
  expect(seeded.methodHeading.length).toBeGreaterThan(0)

  // Nothing invented: exactly the five fields the page consumes — no award field, no
  // name or role field, no link field.
  const labels = await staffPage
    .locator('main')
    .locator('input:not([type=hidden]), textarea')
    .evaluateAll((fields) =>
      fields.map((field) => document.querySelector(`label[for="${field.id}"]`)?.textContent?.trim() ?? ''),
    )
  expect(labels).toEqual(['Overskrift', 'Historien', 'Tekst om holdet', 'Overskrift', 'Tekst'])

  expect(await violations(staffPage)).toEqual([])
  expect(await noOverflow(staffPage), 'the editor does not scroll sideways').toBe(true)
})

test('every control in the bar and on the cards is a 44 px target, and every field is at least 16 px', async () => {
  await openAboutAdmin(staffPage)

  const controls = [
    staffPage.getByRole('banner').getByRole('link', { name: 'Oversigt' }),
    staffPage.getByRole('banner').getByRole('link', { name: 'Forhåndsvis' }),
    staffPage.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ }),
    aboutForm(staffPage, ABOUT_CARDS.story).getByRole('button', { name: 'Gem' }),
    aboutForm(staffPage, ABOUT_CARDS.team).getByRole('button', { name: 'Gem' }),
    aboutForm(staffPage, ABOUT_CARDS.method).getByRole('button', { name: 'Gem' }),
    ...Object.values(ABOUT_SLOT_ANCHOR).map((anchor) => staffPage.locator(anchor)),
  ]

  for (const control of controls) {
    const box = await control.first().boundingBox()
    expect(box, 'the control is on screen').not.toBeNull()
    expect(box!.height, 'at least 44 px tall').toBeGreaterThanOrEqual(44)
  }

  const sizes = await staffPage
    .locator('input:not([type=hidden]), textarea')
    .evaluateAll((fields) => fields.map((field) => parseFloat(getComputedStyle(field).fontSize)))
  expect(sizes).toHaveLength(5)
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16)

  // The focus ring is the design's own 3 px, visible on a field.
  const heading = aboutForm(staffPage, ABOUT_CARDS.story).getByLabel('Overskrift', { exact: true })
  await heading.focus()
  const outline = await heading.evaluate((element) => getComputedStyle(element).outlineWidth)
  expect(parseFloat(outline)).toBeGreaterThanOrEqual(3)
})

test('saving the story writes a draft: the card says Kladde, the band names the card, the notice is in view', async () => {
  await saveAboutCard(staffPage, ABOUT_CARDS.story, {
    Overskrift: `${seeded.heading} — kladde`,
    Historien: DRAFT_STORY.join('\n\n'),
  })

  await expect(statusNotice(staffPage)).toContainText('Gemt som kladde')
  await expect(pendingBand(staffPage)).toContainText('Historien afventer offentliggørelse.')
  await expect(slotCard(staffPage, ABOUT_CARDS.story).getByText('Kladde', { exact: true })).toBeVisible()
  await expect(slotCard(staffPage, ABOUT_CARDS.team).getByText('Kladde', { exact: true })).toHaveCount(0)

  // 1y's foot: on the phone the notice is inside the viewport at the moment it appears.
  if (await isPhone(staffPage)) {
    const box = await statusNotice(staffPage).boundingBox()
    const height = staffPage.viewportSize()!.height
    expect(box, 'the notice is rendered').not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1)
  }

  const stored = await storedAbout()
  expect(stored.draft).toEqual({ heading: `${seeded.heading} — kladde`, story_blocks: DRAFT_STORY })
  expect(stored.published.heading).toBe(seeded.heading)

  expect(await violations(staffPage)).toEqual([])
})

test('the first guest request is unchanged — a draft moves nothing', async ({ browser }) => {
  const guest = await guestAbout(browser)
  expect(guest.heading).toBe(seeded.heading)
  expect(guest.story).toEqual(seeded.story.split('\n\n'))
  expect(guest.venue).toBeNull()
  expect(guest.team).toBeNull()
  expect(guest.kitchen).toBeNull()
})

test('Forhåndsvis shows the draft words on the real page — and only there', async () => {
  const preview = await previewAbout(staffPage)
  expect(preview.heading).toBe(`${seeded.heading} — kladde`)
  expect(preview.story).toEqual(DRAFT_STORY)
  expect(preview.teamText).toBe(seeded.team)
})

test('a validation refusal is bound to its field and echoes what was typed', async () => {
  await openAboutAdmin(staffPage)
  const form = aboutForm(staffPage, ABOUT_CARDS.story)

  // Eleven paragraphs: one too many for the schema, well inside the echo budget.
  const eleven = Array.from({ length: 11 }, (_, index) => `Afsnit ${index + 1}`).join('\n\n')
  const heading = form.getByLabel('Overskrift', { exact: true })
  await heading.evaluate((element) => element.removeAttribute('maxlength'))
  await heading.fill('x'.repeat(121))
  await form.getByLabel('Historien', { exact: true }).fill(eleven)
  await form.getByRole('button', { name: 'Gem' }).click()
  await staffPage.waitForURL(/status=ugyldig/)

  const echoedHeading = aboutForm(staffPage, ABOUT_CARDS.story).getByLabel('Overskrift', { exact: true })
  await expect(echoedHeading).toHaveAttribute('aria-invalid', 'true')
  await expect(echoedHeading).toHaveValue('x'.repeat(121))
  const headingDescribedBy = await echoedHeading.getAttribute('aria-describedby')
  await expect(staffPage.locator(`#${headingDescribedBy!.split(' ').pop()}`)).toContainText('højst være 120 tegn')

  const echoedStory = aboutForm(staffPage, ABOUT_CARDS.story).getByLabel('Historien', { exact: true })
  await expect(echoedStory).toHaveAttribute('aria-invalid', 'true')
  await expect(echoedStory).toHaveValue(eleven)
  const storyDescribedBy = await echoedStory.getAttribute('aria-describedby')
  await expect(staffPage.locator(`#${storyDescribedBy!.split(' ').pop()}`)).toContainText('højst have 10 afsnit')

  // Nothing was written: the draft is exactly the one the previous save left.
  expect((await storedAbout()).draft).toEqual({ heading: `${seeded.heading} — kladde`, story_blocks: DRAFT_STORY })
  expect(await violations(staffPage)).toEqual([])
})

test('the team and the method save as drafts too; the band names all three cards', async () => {
  await openAboutAdmin(staffPage)
  await saveAboutCard(staffPage, ABOUT_CARDS.team, { 'Tekst om holdet': DRAFT_TEAM })
  await expect(statusNotice(staffPage)).toContainText('Gemt som kladde')

  await saveAboutCard(staffPage, ABOUT_CARDS.method, { Overskrift: DRAFT_METHOD_HEADING, Tekst: DRAFT_METHOD_TEXT })
  await expect(statusNotice(staffPage)).toContainText('Gemt som kladde')
  await expect(pendingBand(staffPage)).toContainText(
    'Historien, Holdet og Køkken og tilberedning afventer offentliggørelse.',
  )

  const stored = await storedAbout()
  expect(stored.draft).toEqual({
    heading: `${seeded.heading} — kladde`,
    story_blocks: DRAFT_STORY,
    team: { text: DRAFT_TEAM, image_id: null },
    method: { heading: DRAFT_METHOD_HEADING, text: DRAFT_METHOD_TEXT, image_id: null },
  })
})

// ---------------------------------------------------------------------------
// 3–6. The three photographs: chosen, previewed with the library's alt, published
// ---------------------------------------------------------------------------

test('a staff member uploads two images, describes one, and chooses all three slots — drafts', async ({ browser }) => {
  await openImagesAdmin(staffPage)
  imageA = await uploadViaUi(staffPage, {
    name: 'facade-a.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 1500, 60),
  })
  await saveAlt(staffPage, ALT_A)

  await openImagesAdmin(staffPage)
  imageB = await uploadViaUi(staffPage, {
    name: 'koekken-b.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 200),
  })

  await openAboutAdmin(staffPage)

  // Keyboard first: the slot opens the picker, Annuller has focus, Escape gives it back.
  await staffPage.locator(ABOUT_SLOT_ANCHOR.sted).focus()
  await staffPage.keyboard.press('Enter')
  await expect(pickerDialog(staffPage)).toBeVisible()
  await expect(pickerDialog(staffPage).getByRole('link', { name: 'Annuller' })).toBeFocused()
  expect(await noOverflow(staffPage), 'the picker fits the screen').toBe(true)
  expect(await violations(staffPage)).toEqual([])
  await staffPage.keyboard.press('Escape')
  await expect(pickerDialog(staffPage)).toHaveCount(0)
  await expect(staffPage.locator(ABOUT_SLOT_ANCHOR.sted)).toBeFocused()

  await chooseSlotImage(staffPage, 'sted', /facade-a\.jpg|Indgangen ved hallen/)
  await expect(statusNotice(staffPage)).toContainText('Billedet er gemt som kladde')
  await expect(slotCard(staffPage, ABOUT_CARDS.story).getByRole('button', { name: 'Fjern billede' })).toBeVisible()

  await chooseSlotImage(staffPage, 'holdet', /facade-a\.jpg|Indgangen ved hallen/)
  await chooseSlotImage(staffPage, 'koekken', /koekken-b\.jpg/)
  await expect(pendingBand(staffPage)).toContainText(
    'Historien, Billedet af stedet, Holdet og Køkken og tilberedning afventer offentliggørelse.',
  )

  const stored = await storedAbout()
  expect(stored.draft).toEqual({
    heading: `${seeded.heading} — kladde`,
    story_blocks: DRAFT_STORY,
    venue_image_id: imageA,
    team: { text: DRAFT_TEAM, image_id: imageA },
    method: { heading: DRAFT_METHOD_HEADING, text: DRAFT_METHOD_TEXT, image_id: imageB },
  })

  // The library names the place once, however many slots name the image, and marks it pending.
  await openImagesAdmin(staffPage)
  await expect(staffPage.getByText('Bruges på: Om os (kladde)', { exact: true }).first()).toBeVisible()
  await expect(staffPage.getByText(/Om os · Om os/)).toHaveCount(0)

  const guest = await guestAbout(browser)
  expect(guest.venue).toBeNull()
  expect(guest.team).toBeNull()
  expect(guest.kitchen).toBeNull()
})

test('the preview renders the three pending photographs with the library\'s alt and no private original', async () => {
  const preview = await previewAbout(staffPage)
  expect(preview.venue?.src).toContain('/storage/v1/object/public/media/')
  expect(preview.venue?.alt).toBe(ALT_A)
  expect(preview.team?.alt).toBe(ALT_A)
  expect(preview.kitchen?.src).toContain('/storage/v1/object/public/media/')
  // The undescribed kitchen photograph is decorative beside its heading: an empty alt (§0y).
  expect(preview.kitchen?.alt).toBe('')
  expect(preview.namesOriginal).toBe(false)
  expect(preview.venue?.src).not.toBe(preview.kitchen?.src)
})

test('publishing puts the words and the three photographs on the FIRST guest request', async ({ browser }) => {
  await publishAbout(staffPage)
  await expect(statusNotice(staffPage)).toContainText('Om os er opdateret på hjemmesiden.')
  await expect(pendingBand(staffPage)).toHaveCount(0)

  const guest = await guestAbout(browser)
  expect(guest.heading).toBe(`${seeded.heading} — kladde`)
  expect(guest.story).toEqual(DRAFT_STORY)
  expect(guest.teamText).toBe(DRAFT_TEAM)
  expect(guest.methodHeading).toBe(DRAFT_METHOD_HEADING)
  expect(guest.methodText).toBe(DRAFT_METHOD_TEXT)
  expect(guest.venue?.alt).toBe(ALT_A)
  expect(guest.team?.alt).toBe(ALT_A)
  expect(guest.kitchen?.src).toContain('/storage/v1/object/public/media/')
  expect(guest.namesOriginal).toBe(false)

  const stored = await storedAbout()
  expect(stored.draft).toBeNull()
  expect(stored.published.venue_image_id).toBe(imageA)
  expect((stored.published.team as { image_id: string }).image_id).toBe(imageA)
  expect((stored.published.method as { image_id: string }).image_id).toBe(imageB)

  await openImagesAdmin(staffPage)
  await expect(staffPage.getByText('Bruges på: Om os', { exact: true }).first()).toBeVisible()
  await expect(staffPage.getByText(/\(kladde\)/)).toHaveCount(0)

  const scanned = await browser.newContext()
  const scan = await scanned.newPage()
  await scan.goto('/om-os')
  expect(await violations(scan)).toEqual([])
  expect(await noOverflow(scan), 'the public page does not scroll sideways').toBe(true)
  await scanned.close()
})

test('the published page works without scripting', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/om-os')
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(`${seeded.heading} — kladde`)
  expect(await page.getByRole('main').locator('picture img').count()).toBe(3)
  await context.close()
})

test('an alt edit in the library reaches the first guest request', async ({ browser }) => {
  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /facade-a\.jpg|Indgangen ved hallen/).click()
  await saveAlt(staffPage, 'Facaden i aftenlys.')

  const guest = await guestAbout(browser)
  expect(guest.venue?.alt).toBe('Facaden i aftenlys.')
  expect(guest.team?.alt).toBe('Facaden i aftenlys.')
})

test('a staff member may replace a page image in the library — no owner_only — and the guest gets the successor in both slots', async ({
  browser,
}) => {
  const before = await guestAbout(browser)

  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /Facaden i aftenlys/).click()
  await expect(staffPage.getByText('Bruges på: Om os. Sletter du det')).toBeVisible()
  await expect(staffPage.getByText('som kun ejeren kan rette')).toHaveCount(0)
  await staffPage.getByRole('link', { name: 'Erstat', exact: true }).click()
  await replaceInput(staffPage).setInputFiles({
    name: 'facade-c.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 1500, 120),
  })
  await staffPage.waitForURL(/status=erstattet/, { timeout: 30_000 })

  const after = await guestAbout(browser)
  expect(after.venue).not.toBeNull()
  expect(after.venue?.src).not.toBe(before.venue?.src)
  expect(after.team?.src).toBe(after.venue?.src)
  expect(after.kitchen?.src).toBe(before.kitchen?.src)

  const stored = await storedAbout()
  expect(stored.published.venue_image_id).not.toBe(imageA)
  expect((stored.published.team as { image_id: string }).image_id).toBe(stored.published.venue_image_id)
  imageA = stored.published.venue_image_id as string
})

test('Fjern billede on the kitchen is a pending removal; published, the reserved frame returns', async ({ browser }) => {
  await openAboutAdmin(staffPage)
  await removeSlotImage(staffPage, ABOUT_CARDS.method)
  await expect(statusNotice(staffPage)).toContainText('bliver i billedbiblioteket')
  await expect(pendingBand(staffPage)).toContainText('Køkken og tilberedning afventer offentliggørelse.')
  // The section is pending for its picture alone: the slot badges, the words do not.
  await expect(slotCard(staffPage, ABOUT_CARDS.method).getByText('Kladde', { exact: true })).toHaveCount(1)

  expect((await storedAbout()).draft).toEqual({
    method: { heading: DRAFT_METHOD_HEADING, text: DRAFT_METHOD_TEXT, image_id: null },
  })
  expect((await guestAbout(browser)).kitchen).not.toBeNull()
  expect((await previewAbout(staffPage)).kitchen).toBeNull()

  await publishAbout(staffPage)
  const guest = await guestAbout(browser)
  expect(guest.kitchen).toBeNull()
  expect(guest.venue).not.toBeNull()
  expect((await storedAbout()).published.method).toEqual({
    heading: DRAFT_METHOD_HEADING,
    text: DRAFT_METHOD_TEXT,
    image_id: null,
  })

  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /koekken-b\.jpg/).click()
  await expect(staffPage.getByText('Bruges ikke endnu', { exact: true }).first()).toBeVisible()
})

test('a confirmed deletion of a draft-only image clears exactly the pending selection', async () => {
  await openAboutAdmin(staffPage)
  await chooseSlotImage(staffPage, 'koekken', /koekken-b\.jpg/)
  expect((await storedAbout()).draft).toEqual({
    method: { heading: DRAFT_METHOD_HEADING, text: DRAFT_METHOD_TEXT, image_id: imageB },
  })

  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /koekken-b\.jpg/).click()
  await openDeleteDialog(staffPage)
  await confirmDelete(staffPage)

  // The section returned to its published value and left the draft: nothing waits.
  expect((await storedAbout()).draft).toBeNull()
  await openAboutAdmin(staffPage)
  await expect(pendingBand(staffPage)).toHaveCount(0)
  await expect(staffPage.locator(ABOUT_SLOT_ANCHOR.koekken)).toHaveText('Vælg billede')
})

test('a confirmed deletion of a LIVE image clears both slots on the first guest request', async ({ browser }) => {
  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /facade-c\.jpg/).click()
  await openDeleteDialog(staffPage)
  await confirmDelete(staffPage)

  const guest = await guestAbout(browser)
  expect(guest.venue).toBeNull()
  expect(guest.team).toBeNull()

  const stored = await storedAbout()
  expect(stored.published.venue_image_id).toBeNull()
  expect((stored.published.team as { image_id: string | null }).image_id).toBeNull()
  expect(stored.draft).toBeNull()
})

// ---------------------------------------------------------------------------
// 7–9. Two tabs; smuggled keys and a malformed id; anonymous and direct writes
// ---------------------------------------------------------------------------

test('a second tab that started from an older version is refused, not overwritten', async ({ browser }) => {
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await signIn(otherPage, STAFF)

  await openAboutAdmin(staffPage)
  await openAboutAdmin(otherPage)
  const version = await aboutVersion(staffPage)
  expect(await aboutVersion(otherPage)).toBe(version)

  await saveAboutCard(otherPage, ABOUT_CARDS.team, { 'Tekst om holdet': 'Første redaktør vandt' })
  await expect(statusNotice(otherPage)).toContainText('Gemt som kladde')

  await saveAboutCard(staffPage, ABOUT_CARDS.team, { 'Tekst om holdet': 'Anden redaktør, for sent' })
  await expect(statusNotice(staffPage)).toContainText('Nogen andre har rettet dette')

  const stored = await storedAbout()
  expect((stored.draft as { team: { text: string } }).team.text).toBe('Første redaktør vandt')
  expect(stored.updated_at).not.toBe(version)

  // Reloading gives the current version; saving the published words takes the section back out.
  await openAboutAdmin(staffPage)
  await saveAboutCard(staffPage, ABOUT_CARDS.team, { 'Tekst om holdet': DRAFT_TEAM })
  await expect(statusNotice(staffPage)).toContainText('venter ingen ændring')
  expect((await storedAbout()).draft).toBeNull()

  await other.close()
})

test('a draft written past the editor — a smuggled nested key, then a malformed image id — goes nowhere', async () => {
  const before = await storedAbout()
  const staffRest = await staffRestClient()

  for (const smuggled of [
    { team: { text: 'Smuglet', image_id: null, role: 'Køkkenchef' } },
    { venue_image_id: 'ikke-en-uuid' },
    { method: { heading: 'Gammel kladde', text: null } },
  ]) {
    // A Staff JWT may write `pages.draft` directly — RLS admits the row — and the
    // strict schema is the application's door. So the draft must go NOWHERE.
    const written = await staffRest.from('pages').update({ draft: smuggled }).eq('key', 'about').select('id')
    expect(written.error).toBeNull()
    expect(written.data).toHaveLength(1)

    await openAboutAdmin(staffPage)
    await expect(staffPage.getByText('Den gemte kladde kan ikke læses')).toBeVisible()
    await expect(pendingBand(staffPage)).toHaveCount(0)
    await expect(aboutForm(staffPage, ABOUT_CARDS.team).getByLabel('Tekst om holdet', { exact: true })).not.toHaveValue('Smuglet')
    expect(await violations(staffPage)).toEqual([])

    const preview = await previewAbout(staffPage)
    expect(preview.teamText).not.toBe('Smuglet')
    expect(preview.methodHeading).not.toBe('Gammel kladde')
    expect(preview.venue).toBeNull()

    await publishAbout(staffPage)
    await expect(staffPage).toHaveURL(/status=invalid_draft/)
    await expect(statusNotice(staffPage)).toContainText('kan ikke offentliggøres')

    const after = await storedAbout()
    expect(after.published).toEqual(before.published)
    expect(after.draft).toEqual(smuggled)
  }
  await staffRest.auth.signOut({ scope: 'local' })

  // "Gem felterne igen" replaces the unreadable draft: the last smuggled draft sat under
  // `method`, and the method card's Gem with the published words takes that key out.
  await openAboutAdmin(staffPage)
  await saveAboutCard(staffPage, ABOUT_CARDS.method, { Overskrift: DRAFT_METHOD_HEADING, Tekst: DRAFT_METHOD_TEXT })
  await expect(statusNotice(staffPage)).toContainText('venter ingen ændring')
  expect((await storedAbout()).draft).toBeNull()
})

test('an anonymous request is refused the editor, the row and its draft', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(ABOUT_ADMIN_PATH)
  await expect(page).toHaveURL(/\/admin\/login/)
  await expect(page.getByRole('form', { name: ABOUT_CARDS.story })).toHaveCount(0)

  // A plain POST at the address writes nothing.
  const before = await storedAbout()
  await page.request.post(ABOUT_ADMIN_PATH, {
    form: { overskrift: 'Kapret', historie: 'Kapret', version: before.updated_at },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0,
    failOnStatusCode: false,
  })
  await context.close()

  const anon = await staffRestClient()
  await anon.auth.signOut({ scope: 'local' })
  const draftWrite = await anon.from('pages').update({ draft: { heading: 'Kapret' } }).eq('key', 'about').select('id')
  expect(draftWrite.error?.code ?? '42501').toBe('42501')
  const publishedWrite = await anon.from('pages').update({ published: { heading: 'Kapret' } }).eq('key', 'about').select('id')
  expect(publishedWrite.error?.code ?? '42501').toBe('42501')

  const after = await storedAbout()
  expect(after.published).toEqual(before.published)
  expect(after.updated_at).toBe(before.updated_at)
})

test('a direct write that moves a published image path is refused — the guard, not the policy', async () => {
  await openImagesAdmin(staffPage)
  imageB = await uploadViaUi(staffPage, {
    name: 'koekken-d.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 20),
  })

  const stored = await storedAbout()
  const staffRest = await staffRestClient()

  for (const forged of [
    { ...stored.published, venue_image_id: imageB },
    { ...stored.published, team: { ...(stored.published.team as object), image_id: imageB } },
    { ...stored.published, method: { ...(stored.published.method as object), image_id: imageB } },
  ]) {
    const write = await staffRest.from('pages').update({ published: forged }).eq('key', 'about').select('id')
    expect(write.error?.code).toBe('42501')
  }
  await staffRest.auth.signOut({ scope: 'local' })

  expect((await storedAbout()).published).toEqual(stored.published)
})

// ---------------------------------------------------------------------------
// 10. The longest content the schema allows stays legible, then the seed is restored
// ---------------------------------------------------------------------------

test('the longest valid content: the editor and the preview stay legible, nothing scrolls sideways, the controls stay reachable', async () => {
  test.setTimeout(120_000)
  await openAboutAdmin(staffPage)

  const longHeading = 'Vores historie, fortalt i én lang overskrift, der løber helt ud til grænsen på tegn ' + 'x'.repeat(30)
  const longParagraph = ('Lang tekst om stedet og historien uden mellemrum at bryde på. ').repeat(31).trim()
  const longStory = Array.from({ length: 10 }, () => longParagraph.slice(0, 1990)).join('\n\n')

  await saveAboutCard(staffPage, ABOUT_CARDS.story, { Overskrift: longHeading.slice(0, 120), Historien: longStory })
  await expect(statusNotice(staffPage)).toContainText('Gemt som kladde')
  await saveAboutCard(staffPage, ABOUT_CARDS.team, { 'Tekst om holdet': longParagraph.slice(0, 2000) })
  await saveAboutCard(staffPage, ABOUT_CARDS.method, {
    Overskrift: longHeading.slice(0, 120),
    Tekst: longParagraph.slice(0, 2000),
  })
  await expect(pendingBand(staffPage)).toContainText(
    'Historien, Holdet og Køkken og tilberedning afventer offentliggørelse.',
  )

  expect(await noOverflow(staffPage), 'the editor does not scroll sideways with the longest content').toBe(true)
  const publish = staffPage.getByRole('banner').getByRole('button', { name: /^Offentliggør( ændringer)?$/ })
  const width = staffPage.viewportSize()!.width
  const box = await publish.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
  for (const control of [pendingBand(staffPage).getByRole('button', { name: 'Offentliggør' }), publish]) {
    await expect(control).toBeVisible()
  }
  expect(await violations(staffPage)).toEqual([])

  const preview = await previewAbout(staffPage)
  expect(preview.story).toHaveLength(10)
  expect(preview.heading).toBe(longHeading.slice(0, 120))
  // Back on the public page in Draft Mode the wrap was measured by the snapshot's own load; measure once more directly.
  await staffPage.goto('/api/preview/start?maal=om-os')
  await staffPage.waitForURL(/\/om-os$/)
  expect(await noOverflow(staffPage), 'the public preview wraps the longest content').toBe(true)
  await staffPage.goto('/api/preview/stop')
  await staffPage.waitForURL(/\/admin/)
})

test('the run restores the seed: the words, no images, no draft', async ({ browser }) => {
  test.setTimeout(120_000)

  // The pending long content is taken back by saving the published values (the §4 delta).
  await openAboutAdmin(staffPage)
  await saveAboutCard(staffPage, ABOUT_CARDS.story, { Overskrift: `${seeded.heading} — kladde`, Historien: DRAFT_STORY.join('\n\n') })
  await saveAboutCard(staffPage, ABOUT_CARDS.team, { 'Tekst om holdet': DRAFT_TEAM })
  await saveAboutCard(staffPage, ABOUT_CARDS.method, { Overskrift: DRAFT_METHOD_HEADING, Tekst: DRAFT_METHOD_TEXT })
  await expect(pendingBand(staffPage)).toHaveCount(0)

  // Then the seeded words, published.
  await saveAboutCard(staffPage, ABOUT_CARDS.story, { Overskrift: seeded.heading, Historien: seeded.story })
  await saveAboutCard(staffPage, ABOUT_CARDS.team, { 'Tekst om holdet': seeded.team })
  await saveAboutCard(staffPage, ABOUT_CARDS.method, { Overskrift: seeded.methodHeading, Tekst: seeded.methodText })
  await publishAbout(staffPage)
  await expect(statusNotice(staffPage)).toContainText('Om os er opdateret på hjemmesiden.')

  // The library, emptied through the screen.
  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /koekken-d\.jpg/).click()
  await openDeleteDialog(staffPage)
  await confirmDelete(staffPage)

  const guest = await guestAbout(browser)
  expect(guest.heading).toBe(seeded.heading)
  expect(guest.story).toEqual(seeded.story.split('\n\n'))
  expect(guest.teamText).toBe(seeded.team)
  expect(guest.methodHeading).toBe(seeded.methodHeading)
  expect(guest.venue).toBeNull()
  expect(guest.team).toBeNull()
  expect(guest.kitchen).toBeNull()

  const stored = await storedAbout()
  expect(stored.draft).toBeNull()
  expect(stored.published.venue_image_id).toBeNull()
  expect((await rest.from('images').select('id')).data).toEqual([])
})
