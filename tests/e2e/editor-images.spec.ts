import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { signIn, STAFF } from './support/admin'
import {
  choose,
  chooseLink,
  confirmDelete,
  deleteImageNamed,
  gridCard,
  jpegFixture,
  openDeleteDialog,
  openImagesAdmin,
  pickerDialog,
  removeSelection,
  replaceInput,
  staffRestClient,
  uploadViaUi,
} from './support/images-admin'
import { openDish, publishMenu } from './support/menu-admin'
import {
  openMonthlyAdmin,
  publishMonthly,
} from './support/monthly-admin'
import {
  asGuest,
  fillArticle,
  openArticleEditor,
  openNewEditor,
  saveArticle,
  publishArticle,
  deleteArticleNamed,
} from './support/news-admin'
import { waitForPublicShell } from './support/public-shell'
import { openWeeklyAdmin, publishWeek } from './support/weekly-admin'

/**
 * Image selection in the content editors — phase 10C-1 (brief §27); designs 1r,
 * 1ag, 1ah, 1s.
 *
 * The §27 stories, through the real administration: a dish draft selects, changes,
 * removes and publishes a photo while the guest's page is untouched; the weekly
 * special and the monthly burger walk the focused equivalent; a news article's
 * photo follows the news save model (invisible on a draft, live on a published
 * save); and the library lifecycle — usage captions with their kladde markers,
 * the draft-aware delete, and the draft-aware replacement — is driven from
 * `/admin/billeder`.
 *
 * WHERE THE PUBLIC RENDERING IS ASSERTED. Since phase 10C-2 the guest pages and
 * the Draft Mode preview render the resolved image from the public derivative
 * ladder; the full public story — placeholder until publish, preview of the
 * pending selection, first-request rendering after publish, alt edit, global
 * replacement, deletion, the news metadata — is `public-images.spec.ts`. This
 * suite keeps the editor's own promises (the slot, the captions, the draft-aware
 * library lifecycle) and asserts the 10C-2 boundary once, below: a draft
 * selection reaches the preview and not the guest.
 *
 * Serial, like every write suite: state flows from test to test, and the run
 * restores the seed's image-free menu, week, burger and news list at the end.
 */

test.describe.configure({ mode: 'serial' })

let staffPage: Page
let rest: SupabaseClient

/** The two fixture images, uploaded once and threaded through the stories. */
let imageA = ''
let imageB = ''

const ARTICLE_TITLE = 'Billedtest til efteråret'
const ARTICLE_SLUG = 'billedtest-til-efteraaret'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/** The usage caption under a library card — rendered twice (visible + spoken). */
function usageCaption(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true }).first()
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
  rest = await staffRestClient()

  await openImagesAdmin(staffPage)
  imageA = await uploadViaUi(staffPage, {
    name: 'billede-a.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 20),
  })
  await openImagesAdmin(staffPage)
  imageB = await uploadViaUi(staffPage, {
    name: 'billede-b.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 200),
  })
})

test.afterAll(async () => {
  // Best-effort restoration even after a failure, so the chain stays re-runnable:
  // no image reference anywhere, no leftover article, an empty library.
  //
  // The order is load-bearing since the published image reference became
  // database-guarded (migration 20260901200000): a staff JWT cannot null a live
  // image_id directly any more, so an image a failed run left in use is removed
  // through the trusted door FIRST — a confirmed delete_image() detaches every
  // live and draft reference — and the draft columns are cleared afterwards,
  // naming no live column at all.
  await rest.from('news').delete().eq('slug', ARTICLE_SLUG)

  // Any image row a failed run left behind is removed through the trusted door,
  // so a re-run's uploads never meet a same-named leftover. Storage files from a
  // failure are orphaned bytes in the local stack, never a dangling reference —
  // the happy path deletes through the UI, which also removes the files.
  const leftovers = await rest.from('images').select('id, updated_at')
  for (const row of (leftovers.data ?? []) as { id: string; updated_at: string }[]) {
    await rest.rpc('delete_image', {
      p_id: row.id,
      p_expected_updated_at: row.updated_at,
      p_confirmed: true,
    })
  }

  await rest.from('dishes').update({ draft: null }).eq('name', 'Thor')
  await rest.from('weekly_special').update({ draft: null }).not('id', 'is', null)
  await rest.from('monthly_burger').update({ draft: null }).not('id', 'is', null)

  await rest.auth.signOut()
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// The dish story (brief §27) — design 1r
// ---------------------------------------------------------------------------

test('the dish editor opens with the empty photo slot, accessibly', async () => {
  await openDish(staffPage, 'Burgere', 'Thor')

  await expect(staffPage.getByText('Billede (valgfrit)')).toBeVisible()
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toBeVisible()
  await expect(staffPage.getByRole('button', { name: 'Fjern billede' })).toHaveCount(0)

  expect(await violations(staffPage)).toEqual([])
})

test('the picker lists the library, chooses one image as a draft, and says so', async () => {
  await chooseLink(staffPage).click()

  const dialog = pickerDialog(staffPage)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /billede-a\.jpg/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /billede-b\.jpg/ })).toBeVisible()
  // The way to upload lives in the library, linked — never rebuilt here (brief §3).
  await expect(
    dialog.getByRole('link', { name: 'Upload eller administrér billeder' }),
  ).toHaveAttribute('href', '/admin/billeder')

  expect(await violations(staffPage)).toEqual([])

  await dialog.getByRole('button', { name: /billede-a\.jpg/ }).click()
  await staffPage.waitForURL(/status=billede_gemt/)

  await expect(
    staffPage.getByText('Billedet er gemt som kladde', { exact: false }).first(),
  ).toBeVisible()
  // The slot now shows the chosen image and 1r's two follow-up controls.
  await expect(staffPage.getByRole('link', { name: /^Skift billede/ })).toBeVisible()
  await expect(staffPage.getByRole('button', { name: 'Fjern billede' })).toBeVisible()
})

test('the draft selection reaches the Draft Mode preview and not the guest (10C-2)', async ({
  browser,
}) => {
  // The guest's page carries no derivative for Thor — a pending selection is
  // invisible until Offentliggør — while the staff member's preview renders it.
  await asGuest(browser, async (guest) => {
    await guest.goto('/menu')
    await waitForPublicShell(guest)
    await expect(guest.locator('img[src*="/storage/v1/"]')).toHaveCount(0)
  })

  const { data } = await rest.from('dishes').select('image_id').eq('name', 'Thor').single()
  expect((data as { image_id: string | null }).image_id, 'the live column is untouched').toBeNull()

  await staffPage.goto('/api/preview/start?maal=menu')
  await staffPage.waitForURL(/\/menu/)
  const thor = staffPage
    .locator('article')
    .filter({ has: staffPage.getByRole('heading', { name: 'Thor', exact: true }) })
    .first()
  await expect(thor.locator('img[src*="/storage/v1/object/public/media/"]')).toHaveCount(1)
  expect(await staffPage.content()).not.toContain('media-originals')
  await staffPage.goto('/api/preview/stop')
  await staffPage.waitForURL(/\/admin/)
})

test('the library caption reads the pending truth: Thor, as a kladde', async () => {
  await openImagesAdmin(staffPage)
  await expect(usageCaption(staffPage, 'Bruges på: Thor (kladde)')).toBeVisible()
})

test('changing the selection marks the current choice and moves the draft', async () => {
  await openDish(staffPage, 'Burgere', 'Thor')
  await chooseLink(staffPage).click()

  const dialog = pickerDialog(staffPage)
  // The current selection is communicated in words, not colour alone (1aa).
  await expect(dialog.getByRole('button', { name: /Valgt.*billede-a\.jpg/ })).toBeVisible()

  await dialog.getByRole('button', { name: /^billede-b\.jpg/ }).click()
  await staffPage.waitForURL(/status=billede_gemt/)

  await openImagesAdmin(staffPage)
  await expect(usageCaption(staffPage, 'Bruges på: Thor (kladde)')).toBeVisible()
  await expect(usageCaption(staffPage, 'Bruges ikke endnu')).toBeVisible()
})

test('Fjern billede clears the pending selection and deletes nothing', async () => {
  await openDish(staffPage, 'Burgere', 'Thor')
  await removeSelection(staffPage)

  await expect(
    staffPage.getByText('det bliver i billedbiblioteket', { exact: false }).first(),
  ).toBeVisible()
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toBeVisible()

  // Both images still exist — removal is about the selection, never the asset.
  const { data } = await rest.from('images').select('id')
  expect((data ?? []).length).toBe(2)
})

test('publishing a selected image makes the live row own it', async () => {
  await openDish(staffPage, 'Burgere', 'Thor')
  await choose(staffPage, /^billede-b\.jpg/)
  await publishMenu(staffPage)

  const { data } = await rest.from('dishes').select('image_id').eq('name', 'Thor').single()
  expect((data as { image_id: string | null }).image_id).toBe(imageB)

  await openImagesAdmin(staffPage)
  await expect(usageCaption(staffPage, 'Bruges på: Thor')).toBeVisible()
})

test('a stale picker submission is refused without touching the draft (§17)', async () => {
  // The picker must already be open: opening it is a navigation, so the version
  // token in its form is refreshed by the server on every open. Staleness means a
  // colleague writing while the dialog is on screen.
  await openDish(staffPage, 'Burgere', 'Thor')
  await chooseLink(staffPage).click()
  await expect(pickerDialog(staffPage)).toBeVisible()

  // The colleague saves a draft on the same dish behind the open dialog — through
  // the one column PostgREST legitimately owns, which bumps the version token.
  await rest
    .from('dishes')
    .update({ draft: { description: 'Kollegaens kladdetekst' } })
    .eq('name', 'Thor')

  await pickerDialog(staffPage).getByRole('button', { name: /^billede-a\.jpg/ }).click()
  await staffPage.waitForURL(/status=conflict/)

  await expect(staffPage.getByText('Nogen andre har rettet dette', { exact: false }).first())
    .toBeVisible()

  const { data } = await rest.from('dishes').select('draft, image_id').eq('name', 'Thor').single()
  const row = data as { draft: Record<string, unknown>; image_id: string | null }
  expect(row.draft, 'the colleague’s draft is untouched — nothing was merged').toEqual({
    description: 'Kollegaens kladdetekst',
  })
  expect(row.image_id, 'and the live image did not move').toBe(imageB)

  // Restore: publish nothing — just clear the colleague's draft and the live image
  // through the editor, so the next story starts clean.
  await rest.from('dishes').update({ draft: null }).eq('name', 'Thor')
  await openDish(staffPage, 'Burgere', 'Thor')
  await removeSelection(staffPage)
  await publishMenu(staffPage)

  const cleared = await rest.from('dishes').select('image_id').eq('name', 'Thor').single()
  expect((cleared.data as { image_id: string | null }).image_id).toBeNull()
})

// ---------------------------------------------------------------------------
// Ugens ret — the focused equivalent (brief §27)
// ---------------------------------------------------------------------------

test('the weekly special selects, holds the draft, publishes and clears', async () => {
  await openWeeklyAdmin(staffPage)
  await choose(staffPage, /^billede-a\.jpg/)

  // The pending band names the card, and the guest row holds no image yet.
  await expect(
    staffPage.getByText('Ugens ret har ændringer, der ikke er offentliggjort.').first(),
  ).toBeVisible()
  const before = await rest.from('weekly_special').select('image_id').single()
  expect((before.data as { image_id: string | null }).image_id).toBeNull()

  await openImagesAdmin(staffPage)
  await expect(usageCaption(staffPage, 'Bruges på: Ugens ret (kladde)')).toBeVisible()

  await openWeeklyAdmin(staffPage)
  await publishWeek(staffPage)
  const after = await rest.from('weekly_special').select('image_id').single()
  expect((after.data as { image_id: string | null }).image_id).toBe(imageA)

  // Remove and publish back to the seed's image-free state.
  await removeSelection(staffPage)
  await publishWeek(staffPage)
  const restored = await rest.from('weekly_special').select('image_id').single()
  expect((restored.data as { image_id: string | null }).image_id).toBeNull()
})

// ---------------------------------------------------------------------------
// Månedens burger — the focused equivalent (brief §27)
// ---------------------------------------------------------------------------

test('the monthly burger selects, holds the draft, publishes and clears', async () => {
  await openMonthlyAdmin(staffPage)
  await choose(staffPage, /^billede-a\.jpg/)

  const before = await rest.from('monthly_burger').select('image_id').single()
  expect((before.data as { image_id: string | null }).image_id).toBeNull()

  await openImagesAdmin(staffPage)
  await expect(usageCaption(staffPage, 'Bruges på: Månedens burger (kladde)')).toBeVisible()

  await openMonthlyAdmin(staffPage)
  await publishMonthly(staffPage)
  const after = await rest.from('monthly_burger').select('image_id').single()
  expect((after.data as { image_id: string | null }).image_id).toBe(imageA)

  await removeSelection(staffPage)
  await publishMonthly(staffPage)
  const restored = await rest.from('monthly_burger').select('image_id').single()
  expect((restored.data as { image_id: string | null }).image_id).toBeNull()
})

// ---------------------------------------------------------------------------
// News — the article's own save model (brief §27)
// ---------------------------------------------------------------------------

test('a new article has no picker until it exists; a saved draft selects invisibly', async ({
  browser,
}) => {
  await openNewEditor(staffPage)
  await expect(
    staffPage.getByText('Billedet kan vælges, når nyheden er gemt første gang.'),
  ).toBeVisible()

  await fillArticle(staffPage, {
    title: ARTICLE_TITLE,
    text: 'Vi tester billeder i efterårets nyhed.',
  })
  await saveArticle(staffPage)

  await choose(staffPage, /^billede-a\.jpg/)
  await expect(
    staffPage.getByText('Billedet er valgt. Nyheden er ikke offentliggjort endnu.').first(),
  ).toBeVisible()

  // The guest's address still 404s — a draft article leaks nothing (§4).
  await asGuest(browser, async (guest) => {
    const response = await guest.goto(`/nyheder/${ARTICLE_SLUG}`)
    expect(response?.status()).toBe(404)
  })

  await openImagesAdmin(staffPage)
  await expect(
    usageCaption(staffPage, `Bruges på: Nyheden “${ARTICLE_TITLE}” (kladde)`),
  ).toBeVisible()
})

test('publishing the article makes its image live; a published change is live at once', async () => {
  await openArticleEditor(staffPage, ARTICLE_TITLE)
  await publishArticle(staffPage, ARTICLE_TITLE)

  await openImagesAdmin(staffPage)
  await expect(usageCaption(staffPage, `Bruges på: Nyheden “${ARTICLE_TITLE}”`)).toBeVisible()

  // The accepted news model: an image change on a published article is public the
  // moment it is saved, and the notice says so.
  await openArticleEditor(staffPage, ARTICLE_TITLE)
  await choose(staffPage, /^billede-b\.jpg/)
  await expect(
    staffPage.getByText('Billedet er valgt og er på hjemmesiden nu.').first(),
  ).toBeVisible()

  const { data } = await rest.from('news').select('image_id').eq('slug', ARTICLE_SLUG).single()
  expect((data as { image_id: string | null }).image_id).toBe(imageB)
})

test('a stale news image selection is refused with the conflict sentence (§17)', async () => {
  // As in the dish story: the picker must be open first, because opening it
  // re-reads the version.
  await openArticleEditor(staffPage, ARTICLE_TITLE)
  await chooseLink(staffPage).click()
  await expect(pickerDialog(staffPage)).toBeVisible()

  // A colleague's save moves the version behind the open dialog.
  await rest
    .from('news')
    .update({ display_date: '2026-10-01' })
    .eq('slug', ARTICLE_SLUG)

  await pickerDialog(staffPage).getByRole('button', { name: /^billede-a\.jpg/ }).click()
  await staffPage.waitForURL(/status=konflikt/)

  const { data } = await rest.from('news').select('image_id').eq('slug', ARTICLE_SLUG).single()
  expect((data as { image_id: string | null }).image_id, 'nothing was written').toBe(imageB)
})

// ---------------------------------------------------------------------------
// The library lifecycle over draft references (brief §27)
// ---------------------------------------------------------------------------

test('a confirmed delete of a draft-referenced image clears only that pending reference', async () => {
  // The monthly burger's draft selects image A — the only reference A has.
  await openMonthlyAdmin(staffPage)
  await choose(staffPage, /^billede-a\.jpg/)

  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /billede-a\.jpg/).click()

  const dialog = await openDeleteDialog(staffPage)
  await expect(dialog).toContainText('Månedens burger (kladde)')
  await confirmDelete(staffPage)

  // The pending reference is gone; the burger's other state and the other image
  // are untouched; nothing dangles.
  const burger = await rest.from('monthly_burger').select('draft, image_id').single()
  const row = burger.data as { draft: unknown; image_id: string | null }
  expect(row.draft, 'the draft held only the reference, so it is NULL again').toBeNull()
  expect(row.image_id).toBeNull()

  await openMonthlyAdmin(staffPage)
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toBeVisible()
})

test('replacing a draft-referenced image moves the pending selection to the successor', async () => {
  // The news article still owns image B live; give B a pending reference too, so
  // the replacement demonstrates both moving in one transition.
  await openWeeklyAdmin(staffPage)
  await choose(staffPage, /^billede-b\.jpg/)

  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /billede-b\.jpg/).click()
  await staffPage.getByRole('link', { name: 'Erstat' }).click()

  await replaceInput(staffPage).setInputFiles({
    name: 'billede-c.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1000, 700, 120),
  })
  await staffPage.waitForURL(/status=erstattet/, { timeout: 30_000 })

  const weekly = await rest.from('weekly_special').select('draft').single()
  const draft = (weekly.data as { draft: { image_id?: string } }).draft
  expect(draft.image_id, 'the pending selection moved to the successor').toBeDefined()
  expect(draft.image_id).not.toBe(imageB)

  const news = await rest.from('news').select('image_id').eq('slug', ARTICLE_SLUG).single()
  expect((news.data as { image_id: string | null }).image_id, 'the live reference moved too').toBe(
    draft.image_id,
  )

  // No stale id survives anywhere: image B's row is gone.
  const images = await rest.from('images').select('id')
  expect((images.data ?? []).map((row: { id: string }) => row.id)).not.toContain(imageB)
})

test('the run restores the seed: no references, no article, an empty library', async () => {
  // Detach the weekly draft through the editor, and remove the article whole.
  await openWeeklyAdmin(staffPage)
  await removeSelection(staffPage)

  await deleteArticleNamed(staffPage, ARTICLE_TITLE)

  // The successor image is now unreferenced; delete it through the real UI, which
  // is also what removes its files.
  await deleteImageNamed(staffPage, /billede-c\.jpg/)

  const [images, thor, weekly, monthly] = await Promise.all([
    rest.from('images').select('id'),
    rest.from('dishes').select('image_id, draft').eq('name', 'Thor').single(),
    rest.from('weekly_special').select('image_id, draft').single(),
    rest.from('monthly_burger').select('image_id, draft').single(),
  ])

  expect((images.data ?? []).length, 'the library ends empty').toBe(0)
  expect((thor.data as { image_id: string | null }).image_id).toBeNull()
  expect((weekly.data as { image_id: string | null; draft: unknown }).image_id).toBeNull()
  expect((weekly.data as { draft: unknown }).draft).toBeNull()
  expect((monthly.data as { image_id: string | null }).image_id).toBeNull()
  expect((monthly.data as { draft: unknown }).draft).toBeNull()
})
