import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  addressLine,
  asGuest,
  bodyEditor,
  deleteArticle,
  deleteArticleNamed,
  editorForm,
  fillArticle,
  listRow,
  openArticleEditor,
  openNewEditor,
  openNewsAdmin,
  publishArticle,
  saveArticle,
  selectBodyText,
  shownSlug,
  stateBadge,
  unpublishArticle,
  waitForAutosaved,
} from './support/news-admin'

/**
 * The news administration — design 1s / 1z; phase 9A; technical plan §4, §5, §6, §7f.
 *
 * The promise this suite exists for: **an article is written as a draft a guest cannot
 * reach, publishing it is an explicit confirmed step, the first guest request after
 * that sees it at its generated address — and because news has no draft column, an
 * edit to a published article is on the hjemmeside the moment it is saved, said out
 * loud rather than discovered.**
 *
 * It runs in order and shares one signed-in page, because it is one story. Both
 * dedicated projects run it — 375 first, then 1440 — and it restores what it touches:
 * every article it creates it also deletes, through the same Slet confirmation a
 * person uses, so the run ends on exactly the three seeded articles.
 */

test.describe.configure({ mode: 'serial' })

const TITLE_A = 'Playwright-nyhed om løg og æbler'
const SLUG_A = 'playwright-nyhed-om-loeg-og-aebler'
const TITLE_A2 = 'Playwright-nyhed med ny adresse'
const SLUG_A2 = 'playwright-nyhed-med-ny-adresse'
const TITLE_A3 = 'Playwright-nyhed, tredje overskrift'
const BODY_TEXT = 'Første afsnit fra Playwright.\n\nAndet afsnit — med æøå.'
const REVISED_TEXT = 'Rettet afsnit fra Playwright.\n\nStadig med æøå.'

const SEEDED_TITLE = 'Overskrift placeholder — ny burger'

/** WCAG 2.2 A and AA, the same bar every other screen is held to. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

let staffPage: Page

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

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
})

test.afterAll(async () => {
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// The way in, and the list
// ---------------------------------------------------------------------------

test('the dashboard leads to the news list', async () => {
  await staffPage.goto('/admin')
  await staffPage.getByRole('link', { name: 'Skriv en nyhed', exact: true }).click()

  await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Nyheder')
})

test('the list shows the seeded articles as published, in words', async () => {
  await openNewsAdmin(staffPage)

  const row = listRow(staffPage, SEEDED_TITLE)
  await expect(row).toBeVisible()
  await expect(row).toContainText('Udgivet')
  await expect(row).toContainText('Offentliggjort')

  await noSidewaysScroll(staffPage)
})

// ---------------------------------------------------------------------------
// Creating — validation first, then the draft
// ---------------------------------------------------------------------------

test('an empty form is refused with Danish sentences bound to their fields', async () => {
  await openNewEditor(staffPage)

  await editorForm(staffPage).getByRole('button', { name: 'Gem kladde' }).click()
  await staffPage.waitForURL(/status=ugyldig/)

  await expect(staffPage.getByText('Nyheden skal have en overskrift.')).toBeVisible()
  await expect(staffPage.getByText('Skriv teksten til nyheden.')).toBeVisible()

  const title = editorForm(staffPage).getByLabel('Overskrift')
  await expect(title).toHaveAttribute('aria-invalid', 'true')

  await noSidewaysScroll(staffPage)
})

test('what was typed survives a refusal', async () => {
  await openNewEditor(staffPage)
  await fillArticle(staffPage, { title: TITLE_A, category: 'Lukket' })
  // No text: one error, while the rest of the form is already right.
  await editorForm(staffPage).getByRole('button', { name: 'Gem kladde' }).click()
  await staffPage.waitForURL(/status=ugyldig/)

  await expect(editorForm(staffPage).getByLabel('Overskrift')).toHaveValue(TITLE_A)
  await expect(
    editorForm(staffPage).getByRole('radio', { name: 'Lukket', exact: true }),
  ).toBeChecked()
})

test('a valid article is created as a Kladde, with §7f’s generated address', async () => {
  await fillArticle(staffPage, { text: BODY_TEXT })
  await saveArticle(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText(
    'Nyheden er oprettet som kladde',
  )
  await expect(stateBadge(staffPage)).toHaveText('Kladde')

  // æ→ae, ø→oe, å→aa, spaces to hyphens — the Danish transliteration, end to end.
  expect(await shownSlug(staffPage)).toBe(SLUG_A)
  await expect(addressLine(staffPage)).toContainText('dannes ud fra overskriften')

  // And the editor says what the model means: a draft is invisible until published.
  await expect(staffPage.getByText('Gæster kan ikke se den, før du offentliggør den.')).toBeVisible()
})

test('a guest sees no trace of the draft — not on the list, not at its address', async ({
  browser,
}) => {
  await asGuest(browser, async (guest) => {
    await guest.goto('/nyheder')
    // The seeded card first: a `toHaveCount(0)` asked of a still-streaming document
    // answers 0 about anything, so absence is asserted only behind presence.
    await expect(guest.getByText(SEEDED_TITLE)).toBeVisible()
    await expect(guest.getByText(TITLE_A)).toHaveCount(0)

    const response = await guest.goto(`/nyheder/${SLUG_A}`)
    expect(response?.status(), 'an unpublished address is a 404').toBe(404)
  })
})

test('Forhåndsvis opens the real public address for the unpublished article (§6)', async () => {
  await openArticleEditor(staffPage, TITLE_A)
  await staffPage.getByRole('link', { name: 'Forhåndsvis på hjemmesiden' }).click()

  await staffPage.waitForURL(`/nyheder/${SLUG_A}`)
  await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText(TITLE_A)
  await expect(staffPage.getByText('Første afsnit fra Playwright.')).toBeVisible()

  // Leave Draft Mode again, so nothing later in this suite reads as a preview.
  await staffPage.goto('/api/preview/stop?maal=nyheder')
})

test('before first publish, the address follows the title', async () => {
  await openArticleEditor(staffPage, TITLE_A)
  await fillArticle(staffPage, { title: TITLE_A2 })
  await saveArticle(staffPage)

  expect(await shownSlug(staffPage)).toBe(SLUG_A2)
})

// ---------------------------------------------------------------------------
// Publishing — the confirmation, and the first guest request
// ---------------------------------------------------------------------------

test('the publish confirmation has no accessibility violations, and Esc backs out', async () => {
  await openArticleEditor(staffPage, TITLE_A2)
  await staffPage.getByRole('link', { name: 'Offentliggør' }).click()

  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toContainText(`Offentliggør “${TITLE_A2}”?`)

  // The keyboard opens on the safe choice.
  await expect(dialog.getByRole('link', { name: 'Tilbage' })).toBeFocused()

  expect(await violations(staffPage)).toEqual([])

  await staffPage.keyboard.press('Escape')
  await staffPage.waitForURL(/#offentliggoer-nyhed$/)

  // Nothing happened: still a Kladde, and focus is back on the control.
  await expect(stateBadge(staffPage)).toHaveText('Kladde')
  await expect(staffPage.getByRole('link', { name: 'Offentliggør' })).toBeFocused()
})

test('publishing is the confirmed, explicit step — and flips the state in words', async () => {
  await publishArticle(staffPage, TITLE_A2)

  await expect(staffPage.getByRole('status').first()).toContainText('Nyheden er offentliggjort')
  await expect(stateBadge(staffPage)).toHaveText('Udgivet')
  await expect(addressLine(staffPage)).toContainText('låst')
})

test('the FIRST guest request sees the article on /nyheder', async ({ browser }) => {
  await asGuest(browser, async (guest) => {
    await guest.goto('/nyheder')

    const card = guest.locator('article', { hasText: TITLE_A2 })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Lukket')
    await expect(card).toContainText('Første afsnit fra Playwright.')
  })
})

test('…and the article page itself renders the structured body', async ({ browser }) => {
  await asGuest(browser, async (guest) => {
    await guest.goto(`/nyheder/${SLUG_A2}`)

    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(TITLE_A2)
    await expect(guest.getByText('Første afsnit fra Playwright.')).toBeVisible()
    await expect(guest.getByText('Andet afsnit — med æøå.')).toBeVisible()
    await expect(guest.getByRole('link', { name: /Alle nyheder/ })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Editing a published article — no draft layer, and the screen says so
// ---------------------------------------------------------------------------

test('editing a published article says the save is immediate, and keeps the URL', async () => {
  await openArticleEditor(staffPage, TITLE_A2)

  await expect(
    staffPage.getByText('gemte ændringer er på hjemmesiden med det samme'),
  ).toBeVisible()

  await fillArticle(staffPage, { title: TITLE_A3, text: REVISED_TEXT })
  await saveArticle(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText(
    'gemt og er på hjemmesiden nu',
  )

  // §7f: the address did not move with the title.
  expect(await shownSlug(staffPage)).toBe(SLUG_A2)
})

test('the FIRST guest request reads the edit, at the same address', async ({ browser }) => {
  await asGuest(browser, async (guest) => {
    await guest.goto(`/nyheder/${SLUG_A2}`)

    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(TITLE_A3)
    await expect(guest.getByText('Rettet afsnit fra Playwright.')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// The collision suffix, and optimistic concurrency
// ---------------------------------------------------------------------------

test('a second article with a colliding address gets §7f’s -2', async () => {
  await openNewEditor(staffPage)
  await fillArticle(staffPage, { title: TITLE_A2, text: 'Dubletten.' })
  await saveArticle(staffPage)

  await expect(stateBadge(staffPage)).toHaveText('Kladde')
  expect(await shownSlug(staffPage)).toBe(`${SLUG_A2}-2`)
})

test('a stale save is refused with a sentence — no silent overwrite', async () => {
  // Two views of the same article: the second saves first, the first is then stale.
  const colleague = await staffPage.context().newPage()

  await openArticleEditor(staffPage, TITLE_A2)
  await openArticleEditor(colleague, TITLE_A2)

  await fillArticle(colleague, { text: 'Kollegaens version.' })
  await saveArticle(colleague)
  await colleague.close()

  await fillArticle(staffPage, { text: 'Min forsinkede version.' })
  await saveArticle(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText(
    'En kollega har ændret nyheden i mellemtiden',
  )

  // Nothing was overwritten, and nothing typed was lost: the field still shows the
  // refused text, over the colleague's stored version.
  await expect(bodyEditor(staffPage)).toContainText('Min forsinkede version.')

  await openArticleEditor(staffPage, TITLE_A2)
  await expect(bodyEditor(staffPage)).toContainText('Kollegaens version.')
})

// ---------------------------------------------------------------------------
// Unpublish — §7f, and the address answering 404 again
// ---------------------------------------------------------------------------

test('Fjern fra hjemmesiden takes the article down behind its own confirmation', async () => {
  await openArticleEditor(staffPage, TITLE_A3)
  await unpublishArticle(staffPage)

  await expect(staffPage.getByRole('status').first()).toContainText(
    'fjernet fra hjemmesiden og gemt som kladde',
  )
  await expect(stateBadge(staffPage)).toHaveText('Kladde')

  // The slug stays frozen: the article has been published, and §7f promises the same
  // address if it comes back.
  await expect(addressLine(staffPage)).toContainText('låst')
})

test('the FIRST guest request after the unpublish reads neither list nor address', async ({
  browser,
}) => {
  await asGuest(browser, async (guest) => {
    await guest.goto('/nyheder')
    // Presence before absence, for the streamed-document reason above.
    await expect(guest.getByText(SEEDED_TITLE)).toBeVisible()
    await expect(guest.getByText(TITLE_A3)).toHaveCount(0)

    const response = await guest.goto(`/nyheder/${SLUG_A2}`)
    expect(response?.status(), 'an unpublished address answers 404 (§7f)').toBe(404)
  })
})

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

test('create and publish can be completed with the keyboard alone', async () => {
  await openNewsAdmin(staffPage)

  const create = staffPage.getByRole('link', { name: '+ Ny nyhed' })
  await create.focus()
  await staffPage.keyboard.press('Enter')
  await expect(staffPage.getByRole('form', { name: 'Ny nyhed' })).toBeVisible()

  const title = editorForm(staffPage).getByLabel('Overskrift')
  await title.focus()
  await staffPage.keyboard.type('Tastatur-nyhed fra Playwright')

  // The chips are a real radio group: Tab enters it once, the arrows move inside it.
  const noCategory = editorForm(staffPage).getByRole('radio', { name: 'Ingen kategori' })
  await noCategory.focus()
  await staffPage.keyboard.press('ArrowRight')
  await expect(
    editorForm(staffPage).getByRole('radio', { name: 'Ny burger', exact: true }),
  ).toBeChecked()

  const text = editorForm(staffPage).getByLabel('Tekst')
  await text.focus()
  await staffPage.keyboard.type('Skrevet med tastaturet alene.')

  await editorForm(staffPage).getByRole('button', { name: 'Gem kladde' }).focus()
  await staffPage.keyboard.press('Enter')
  // Autosave may already have created the row while the keyboard moved between
  // controls; either way the Gem lands on exactly one draft (§17).
  await staffPage.waitForURL(/status=(oprettet|gemt)/)

  await staffPage.getByRole('link', { name: 'Offentliggør' }).focus()
  await staffPage.keyboard.press('Enter')

  // Focus lands on the safe choice; Tab reaches the committing control.
  const dialog = staffPage.getByRole('dialog')
  await expect(dialog.getByRole('link', { name: 'Tilbage' })).toBeFocused()
  await staffPage.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Offentliggør' })).toBeFocused()
  await staffPage.keyboard.press('Enter')
  await staffPage.waitForURL(/status=offentliggjort/)

  await expect(stateBadge(staffPage)).toHaveText('Udgivet')

  // 1aa's 3 px focus ring, asserted once against a real focused control.
  const publishLink = staffPage.getByRole('link', { name: 'Fjern fra hjemmesiden' })
  await publishLink.focus()
  const outlineWidth = await publishLink.evaluate(
    (element) => getComputedStyle(element).outlineWidth,
  )
  expect(outlineWidth).toBe('3px')
})

// ---------------------------------------------------------------------------
// Phase 9B — the structured editor, autosave, and the article's public claims
// ---------------------------------------------------------------------------

const TITLE_B = 'Playwright 9B-nyhed om formatering'
const TITLE_B2 = 'Playwright 9B-nyhed, rettet uden JavaScript'
const LINK_HREF = 'https://example.test/menu'

let slugB = ''

test('autosave writes a brand-new article while the person types (§17)', async ({ browser }) => {
  await openNewEditor(staffPage)
  await fillArticle(staffPage, {
    title: TITLE_B,
    text: 'Autosave-afsnit om burgere.\n\nAndet afsnit i samme nyhed.',
  })

  // No Gem: the debounce fires, the row is created once, and the address adopts it.
  await waitForAutosaved(staffPage)
  await staffPage.waitForURL(/nyhed=/)

  await staffPage.reload()
  await expect(editorForm(staffPage).getByLabel('Overskrift')).toHaveValue(TITLE_B)
  await expect(bodyEditor(staffPage)).toContainText('Autosave-afsnit om burgere.')
  await expect(bodyEditor(staffPage)).toContainText('Andet afsnit i samme nyhed.')
  await expect(stateBadge(staffPage)).toHaveText('Kladde')

  slugB = await shownSlug(staffPage)

  // Still a draft: the autosave changed nothing a guest can read.
  await asGuest(browser, async (guest) => {
    await guest.goto('/nyheder')
    await expect(guest.getByText(SEEDED_TITLE)).toBeVisible()
    await expect(guest.getByText(TITLE_B)).toHaveCount(0)

    const response = await guest.goto(`/nyheder/${slugB}`)
    expect(response?.status(), 'an autosaved draft is not public').toBe(404)
  })
})

test('B marks a selection bold, toggles off again, and an empty selection changes nothing', async () => {
  await openArticleEditor(staffPage, TITLE_B)
  const editor = bodyEditor(staffPage)
  const bold = editorForm(staffPage).getByRole('button', { name: 'Fed skrift' })

  await selectBodyText(staffPage, 'Autosave-afsnit')
  await bold.click()
  await expect(editor.locator('[data-bold]')).toHaveText('Autosave-afsnit')
  await expect(bold).toHaveAttribute('aria-pressed', 'true')

  // The same selection again: the mark comes off — the round trip.
  await selectBodyText(staffPage, 'Autosave-afsnit')
  await bold.click()
  await expect(editor.locator('[data-bold]')).toHaveCount(0)

  // A caret alone marks nothing and corrupts nothing.
  const before = await editor.innerText()
  await editor.click()
  await bold.click()
  expect(await editor.innerText()).toBe(before)

  // Leave the bold on for the rest of the story.
  await selectBodyText(staffPage, 'Autosave-afsnit')
  await bold.click()
  await expect(editor.locator('[data-bold]')).toHaveText('Autosave-afsnit')
})

test('Link asks for an https-adresse, applies it, and can edit and remove it again', async () => {
  const editor = bodyEditor(staffPage)
  const linkButton = editorForm(staffPage).getByRole('button', { name: 'Link', exact: true })

  await selectBodyText(staffPage, 'Andet afsnit')
  await linkButton.click()

  // An unsafe address is refused in the panel — and the server refuses it again.
  await staffPage.getByLabel('Linkadresse').fill('javascript:alert(1)')
  await staffPage.getByRole('button', { name: 'Indsæt link' }).click()
  await expect(staffPage.getByText('Linket skal være en fuld https-adresse.')).toBeVisible()

  await staffPage.getByLabel('Linkadresse').fill(LINK_HREF)
  await staffPage.getByRole('button', { name: 'Indsæt link' }).click()
  await expect(editor.locator(`[data-href="${LINK_HREF}"]`)).toHaveText('Andet afsnit')

  // A caret inside the link edits *that* link: the panel opens prefilled, and can
  // take it away whole.
  await selectBodyText(staffPage, 'Andet afsnit')
  await linkButton.click()
  await expect(staffPage.getByLabel('Linkadresse')).toHaveValue(LINK_HREF)
  await staffPage.getByRole('button', { name: 'Fjern link' }).click()
  await expect(editor.locator('[data-href]')).toHaveCount(0)

  // And back on, for the public assertions ahead.
  await selectBodyText(staffPage, 'Andet afsnit')
  await linkButton.click()
  await staffPage.getByLabel('Linkadresse').fill(LINK_HREF)
  await staffPage.getByRole('button', { name: 'Indsæt link' }).click()
  await expect(editor.locator(`[data-href="${LINK_HREF}"]`)).toHaveText('Andet afsnit')

  await waitForAutosaved(staffPage)

  // The marks survive the round trip through the database.
  await staffPage.reload()
  await expect(bodyEditor(staffPage).locator('[data-bold]')).toHaveText('Autosave-afsnit')
  await expect(bodyEditor(staffPage).locator(`[data-href="${LINK_HREF}"]`)).toHaveText(
    'Andet afsnit',
  )

  expect(await violations(staffPage), 'the marked-up editor is accessible').toEqual([])
})

test('the toolbar works with the keyboard alone — including Ctrl+B', async () => {
  const editor = bodyEditor(staffPage)

  await editor.click()
  await staffPage.keyboard.press('Control+Home')
  for (let step = 0; step < 8; step += 1) await staffPage.keyboard.press('Shift+ArrowRight')
  await staffPage.keyboard.press('Control+b')
  // "Autosave-afsnit" was left bold by the earlier test, so the shortcut takes the
  // selected eight characters *out* of it — splitting the mark, not the text.
  await expect(editor.locator('[data-bold]')).toHaveText('-afsnit')

  // Shift+Tab reaches the toolbar from the writing box; Enter operates it.
  await staffPage.keyboard.press('Shift+Tab')
  await expect(
    editorForm(staffPage).getByRole('button', { name: 'Link', exact: true }),
  ).toBeFocused()
  await staffPage.keyboard.press('Shift+Tab')
  await expect(editorForm(staffPage).getByRole('button', { name: 'Fed skrift' })).toBeFocused()
  await staffPage.keyboard.press('Enter')
  // The selection survived the trip through the toolbar: the same eight characters
  // came back out of bold, leaving the earlier mark whole.
  await expect(editor.locator('[data-bold]')).toHaveText('Autosave-afsnit')

  // Ctrl+I is refused wholesale: no italic exists in this editor (frame 1s).
  await staffPage.keyboard.press('Control+i')
  expect(await editor.evaluate((root) => root.querySelectorAll('i, em').length)).toBe(0)
})

test('Preview renders the formatting before anything is public (§6)', async () => {
  await staffPage.getByRole('link', { name: 'Forhåndsvis på hjemmesiden' }).click()
  await staffPage.waitForURL(`/nyheder/${slugB}`)

  await expect(staffPage.locator('article strong')).toContainText('Autosave-afsnit')
  const link = staffPage.locator(`article a[href="${LINK_HREF}"]`)
  await expect(link).toHaveText('Andet afsnit')

  await staffPage.goto('/api/preview/stop?maal=nyheder')
})

test('publishing puts the structured body, the teaser, the JSON-LD and the sitemap live on the FIRST request', async ({
  browser,
}) => {
  await openArticleEditor(staffPage, TITLE_B)
  await publishArticle(staffPage, TITLE_B)

  await asGuest(browser, async (guest) => {
    // The article, with its marks drawn by the public renderer — no HTML anywhere.
    await guest.goto(`/nyheder/${slugB}`)
    await expect(guest.locator('article strong')).toContainText('Autosave-afsnit')
    const link = guest.locator(`article a[href="${LINK_HREF}"]`)
    await expect(link).toHaveText('Andet afsnit')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    // §11's NewsArticle block: valid JSON, stored values, nothing invented.
    const raw = await guest.locator('script[type="application/ld+json"]').textContent()
    expect(raw).not.toBeNull()
    const jsonLd = JSON.parse(raw!) as Record<string, unknown>
    expect(jsonLd['@context']).toBe('https://schema.org')
    expect(jsonLd['@type']).toBe('NewsArticle')
    expect(jsonLd.headline).toBe(TITLE_B)
    expect(String(jsonLd.mainEntityOfPage)).toContain(`/nyheder/${slugB}`)
    expect(jsonLd.dateModified).toBeTruthy()
    expect(jsonLd.image, 'images are phase 10 — nothing invented').toBeUndefined()
    expect(jsonLd.publisher).toEqual({ '@type': 'Organization', name: 'Klingenberg Food' })

    // §7f: self-canonical at the frozen address.
    const canonical = guest.locator('link[rel="canonical"]')
    await expect(canonical).toHaveAttribute('href', new RegExp(`/nyheder/${slugB}$`))

    // The Forside teaser is the newest published article — this one.
    await guest.goto('/')
    await expect(guest.getByRole('link', { name: TITLE_B })).toBeVisible()

    // And the sitemap carries the address (§7f, §11).
    const sitemap = await guest.request.get('/sitemap.xml')
    expect(await sitemap.text()).toContain(`/nyheder/${slugB}`)
  })
})

test('an autosaved edit to the published article is public on the FIRST request — and the screen says so', async ({
  browser,
}) => {
  await openArticleEditor(staffPage, TITLE_B)

  // The truthful sentence: no draft layer, and the editor saves by itself.
  await expect(staffPage.getByText('Ændringer gemmes automatisk, mens du skriver')).toBeVisible()

  const editor = bodyEditor(staffPage)
  await editor.click()
  await staffPage.keyboard.press('Control+End')
  await staffPage.keyboard.type(' Tilføjet efter offentliggørelsen.')

  await expect(
    staffPage.getByRole('banner').getByText('Gemt — ændringerne er på hjemmesiden'),
  ).toBeVisible({ timeout: 15_000 })

  await asGuest(browser, async (guest) => {
    await guest.goto(`/nyheder/${slugB}`)
    await expect(guest.getByText('Tilføjet efter offentliggørelsen.')).toBeVisible()
    // The marks were edited around, never flattened.
    await expect(guest.locator('article strong')).toContainText('Autosave-afsnit')
    await expect(guest.locator(`article a[href="${LINK_HREF}"]`)).toHaveText('Andet afsnit')
  })
})

test('without JavaScript, a marked-up body is preserved — never silently flattened', async ({
  browser,
}) => {
  // Reduced motion for the same reason the no-javascript project sets it: without
  // scripting, smooth anchor scrolling makes below-the-fold controls "unstable".
  const context = await browser.newContext({
    javaScriptEnabled: false,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await signIn(page, STAFF)

  await openArticleEditor(page, TITLE_B)

  // The body is shown, not offered as plain text to destroy: the sentence says why,
  // and there is no Tekst control to type into.
  await expect(page.getByText('kan kun redigeres, når JavaScript er slået til')).toBeVisible()
  await expect(page.getByLabel('Tekst', { exact: true })).toHaveCount(0)

  // The other fields still work — a title edit saves, and the text rides along whole.
  await page.getByLabel('Overskrift').fill(TITLE_B2)
  await editorForm(page).getByRole('button', { name: 'Gem ændringer' }).click()
  await page.waitForURL(/status=gemt_live/)

  await context.close()

  await asGuest(browser, async (guest) => {
    await guest.goto(`/nyheder/${slugB}`)
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(TITLE_B2)
    await expect(guest.locator('article strong')).toContainText('Autosave-afsnit')
    await expect(guest.locator(`article a[href="${LINK_HREF}"]`)).toHaveText('Andet afsnit')
  })
})

test('a stale autosave is refused, says so, and leaves the local text alone (§6)', async () => {
  const colleague = await staffPage.context().newPage()

  await openArticleEditor(staffPage, TITLE_B2)
  await openArticleEditor(colleague, TITLE_B2)

  await fillArticle(colleague, { text: 'Kollegaens nyere version.' })
  await saveArticle(colleague)
  await colleague.close()

  // Staff types against the now-stale version; the debounced autosave meets the
  // version check and is refused without writing.
  const editor = bodyEditor(staffPage)
  await editor.click()
  await staffPage.keyboard.press('Control+End')
  await staffPage.keyboard.type(' Mit lokale konflikt-afsnit.')

  // `.first()`: the alert also lands in the sr-only live region beside the line.
  await expect(
    staffPage.getByRole('banner').getByText('Nogen andre har rettet denne nyhed').first(),
  ).toBeVisible({ timeout: 15_000 })

  // No false Gemt, and the local text is still on screen to keep or copy — nothing
  // replaced it with the database's version.
  await expect(editor).toContainText('Mit lokale konflikt-afsnit.')

  expect(await violations(staffPage), 'the conflict state is accessible').toEqual([])

  // The person resolves it by reloading; the colleague's version is the stored one.
  await staffPage.reload()
  await expect(bodyEditor(staffPage)).toContainText('Kollegaens nyere version.')
})

test('an autosave that cannot reach the server says so — and recovers on the next edit', async () => {
  await staffPage.route('**/admin/nyheder*', (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue(),
  )

  const editor = bodyEditor(staffPage)
  await editor.click()
  await staffPage.keyboard.press('Control+End')
  await staffPage.keyboard.type(' Skrevet mens serveren var væk.')

  await expect(staffPage.getByRole('banner').getByText('Kunne ikke gemme').first()).toBeVisible({
    timeout: 15_000,
  })

  await staffPage.unroute('**/admin/nyheder*')

  // The machine did not give up: the next edit schedules the next save.
  await staffPage.keyboard.type(' Og nu er den her igen.')
  await waitForAutosaved(staffPage)
})

test('unpublish takes the address, the teaser and the sitemap entry away; republish restores the same slug (§7f)', async ({
  browser,
}) => {
  await openArticleEditor(staffPage, TITLE_B2)
  await unpublishArticle(staffPage)

  await asGuest(browser, async (guest) => {
    const response = await guest.goto(`/nyheder/${slugB}`)
    expect(response?.status(), 'the unpublished address answers 404').toBe(404)

    await guest.goto('/')
    await expect(guest.getByText(TITLE_B2)).toHaveCount(0)

    const sitemap = await guest.request.get('/sitemap.xml')
    expect(await sitemap.text()).not.toContain(`/nyheder/${slugB}`)
  })

  await openArticleEditor(staffPage, TITLE_B2)
  await publishArticle(staffPage, TITLE_B2)

  await asGuest(browser, async (guest) => {
    const response = await guest.goto(`/nyheder/${slugB}`)
    expect(response?.status(), 'republishing restores the same address').toBe(200)

    const sitemap = await guest.request.get('/sitemap.xml')
    expect(await sitemap.text()).toContain(`/nyheder/${slugB}`)
  })
})

test('the 9B article leaves the stage the way every article does — through Slet', async ({
  browser,
}) => {
  await deleteArticleNamed(staffPage, TITLE_B2)

  await asGuest(browser, async (guest) => {
    await guest.goto('/nyheder')
    await expect(guest.getByText(SEEDED_TITLE)).toBeVisible()
    // "Tastatur-nyhed fra Playwright" is still published here by design — the final
    // cleanup test below takes it down and asserts the list is the seeded three.
    await expect(guest.getByText(TITLE_B2)).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// The owner — the same capabilities, not a duplicate of every scenario (§5)
// ---------------------------------------------------------------------------

test('the owner can write, publish, unpublish and delete an article', async ({ browser }) => {
  const context = await browser.newContext()
  const ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)

  await openNewEditor(ownerPage)
  await fillArticle(ownerPage, { title: 'Ejerens testnyhed', text: 'Ejerens tekst.' })
  await saveArticle(ownerPage)
  await expect(stateBadge(ownerPage)).toHaveText('Kladde')

  await publishArticle(ownerPage, 'Ejerens testnyhed')
  await expect(stateBadge(ownerPage)).toHaveText('Udgivet')

  await unpublishArticle(ownerPage)
  await expect(stateBadge(ownerPage)).toHaveText('Kladde')

  await deleteArticle(ownerPage)
  await expect(ownerPage.getByRole('status').first()).toContainText('Nyheden er slettet')

  await context.close()
})

// ---------------------------------------------------------------------------
// Cleanup — through the same Slet a person uses, ending on the seeded three
// ---------------------------------------------------------------------------

test('deleting a published article asks first, and the guest reads the seeded site again', async ({
  browser,
}) => {
  // The keyboard test left "Tastatur-nyhed fra Playwright" published.
  await openArticleEditor(staffPage, 'Tastatur-nyhed fra Playwright')
  await staffPage.getByRole('link', { name: 'Slet', exact: true }).click()

  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toContainText('synlig på hjemmesiden nu og forsvinder derfra')
  await dialog.getByRole('button', { name: /^Slet nyhed/ }).click()
  await staffPage.waitForURL(/status=slettet/)

  // The two remaining Playwright drafts. TITLE_A3 goes first, after which TITLE_A2
  // names exactly one row — the -2 duplicate.
  await deleteArticleNamed(staffPage, TITLE_A3)
  await deleteArticleNamed(staffPage, TITLE_A2)

  await openNewsAdmin(staffPage)
  // Presence before absence, for the streamed-document reason above.
  await expect(listRow(staffPage, SEEDED_TITLE)).toBeVisible()
  await expect(staffPage.getByText(/Playwright/)).toHaveCount(0)

  await asGuest(browser, async (guest) => {
    await guest.goto('/nyheder')
    await expect(guest.getByText(SEEDED_TITLE)).toBeVisible()
    await expect(guest.locator('article')).toHaveCount(3)
  })
})
