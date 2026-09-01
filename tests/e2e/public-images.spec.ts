import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { signIn, STAFF } from './support/admin'
import {
  choose,
  confirmDelete,
  deleteImageNamed,
  gridCard,
  jpegFixture,
  openDeleteDialog,
  openImagesAdmin,
  removeSelection,
  replaceInput,
  saveAlt,
  staffRestClient,
  uploadViaUi,
} from './support/images-admin'
import { openDish, publicDish, publishMenu } from './support/menu-admin'
import {
  copenhagenDate,
  openMonthlyAdmin,
  publishMonthly,
  saveMonthly,
  setHomepageChecked,
} from './support/monthly-admin'
import {
  asGuest,
  deleteArticleNamed,
  fillArticle,
  openArticleEditor,
  openNewEditor,
  publishArticle,
  saveArticle,
  unpublishArticle,
} from './support/news-admin'
import { waitForPublicShell } from './support/public-shell'
import { openWeeklyAdmin, publishWeek } from './support/weekly-admin'

/**
 * Public image rendering, the cache coupling and the news image metadata — phase
 * 10C-2 (brief §36, §37, §38, §41); designs 1g/1l, 1h/1m, 1af, 1j/1n; technical
 * plan §1 (adjustment 3), §6, §11, §20.
 *
 * The promise this suite exists for: **a selected library image reaches the guest
 * on the FIRST request after the change that makes it public, from the processed
 * derivative ladder alone — and every later library edit that changes what a
 * guest sees (a description, a global replacement, a confirmed deletion) reaches
 * the guest on the first request too, while a pending selection reaches only the
 * staff member's preview.**
 *
 * Every guest read is a fresh, cookie-free context — the first request after the
 * commit under test — and nothing here polls or retries: a first request that
 * carries the old state is the failure this suite is for (§37). Both dedicated
 * projects run it — 375 first, then 1440 — because the frames draw different
 * slots at the two widths and `sizes` must pick a different rung for each.
 *
 * Serial, like every write suite: state flows from test to test, and the run
 * restores the seed's image-free menu, week, burger and news list at the end.
 */

test.describe.configure({ mode: 'serial' })

const MEDIA = '/storage/v1/object/public/media/'
const PRIVATE_BUCKET = 'media-originals'

const ARTICLE_TITLE = 'Billedtest på forsiden'
const ARTICLE_SLUG = 'billedtest-paa-forsiden'
const ALT_TEXT = 'Odin-burgeren fotograferet tæt på'
const BURGER_NAME = 'Billedburgeren'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

let staffPage: Page
let rest: SupabaseClient

/** The fixture images and the upload ids their derivative paths carry. */
let imageA = ''
let imageB = ''
let uploadA = ''
let uploadB = ''
let uploadC = ''

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/** The upload id an image's derivatives share — read from the row, never guessed. */
async function uploadIdOf(imageId: string): Promise<string> {
  const { data } = await rest.from('images').select('storage_path').eq('id', imageId).single()
  return (data as { storage_path: string }).storage_path.split('/')[0]!
}

/** Every storage-served image in a scope. */
function storageImages(scope: Page | Locator): Locator {
  return scope.locator(`img[src*="${MEDIA}"]`)
}

/** The published photo of one dish card, on `/menu` or the Forside. */
function dishImage(scope: Page | Locator, dish: string): Locator {
  // The inner `has` locator is resolved relative to each article, so it must be
  // rooted at the page rather than at the scope it is searched within.
  const page = 'goto' in scope ? scope : scope.page()
  return scope
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: dish, exact: true }) })
    .first()
    .locator('picture img')
}

/** One guest read of a page, in a fresh cookie-free context: the first request. */
async function guestPage<T>(browser: Browser, path: string, run: (page: Page) => Promise<T>): Promise<T> {
  return asGuest(browser, async (guest) => {
    await guest.goto(path)
    await waitForPublicShell(guest)
    return run(guest)
  })
}

/** The same, with scripting off — what the server HTML alone carries (brief §38). */
async function noJsGuest<T>(browser: Browser, path: string, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    await page.goto(path)
    return await run(page)
  } finally {
    await context.close()
  }
}

/** The Draft Mode preview of a public path, as the signed-in staff member. */
async function preview<T>(path: string, target: string, run: (page: Page) => Promise<T>): Promise<T> {
  await staffPage.goto(`/api/preview/start?maal=${target}`)
  await staffPage.waitForURL((url) => url.pathname === path)
  try {
    return await run(staffPage)
  } finally {
    await staffPage.goto('/api/preview/stop')
    await staffPage.waitForURL(/\/admin/)
  }
}

/** The picked candidate, by rung: `/480.avif` in Chromium, which decodes AVIF. */
async function pickedRung(image: Locator): Promise<string> {
  await expect(image).toBeVisible()
  const current = await image.evaluate((element: HTMLImageElement) => element.currentSrc)
  return current.slice(current.lastIndexOf('/'))
}

/** True at the phone project; the frames draw a different slot at each width. */
function isMobile(): boolean {
  return (test.info().project.use.viewport?.width ?? 1440) < 768
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
  rest = await staffRestClient()

  // A: wide enough for the whole ladder (480 / 960 / 1440 / 2160). B: two rungs.
  await openImagesAdmin(staffPage)
  imageA = await uploadViaUi(staffPage, {
    name: 'billede-a.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(2560, 1600, 20),
  })
  uploadA = await uploadIdOf(imageA)

  await openImagesAdmin(staffPage)
  imageB = await uploadViaUi(staffPage, {
    name: 'billede-b.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 200),
  })
  uploadB = await uploadIdOf(imageB)
})

test.afterAll(async () => {
  // Best-effort restoration even after a failure, so the chain stays re-runnable.
  // Images go first, through the trusted door — a confirmed delete_image()
  // detaches every live and draft reference, which a staff JWT cannot do by hand
  // (migration 20260901200000) — then the drafts, the burger and the article.
  await rest.from('news').delete().eq('slug', ARTICLE_SLUG)

  const leftovers = await rest.from('images').select('id, updated_at')
  for (const row of (leftovers.data ?? []) as { id: string; updated_at: string }[]) {
    await rest.rpc('delete_image', {
      p_id: row.id,
      p_expected_updated_at: row.updated_at,
      p_confirmed: true,
    })
  }

  await rest.from('dishes').update({ draft: null }).eq('name', 'Odin')
  await rest.from('weekly_special').update({ draft: null }).not('id', 'is', null)
  await rest
    .from('monthly_burger')
    .update({
      draft: null,
      name: null,
      description: null,
      price_ore: null,
      starts_on: null,
      ends_on: null,
      show_on_homepage: false,
    })
    .not('id', 'is', null)

  await rest.auth.signOut()
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// The dish (brief §36): draft → preview → publish → first request
// ---------------------------------------------------------------------------

test('a draft selection leaves the guest on the placeholder while the preview renders A', async ({
  browser,
}) => {
  await openDish(staffPage, 'Burgere', 'Odin')
  await choose(staffPage, /^billede-a\.jpg/)

  await guestPage(browser, '/menu', async (guest) => {
    const odin = publicDish(guest, 'Odin')
    await expect(odin).toBeVisible()
    await expect(storageImages(odin)).toHaveCount(0)
    // The reserved frame still stands where the photo will go (1h/1m).
    await expect(odin.locator('.media-placeholder')).toHaveCount(1)
  })

  await preview('/menu', 'menu', async (page) => {
    const image = dishImage(page, 'Odin')
    await expect(image).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadA}/`))
    await expect(image).toHaveAttribute('srcset', /480w.*960w.*1440w.*2160w/)
    expect(await page.content()).not.toContain(PRIVATE_BUCKET)
  })
})

test('publishing puts A on the first guest request, from the derivative ladder alone', async ({
  browser,
}) => {
  await publishMenu(staffPage)

  await guestPage(browser, '/menu', async (guest) => {
    const image = dishImage(guest, 'Odin')
    await expect(image).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadA}/960\\.webp$`))
    await expect(image).toHaveAttribute('srcset', /480w.*960w.*1440w.*2160w/)
    await expect(image).toHaveAttribute('sizes', /9\.375rem/)
    await expect(image).toHaveAttribute('width', '2160')
    await expect(image).toHaveAttribute('height', '1350')
    // No description is authored yet: alt="" is the accepted model (brief §8, §28).
    await expect(image).toHaveAttribute('alt', '')

    const picture = image.locator('xpath=..')
    await expect(picture.locator('source[type="image/avif"]')).toHaveCount(1)
    await expect(picture.locator('source[type="image/avif"]')).toHaveAttribute('srcset', /\.avif 480w/)

    const html = await guest.content()
    expect(html).not.toContain(PRIVATE_BUCKET)
    expect(html).not.toContain(`${uploadA}/original`)

    // The card's slot is 6rem on a phone and 9.375rem from md, so the browser
    // takes the 480 rung at either width — never the 2160 rung (brief §41).
    expect(await pickedRung(image)).toBe('/480.avif')

    // The menu text and pricing are exactly as before (brief §10).
    await expect(publicDish(guest, 'Odin')).toContainText('89 kr.')

    expect(await violations(guest)).toEqual([])
  })

  // The Forside's featured card renders the same photo from the same tagged read.
  await guestPage(browser, '/', async (guest) => {
    const featured = guest.getByRole('region', { name: 'Tre fra menuen' })
    const image = dishImage(featured, 'Odin')
    await expect(image).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadA}/`))
    // A 6rem thumbnail on a phone, a third of the measure (~24rem) on a desktop:
    // the 480 rung either way.
    expect(await pickedRung(image)).toBe('/480.avif')
    expect(await guest.content()).not.toContain(PRIVATE_BUCKET)
    expect(await violations(guest)).toEqual([])
  })
})

test('a guest downloads exactly one candidate per photo, and never the original (brief §41)', async ({
  browser,
}) => {
  await asGuest(browser, async (guest) => {
    const requested: string[] = []
    guest.on('request', (request) => requested.push(request.url()))

    await guest.goto('/menu')
    await waitForPublicShell(guest)
    await expect(dishImage(guest, 'Odin')).toBeVisible()
    await guest.waitForLoadState('networkidle')

    const forA = requested.filter((url) => url.includes(`${MEDIA}${uploadA}/`))
    expect(forA, 'one derivative fetched for Odin').toHaveLength(1)
    expect(forA[0]).toMatch(/\/480\.avif$/)
    expect(requested.some((url) => url.includes(PRIVATE_BUCKET))).toBe(false)
    expect(requested.some((url) => url.includes('/2160.'))).toBe(false)
  })
})

test('the photo is server HTML: it renders with scripting off (brief §38)', async ({ browser }) => {
  await noJsGuest(browser, '/menu', async (guest) => {
    const image = dishImage(guest, 'Odin')
    await expect(image).toHaveAttribute('srcset', /480w/)
    await expect(image).toHaveAttribute('alt', '')
    await expect(image.locator('xpath=..').locator('source[type="image/avif"]')).toHaveCount(1)
  })

  await noJsGuest(browser, '/', async (guest) => {
    const featured = guest.getByRole('region', { name: 'Tre fra menuen' })
    await expect(dishImage(featured, 'Odin')).toHaveAttribute('srcset', /480w/)
  })
})

// ---------------------------------------------------------------------------
// The library edits a guest can see (brief §36, §37): alt, replace, delete
// ---------------------------------------------------------------------------

test('editing the description in the library reaches the first guest request', async ({
  browser,
}) => {
  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /billede-a\.jpg/).click()
  await saveAlt(staffPage, ALT_TEXT)

  await guestPage(browser, '/menu', async (guest) => {
    await expect(dishImage(guest, 'Odin')).toHaveAttribute('alt', ALT_TEXT)
    expect(await violations(guest)).toEqual([])
  })
  await guestPage(browser, '/', async (guest) => {
    const featured = guest.getByRole('region', { name: 'Tre fra menuen' })
    await expect(dishImage(featured, 'Odin')).toHaveAttribute('alt', ALT_TEXT)
  })
})

test('a global replacement A→C reaches the first guest request, and A is gone from the HTML', async ({
  browser,
}) => {
  // The card's accessible name is the description since the edit above (1w).
  await openImagesAdmin(staffPage)
  await gridCard(staffPage, new RegExp(ALT_TEXT)).click()
  await staffPage.getByRole('link', { name: 'Erstat' }).click()

  await replaceInput(staffPage).setInputFiles({
    name: 'billede-c.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1000, 700, 120),
  })
  await staffPage.waitForURL(/status=erstattet/, { timeout: 30_000 })

  const { data } = await rest.from('dishes').select('image_id').eq('name', 'Odin').single()
  const imageC = (data as { image_id: string }).image_id
  expect(imageC).not.toBe(imageA)
  uploadC = await uploadIdOf(imageC)

  await guestPage(browser, '/menu', async (guest) => {
    const image = dishImage(guest, 'Odin')
    await expect(image).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadC}/`))
    // C is 1000 px wide: two rungs, and no rung the record does not carry.
    await expect(image).toHaveAttribute('srcset', /480w.*960w/)
    await expect(image).not.toHaveAttribute('srcset', /1440w/)
    // The successor inherits no description (§0u reading A): alt is empty again.
    await expect(image).toHaveAttribute('alt', '')

    const html = await guest.content()
    expect(html).not.toContain(uploadA)
    expect(html).not.toContain(PRIVATE_BUCKET)
  })
  await guestPage(browser, '/', async (guest) => {
    const featured = guest.getByRole('region', { name: 'Tre fra menuen' })
    await expect(dishImage(featured, 'Odin')).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadC}/`))
    expect(await guest.content()).not.toContain(uploadA)
  })
})

// ---------------------------------------------------------------------------
// Ugens ret (brief §11, §36): no image, pending, published, pending removal
// ---------------------------------------------------------------------------

test('the weekly special: pending B previews, publishes on the first request, and a pending removal previews as none', async ({
  browser,
}) => {
  const section = (page: Page) => page.locator('#menu-ugens-ret')

  await guestPage(browser, '/menu', async (guest) => {
    await expect(storageImages(section(guest))).toHaveCount(0)
  })

  await openWeeklyAdmin(staffPage)
  await choose(staffPage, /^billede-b\.jpg/)

  await guestPage(browser, '/menu', async (guest) => {
    await expect(storageImages(section(guest))).toHaveCount(0)
  })
  await preview('/menu', 'menu', async (page) => {
    await expect(storageImages(section(page))).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadB}/`))
  })

  await publishWeek(staffPage)

  await guestPage(browser, '/menu', async (guest) => {
    const image = section(guest).locator('picture img')
    await expect(image).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadB}/`))
    await expect(image).toHaveAttribute('sizes', /12\.5rem/)
    // 1af's card keeps its shape and its words with a photo in it.
    await expect(section(guest)).toContainText('Uge ')
    await expect(section(guest).locator('aside')).toContainText('Lørdagsmenu')
    expect(await violations(guest)).toEqual([])
  })

  // Live B + pending removal: the guest keeps B, the preview shows the frame.
  await openWeeklyAdmin(staffPage)
  await removeSelection(staffPage)

  await guestPage(browser, '/menu', async (guest) => {
    await expect(storageImages(section(guest))).toHaveCount(1)
  })
  await preview('/menu', 'menu', async (page) => {
    await expect(storageImages(section(page))).toHaveCount(0)
    await expect(section(page).locator('.media-placeholder')).toHaveCount(1)
  })

  await publishWeek(staffPage)

  await guestPage(browser, '/menu', async (guest) => {
    await expect(storageImages(section(guest))).toHaveCount(0)
    await expect(section(guest).locator('.media-placeholder')).toHaveCount(1)
  })
})

// ---------------------------------------------------------------------------
// Månedens burger (brief §12, §36): the menu card and the Forside feature
// ---------------------------------------------------------------------------

test('the monthly burger: one published image on the menu card and the Forside feature', async ({
  browser,
}) => {
  await openMonthlyAdmin(staffPage)
  await saveMonthly(staffPage, {
    Navn: BURGER_NAME,
    'Pris (kr.)': '99',
    Startdato: copenhagenDate(-1),
    Slutdato: copenhagenDate(1),
  })
  await setHomepageChecked(staffPage, true)
  await saveMonthly(staffPage, {})
  await choose(staffPage, /^billede-b\.jpg/)

  await preview('/', 'forside', async (page) => {
    const section = page.locator('section').filter({ has: page.locator('#maanedens-burger-titel') })
    await expect(storageImages(section)).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadB}/`))
  })

  await publishMonthly(staffPage)

  await guestPage(browser, '/menu', async (guest) => {
    const card = guest.locator('#menu-burgere article').last()
    await expect(card).toContainText(BURGER_NAME)
    await expect(card.locator('picture img')).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadB}/`))
    await expect(card.locator('picture img')).toHaveAttribute('sizes', /9\.375rem/)
  })
  await guestPage(browser, '/', async (guest) => {
    const section = guest.locator('section').filter({ has: guest.locator('#maanedens-burger-titel') })
    const image = section.locator('picture img')
    await expect(image).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadB}/`))
    await expect(image).toHaveAttribute('sizes', /21\.25rem/)
    await expect(section.getByRole('link', { name: /Bestil på telefon/ })).toBeVisible()
    expect(await violations(guest)).toEqual([])
  })

  // Back to the seed: no image, no burger, no section.
  await openMonthlyAdmin(staffPage)
  await removeSelection(staffPage)
  await setHomepageChecked(staffPage, false)
  await saveMonthly(staffPage, {
    Navn: '',
    Beskrivelse: '',
    'Pris (kr.)': '',
    Startdato: '',
    Slutdato: '',
  })
  await publishMonthly(staffPage)

  await guestPage(browser, '/', async (guest) => {
    await expect(guest.locator('#maanedens-burger-titel')).toHaveCount(0)
  })
  await guestPage(browser, '/menu', async (guest) => {
    await expect(guest.locator('#menu-burgere article').last()).toContainText('ikke oplyst endnu')
  })
})

// ---------------------------------------------------------------------------
// News (brief §13–§16, §36): draft → preview → publish → metadata → change
// ---------------------------------------------------------------------------

test('a draft article with an image stays a 404 for guests and previews with the image and no claims', async ({
  browser,
}) => {
  await openNewEditor(staffPage)
  await fillArticle(staffPage, {
    title: ARTICLE_TITLE,
    text: 'Vi tester billeder på forsiden og i artiklen.',
    date: '2026-12-31',
  })
  await saveArticle(staffPage)
  await choose(staffPage, /^billede-b\.jpg/)

  await asGuest(browser, async (guest) => {
    const response = await guest.goto(`/nyheder/${ARTICLE_SLUG}`)
    expect(response?.status()).toBe(404)
  })

  await staffPage.getByRole('link', { name: 'Forhåndsvis på hjemmesiden' }).click()
  await staffPage.waitForURL(new RegExp(`/nyheder/${ARTICLE_SLUG}$`))
  const article = staffPage.locator('article').first()
  await expect(article.locator('picture img')).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadB}/`))
  await expect(staffPage.locator('meta[property="og:image"]')).toHaveCount(0)
  await expect(staffPage.locator('script[type="application/ld+json"]')).toHaveCount(0)
  expect(await staffPage.content()).not.toContain(PRIVATE_BUCKET)
  // Leaving Draft Mode lands on the public list, as the news editor's own link does.
  await staffPage.goto('/api/preview/stop?maal=nyheder')
  await staffPage.waitForURL(/\/nyheder$/)
})

test('publishing renders the article image on the first request, and og:image and the JSON-LD name the same derivative', async ({
  browser,
}) => {
  await openArticleEditor(staffPage, ARTICLE_TITLE)
  await publishArticle(staffPage, ARTICLE_TITLE)

  const expectedSeo = `${MEDIA}${uploadB}/960.webp`

  await guestPage(browser, `/nyheder/${ARTICLE_SLUG}`, async (guest) => {
    const image = guest.locator('article').first().locator('picture img')
    await expect(image).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadB}/`))
    await expect(image).toHaveAttribute('loading', 'eager')
    await expect(image).toHaveAttribute('sizes', /34rem/)
    // The article measure is ~34rem from md and the gutters below it: the 960
    // rung on a desktop, the 480 rung on a phone (brief §41).
    expect(await pickedRung(image)).toBe(isMobile() ? '/480.avif' : '/960.avif')

    const ogImage = await guest.locator('meta[property="og:image"]').getAttribute('content')
    expect(ogImage).toContain(expectedSeo)
    expect(ogImage).not.toContain(PRIVATE_BUCKET)
    await expect(guest.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '960')
    await expect(guest.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '640')

    const raw = await guest.locator('script[type="application/ld+json"]').textContent()
    const jsonLd = JSON.parse(raw ?? '{}') as { image?: { '@type': string; url: string; width: number } }
    expect(jsonLd.image?.['@type']).toBe('ImageObject')
    expect(jsonLd.image?.url).toBe(ogImage)
    expect(jsonLd.image?.width).toBe(960)

    expect(await guest.content()).not.toContain(PRIVATE_BUCKET)
    expect(await violations(guest)).toEqual([])
  })

  // The list and the Forside teaser carry the same photo (1j, 1g).
  await guestPage(browser, '/nyheder', async (guest) => {
    const card = guest.locator('article').filter({ hasText: ARTICLE_TITLE }).first()
    await expect(card.locator('picture img')).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadB}/`))
    await expect(card.locator('picture img')).toHaveAttribute('sizes', /16\.25rem/)
    expect(await violations(guest)).toEqual([])
  })
  await guestPage(browser, '/', async (guest) => {
    const teaser = guest.locator('article').filter({ hasText: ARTICLE_TITLE }).first()
    await expect(teaser.locator('picture img')).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadB}/`))
    await expect(teaser.locator('picture img')).toHaveAttribute('sizes', /8\.125rem/)
  })

  await noJsGuest(browser, `/nyheder/${ARTICLE_SLUG}`, async (guest) => {
    await expect(guest.locator('article').first().locator('picture img')).toHaveAttribute('srcset', /480w/)
  })
})

test('changing a published article’s image is on the first request, metadata included', async ({
  browser,
}) => {
  await openArticleEditor(staffPage, ARTICLE_TITLE)
  await choose(staffPage, /^billede-c\.jpg/)
  await expect(
    staffPage.getByText('Billedet er valgt og er på hjemmesiden nu.').first(),
  ).toBeVisible()

  await guestPage(browser, `/nyheder/${ARTICLE_SLUG}`, async (guest) => {
    const image = guest.locator('article').first().locator('picture img')
    await expect(image).toHaveAttribute('src', new RegExp(`${MEDIA}${uploadC}/`))
    const ogImage = await guest.locator('meta[property="og:image"]').getAttribute('content')
    expect(ogImage).toContain(`${MEDIA}${uploadC}/960.webp`)
    const raw = await guest.locator('script[type="application/ld+json"]').textContent()
    expect((JSON.parse(raw ?? '{}') as { image?: { url: string } }).image?.url).toBe(ogImage)
    expect(await guest.content()).not.toContain(uploadB)
  })
})

test('unpublishing removes the article, its teaser and its sitemap entry as before', async ({
  browser,
}) => {
  await openArticleEditor(staffPage, ARTICLE_TITLE)
  await unpublishArticle(staffPage)

  await asGuest(browser, async (guest) => {
    const response = await guest.goto(`/nyheder/${ARTICLE_SLUG}`)
    expect(response?.status()).toBe(404)
  })
  await guestPage(browser, '/', async (guest) => {
    await expect(guest.locator('article').filter({ hasText: ARTICLE_TITLE })).toHaveCount(0)
  })
  await asGuest(browser, async (guest) => {
    const response = await guest.goto('/sitemap.xml')
    expect(await response?.text()).not.toContain(ARTICLE_SLUG)
  })

  await deleteArticleNamed(staffPage, ARTICLE_TITLE)
})

// ---------------------------------------------------------------------------
// Deletion (brief §36): the first request returns to the frame, content intact
// ---------------------------------------------------------------------------

test('a confirmed deletion of a live image returns the guest to the placeholder on the first request', async ({
  browser,
}) => {
  // Odin has carried C since the replacement; the news article was deleted with
  // its reference, so the warning names Odin alone.
  await openImagesAdmin(staffPage)
  await gridCard(staffPage, /billede-c\.jpg/).click()
  const dialog = await openDeleteDialog(staffPage)
  await expect(dialog).toContainText('Odin')
  await confirmDelete(staffPage)

  await guestPage(browser, '/menu', async (guest) => {
    const odin = publicDish(guest, 'Odin')
    await expect(odin).toBeVisible()
    await expect(storageImages(odin)).toHaveCount(0)
    await expect(odin.locator('.media-placeholder')).toHaveCount(1)
    await expect(odin).toContainText('89 kr.')
    expect(await guest.content()).not.toContain(uploadC)
  })
  await guestPage(browser, '/', async (guest) => {
    const featured = guest.getByRole('region', { name: 'Tre fra menuen' })
    await expect(storageImages(featured)).toHaveCount(0)
    await expect(featured).toContainText('Odin')
  })
})

test('the run restores the seed: no references, no article, an empty library', async () => {
  await deleteImageNamed(staffPage, /billede-b\.jpg/)

  const [images, odin, weekly, monthly, news] = await Promise.all([
    rest.from('images').select('id'),
    rest.from('dishes').select('image_id, draft').eq('name', 'Odin').single(),
    rest.from('weekly_special').select('image_id, draft').single(),
    rest.from('monthly_burger').select('image_id, draft, name').single(),
    rest.from('news').select('id').eq('slug', ARTICLE_SLUG),
  ])

  expect((images.data ?? []).length, 'the library ends empty').toBe(0)
  expect((odin.data as { image_id: string | null }).image_id).toBeNull()
  expect((odin.data as { draft: unknown }).draft).toBeNull()
  expect((weekly.data as { image_id: string | null }).image_id).toBeNull()
  expect((weekly.data as { draft: unknown }).draft).toBeNull()
  expect((monthly.data as { image_id: string | null }).image_id).toBeNull()
  expect((monthly.data as { draft: unknown }).draft).toBeNull()
  expect((monthly.data as { name: string | null }).name).toBeNull()
  expect((news.data ?? []).length).toBe(0)
})
