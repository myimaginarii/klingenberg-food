import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { OWNER, signIn, STAFF } from './support/admin'
import {
  deleteImageNamed,
  jpegFixture,
  openImagesAdmin,
  staffRestClient,
  uploadViaUi,
} from './support/images-admin'
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
 * Nyheder on a phone as the **primary** device — technical plan §15 (phase 12B),
 * design 1z.
 *
 * The locked phase-9 suites already prove that every news operation *works* at
 * 375 px. This suite proves something narrower and more demanding: that a member of
 * staff can write, format, preview, publish, edit, unpublish and delete an article
 * on a phone without a desktop — and that the screen keeps 1z's promises at the
 * moments that matter. So beside the story it asserts the phone-width facts a
 * desktop run cannot: the Kladde/Udgivet badge and the autosave line pinned in view
 * while the person types at the end of a long article, B and Link one tap away
 * there, the link panel opening beside them rather than at the top of the article,
 * no scroll after an autosave, the confirmations stacked with the safe way out
 * first, long titles and long addresses that wrap, every target at 44 px, and no
 * sideways scrolling anywhere — the public preview included.
 *
 * It is one dedicated project (`news-mobile`, 375 × 812 with touch) at the tail of
 * the chain: it publishes, uploads and deletes a real library image, and leaves the
 * seed as it found it. Nothing in the locked phase-9 suites was changed to make room
 * for it.
 */

test.describe.configure({ mode: 'serial' })

const VIEWPORT = { width: 375, height: 812 } as const
/** A phone with the software keyboard up: roughly this much of the screen is left. */
const KEYBOARD_VIEWPORT = { width: 375, height: 440 } as const

/** The pinned bar's two rows (`AdminSectionBar pinned`), in px. */
const PINNED_BAR_HEIGHT = 100

const TITLE = 'Telefon-nyhed 12B om løg, æbler og åben dør'
const SLUG = 'telefon-nyhed-12b-om-loeg-aebler-og-aaben-doer'
const SEEDED_TITLE = 'Overskrift placeholder — ny burger'

/**
 * The longest title the schema accepts (200 characters), deliberately ending in one
 * unbroken word — the one shape of valid content that can make a 343 px card scroll
 * sideways if the title is not allowed to break.
 */
const LONG_TITLE = (
  'Telefon-nyhed 12B: Nordisk burger med langtidsstegt okseculotte, karamelliserede løg, syltede agurker, sennepsmayonnaise ' +
  'x'.repeat(200)
).slice(0, 200)

const PARAGRAPH =
  'Vi holder åbent hele ugen med nye retter på kortet, og køkkenet serverer sæsonens grøntsager sammen med burgerne. '
/** Eight long paragraphs — an article that runs to several phone screens. */
const LONG_BODY = Array.from(
  { length: 8 },
  (_, index) => `Afsnit ${index + 1}. ${PARAGRAPH.repeat(3).trim()}`,
).join('\n\n')

/** A long address, as a link — and, typed as text, as a run with no break in it. */
const LONG_HREF = `https://example.test/${'meget-lang-adresse-'.repeat(20)}slut`
const UNBROKEN_WORD = 'x'.repeat(120)

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/** True when the document is wider than the phone — the thing 1aa forbids. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement
    return root.scrollWidth > root.clientWidth + 1
  })
}

/** Whether a control is wholly inside the viewport right now. */
async function insideViewport(locator: Locator): Promise<boolean> {
  const box = await locator.boundingBox()
  if (box === null) return false
  const viewport = locator.page().viewportSize() ?? VIEWPORT
  return (
    box.y >= 0 &&
    box.y + box.height <= viewport.height &&
    box.x >= 0 &&
    box.x + box.width <= viewport.width
  )
}

/** Wait for a control to come into view — a fragment scroll is a short animation. */
async function expectComesIntoView(locator: Locator, what: string): Promise<void> {
  await expect.poll(async () => insideViewport(locator), { message: what }).toBe(true)
}

/**
 * Every visible control in `scope` is at least 44 × 44 px (1aa).
 *
 * Labels are not targets — the category chips are drawn by a `<label>` around an
 * `sr-only` radio, and it is the chip that is measured, not the 1 px input.
 */
async function expectTargets44(scope: Locator | Page, what: string): Promise<void> {
  const controls = scope.locator(
    'a[href], button:not([hidden]), select, input[type=date], label:has(> input.sr-only)',
  )

  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue
    const box = await control.boundingBox()
    const name = ((await control.textContent()) ?? '').trim().slice(0, 30) || '(unnamed)'

    expect(box?.height ?? 0, `${what}: "${name}" is at least 44 px tall`).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0, `${what}: "${name}" is at least 44 px wide`).toBeGreaterThanOrEqual(44)
  }
}

/** The safe choice stacked above the committing one, full width, a clear gap between. */
async function expectStackedChoices(dialog: Locator, cancel: Locator, confirm: Locator): Promise<void> {
  const keep = await cancel.boundingBox()
  const commit = await confirm.boundingBox()
  expect(keep, 'the safe choice is drawn').not.toBeNull()
  expect(commit, 'the committing choice is drawn').not.toBeNull()
  expect(commit!.y - (keep!.y + keep!.height)).toBeGreaterThanOrEqual(8)
  expect(Math.abs(keep!.width - commit!.width)).toBeLessThanOrEqual(1)
  expect(keep!.width).toBeGreaterThanOrEqual(280)
  expect(await insideViewport(dialog)).toBe(true)
  await expectTargets44(dialog, 'the confirmation')
}

function banner(page: Page) {
  return page.getByRole('banner')
}

function toolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Formatering' })
}

function boldButton(page: Page) {
  return editorForm(page).getByRole('button', { name: 'Fed skrift' })
}

function linkButton(page: Page) {
  return editorForm(page).getByRole('button', { name: 'Link', exact: true })
}

/** Put the caret at the very end of the body and scroll that line into the middle of the screen. */
async function caretToEnd(page: Page): Promise<void> {
  await bodyEditor(page).click()
  await page.keyboard.press('Control+End')
  await page.evaluate(() => {
    const node = window.getSelection()?.focusNode
    const element = node instanceof Element ? node : node?.parentElement
    element?.scrollIntoView({ block: 'center' })
  })
  await page.waitForTimeout(200)
}

/** The kind of element that has focus, by role or tag. */
async function focusedKind(page: Page): Promise<string> {
  return page.evaluate(
    () => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName ?? '',
  )
}

let staffPage: Page
let rest: SupabaseClient

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true })
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
  rest = await staffRestClient()

  // The picker needs a library with something in it. Uploaded through the real screen.
  await openImagesAdmin(staffPage)
  await uploadViaUi(staffPage, {
    name: 'mobil-12b.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegFixture(1200, 800, 60),
  })
})

test.afterAll(async () => {
  // Best-effort restoration so the chain stays re-runnable after a failure: no
  // article of this suite's, no image in the library. The article leaves through
  // the same Slet a person uses; the image through the trusted delete door, as
  // `menu-mobile` does.
  try {
    await openNewsAdmin(staffPage)
    for (const row of await staffPage.getByRole('link', { name: /Telefon-nyhed 12B/ }).all()) {
      const title = ((await row.textContent()) ?? '').slice(0, 24)
      await deleteArticleNamed(staffPage, title)
      await openNewsAdmin(staffPage)
    }
    const leftovers = await rest.from('images').select('id, updated_at')
    for (const row of (leftovers.data ?? []) as { id: string; updated_at: string }[]) {
      await rest.rpc('delete_image', {
        p_id: row.id,
        p_expected_updated_at: row.updated_at,
        p_confirmed: true,
      })
    }
  } finally {
    await rest.auth.signOut()
    await staffPage.context().close()
  }
})

// ---------------------------------------------------------------------------
// 1. Into the news, and the list
// ---------------------------------------------------------------------------

test('a staff member reaches Nyheder from the dashboard, and the list fits the phone', async () => {
  await staffPage.goto('/admin')
  await staffPage.getByRole('link', { name: 'Skriv en nyhed', exact: true }).click()

  await expect(staffPage.getByRole('heading', { level: 1 })).toHaveText('Nyheder')
  await expect(banner(staffPage).getByRole('link', { name: /Tilbage/ })).toHaveAttribute('href', '/admin')
  expect(await scrollsSideways(staffPage)).toBe(false)

  // 1z's list: cards with the state in words, the way in on the whole card, and
  // "+ Ny" in the bar, all on screen without scrolling.
  const row = listRow(staffPage, SEEDED_TITLE)
  await expect(row).toContainText('Udgivet')
  await expect(row).toContainText('Offentliggjort')
  expect(await insideViewport(row)).toBe(true)
  expect(await insideViewport(banner(staffPage).getByRole('link', { name: '+ Ny nyhed' }))).toBe(true)
  await expectTargets44(staffPage, 'the list')
  expect(await violations(staffPage)).toEqual([])
})

// ---------------------------------------------------------------------------
// 2–3. A new article: the editor, and the first save
// ---------------------------------------------------------------------------

test('the new-article editor has phone-ready fields under a bar that stays', async () => {
  await openNewEditor(staffPage)
  const form = editorForm(staffPage)

  // 16 px in every editable control, so iOS does not zoom into the field.
  for (const control of [form.getByLabel('Overskrift'), form.getByLabel('Dato på hjemmesiden'), bodyEditor(staffPage)]) {
    expect(await control.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px')
  }

  // The bar is pinned on the phone — two rows of fixed height — and the B/Link
  // toolbar sticks under it; from md both are ordinary blocks (`a11y/news-admin`).
  await expect(banner(staffPage)).toHaveCSS('position', 'sticky')
  expect(Math.round((await banner(staffPage).boundingBox())?.height ?? 0)).toBe(PINNED_BAR_HEIGHT)
  await expect(toolbar(staffPage).locator('..')).toHaveCSS('position', 'sticky')

  // The image slot says why it is not open yet, and how to open it.
  await expect(staffPage.getByText('Billedet kan vælges, når nyheden er gemt første gang')).toBeVisible()
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toHaveCount(0)

  await expectTargets44(staffPage.locator('main'), 'the empty editor')
  expect(await scrollsSideways(staffPage)).toBe(false)
  expect(await violations(staffPage)).toEqual([])
})

test('typing creates the draft by itself, with the autosave line in view and no scroll', async () => {
  const form = editorForm(staffPage)
  await form.getByLabel('Overskrift').fill(TITLE)
  await bodyEditor(staffPage).click()
  await staffPage.keyboard.type('Første afsnit, skrevet på telefonen.')

  const before = await staffPage.evaluate(() => window.scrollY)
  await waitForAutosaved(staffPage)
  await staffPage.waitForURL(/nyhed=/)

  // The screen did not move and the keyboard is still in the text — §17's
  // creation is invisible except for the words in the pinned bar.
  expect(await staffPage.evaluate(() => window.scrollY)).toBe(before)
  expect(await focusedKind(staffPage)).toBe('textbox')
  expect(await insideViewport(banner(staffPage).getByText('Gemt for lidt siden'))).toBe(true)

  // Gem re-renders the row as an existing article: the badge, the address and the
  // photo slot appear — with the outcome in view under the pinned bar.
  await saveArticle(staffPage)
  await expect(stateBadge(staffPage)).toHaveText('Kladde')
  expect(await insideViewport(stateBadge(staffPage))).toBe(true)
  expect(await insideViewport(staffPage.getByRole('status').first())).toBe(true)
  expect(await shownSlug(staffPage)).toBe(SLUG)
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// 4. The image picker, on the phone
// ---------------------------------------------------------------------------

test('the picker fits the phone, opens on the safe control, chooses, and hands focus back', async () => {
  await openArticleEditor(staffPage, TITLE)
  await staffPage.getByRole('link', { name: 'Vælg billede' }).click()

  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect(await insideViewport(dialog)).toBe(true)
  await expect(dialog.getByRole('link', { name: 'Annuller' })).toBeFocused()
  await expect(dialog.locator('> div')).toHaveCSS('overflow-y', 'auto')
  await expectTargets44(dialog, 'the picker')
  expect(await violations(staffPage)).toEqual([])

  await staffPage.keyboard.press('Escape')
  await staffPage.waitForURL(/#vaelg-billede$/)
  await expect(staffPage.getByRole('link', { name: 'Vælg billede' })).toBeFocused()

  await staffPage.getByRole('link', { name: 'Vælg billede' }).click()
  await staffPage.getByRole('dialog').getByRole('button', { name: /mobil-12b\.jpg/ }).click()
  await staffPage.waitForURL(/status=billede_gemt/)

  await expect(staffPage.getByRole('link', { name: /^Skift billede/ })).toBeVisible()
  await expect(staffPage.getByRole('button', { name: 'Fjern billede' })).toBeVisible()
  await expectTargets44(staffPage.locator('main'), 'the editor with a photo')
  expect(await scrollsSideways(staffPage)).toBe(false)
})

// ---------------------------------------------------------------------------
// 5–7. A long article: the toolbar and the words that matter stay in reach
// ---------------------------------------------------------------------------

test('at the end of a long article the badge, the autosave line and B/Link are still on screen', async () => {
  await openArticleEditor(staffPage, TITLE)
  await bodyEditor(staffPage).fill(LONG_BODY)
  await waitForAutosaved(staffPage)
  await caretToEnd(staffPage)

  // Far down the page — and the bar and the toolbar are exactly where 1z draws
  // them, at the top, one under the other.
  expect(await staffPage.evaluate(() => window.scrollY)).toBeGreaterThan(1500)
  expect(await insideViewport(stateBadge(staffPage))).toBe(true)
  expect(await insideViewport(banner(staffPage).getByText('Gemt for lidt siden'))).toBe(true)
  const bold = await boldButton(staffPage).boundingBox()
  expect(bold?.y ?? 0).toBeGreaterThanOrEqual(PINNED_BAR_HEIGHT)
  expect(await insideViewport(boldButton(staffPage))).toBe(true)
  expect(await insideViewport(linkButton(staffPage))).toBe(true)

  // With the software keyboard up there is still room to write under them.
  await staffPage.setViewportSize(KEYBOARD_VIEWPORT)
  await caretToEnd(staffPage)
  expect(await insideViewport(banner(staffPage))).toBe(true)
  expect(await insideViewport(toolbar(staffPage))).toBe(true)
  const toolbarBox = await toolbar(staffPage).boundingBox()
  expect(KEYBOARD_VIEWPORT.height - ((toolbarBox?.y ?? 0) + (toolbarBox?.height ?? 0))).toBeGreaterThan(240)

  // Typing there and letting autosave run moves nothing and steals no focus.
  const before = await staffPage.evaluate(() => window.scrollY)
  await staffPage.keyboard.type(' Tilføjet på telefonen.')
  await waitForAutosaved(staffPage)
  expect(await staffPage.evaluate(() => window.scrollY)).toBe(before)
  expect(await focusedKind(staffPage)).toBe('textbox')

  await staffPage.setViewportSize(VIEWPORT)
})

test('a conflict worded over several lines grows the bar, and the toolbar moves down with it — never under it', async () => {
  // A colleague saves a newer version — every paragraph kept, so the story goes on
  // with this article after the reload that resolves the conflict.
  const colleague = await staffPage.context().newPage()
  await openArticleEditor(colleague, TITLE)
  await fillArticle(colleague, { text: `${LONG_BODY}\n\nKollegaens afsnit.` })
  await saveArticle(colleague)
  await colleague.close()

  // Staff, deep in the article, types against the now-stale version.
  await caretToEnd(staffPage)
  const lineTop = () =>
    staffPage.evaluate(() => {
      const node = window.getSelection()?.focusNode
      const element = node instanceof Element ? node : node?.parentElement
      return Math.round(element?.getBoundingClientRect().top ?? -1)
    })
  const lineBefore = await lineTop()
  await staffPage.keyboard.type(' Mit lokale afsnit.')

  // `.first()`: the alert also lands in the sr-only live region beside the line.
  const alert = banner(staffPage).getByText('Nogen andre har rettet denne nyhed').first()
  await expect(alert).toBeVisible({ timeout: 15_000 })

  // The wording is whole — several lines of it, all inside the bar, which is
  // taller than its two ordinary rows for as long as the conflict stands.
  const alertBox = await alert.boundingBox()
  const barBox = await banner(staffPage).boundingBox()
  expect(alertBox, 'the alert is drawn').not.toBeNull()
  expect(barBox, 'the bar is drawn').not.toBeNull()
  const alertLines = await alert.evaluate(
    (element) => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight),
  )
  expect(alertLines).toBeGreaterThan(1)
  expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(barBox!.y + barBox!.height)
  expect(barBox!.height).toBeGreaterThan(PINNED_BAR_HEIGHT)
  await expect(banner(staffPage).locator('[aria-live="polite"]')).toHaveText(/Nogen andre har rettet denne nyhed/)

  // The toolbar's top is at the bar's bottom — under it in the flow, never beneath
  // it in paint — and B and Link are whole, in view and the thing a tap reaches.
  const expectToolbarUnderBar = async (what: string) => {
    const bar = await banner(staffPage).boundingBox()
    const bars = await toolbar(staffPage).boundingBox()
    const barBottom = (bar?.y ?? 0) + (bar?.height ?? 0)
    expect(bars?.y ?? -1, `${what}: the toolbar starts at or below the bar's bottom`).toBeGreaterThanOrEqual(barBottom - 0.5)
    expect(bars?.y ?? -1, `${what}: the toolbar starts immediately below the bar`).toBeLessThanOrEqual(barBottom + 1)
    expect(await insideViewport(toolbar(staffPage)), `${what}: the toolbar is on screen`).toBe(true)
    expect(await insideViewport(boldButton(staffPage))).toBe(true)
    expect(await insideViewport(linkButton(staffPage))).toBe(true)
    const reached = await toolbar(staffPage).evaluate((element) =>
      Array.from(element.querySelectorAll('button')).every((button) => {
        const box = button.getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return hit === button || button.contains(hit)
      }),
    )
    expect(reached, `${what}: a tap on B and on Link reaches the button`).toBe(true)
  }
  await expectToolbarUnderBar('the conflict at 812')
  expect(await scrollsSideways(staffPage)).toBe(false)

  // The text the person was writing stays where it was on the screen; the caret
  // keeps the keyboard; nothing jumped to the top of the article.
  expect(Math.abs((await lineTop()) - lineBefore)).toBeLessThan(8)
  expect(await focusedKind(staffPage)).toBe('textbox')
  expect(await staffPage.evaluate(() => window.scrollY)).toBeGreaterThan(1500)
  await expectTargets44(toolbar(staffPage).locator('..'), 'the toolbar under the conflict')
  expect(await violations(staffPage), 'the conflict state is accessible').toEqual([])

  // With the software keyboard up, the whole warning, B and Link and room to write.
  await staffPage.setViewportSize(KEYBOARD_VIEWPORT)
  await caretToEnd(staffPage)
  expect(await insideViewport(alert)).toBe(true)
  await expectToolbarUnderBar('the conflict at the keyboard height')
  const toolbarBox = await toolbar(staffPage).boundingBox()
  expect(KEYBOARD_VIEWPORT.height - ((toolbarBox?.y ?? 0) + (toolbarBox?.height ?? 0))).toBeGreaterThan(200)
  expect(await scrollsSideways(staffPage)).toBe(false)
  await staffPage.setViewportSize(VIEWPORT)

  // The conflict is resolved the way the wording says: by reloading. The stored
  // version is the colleague's; the bar is its two rows again.
  await staffPage.reload()
  await expect(bodyEditor(staffPage)).toContainText('Kollegaens afsnit.')
  await expect(bodyEditor(staffPage)).not.toContainText('Mit lokale afsnit.')
  expect(Math.round((await banner(staffPage).boundingBox())?.height ?? 0)).toBe(PINNED_BAR_HEIGHT)
})

test('B and Link work from deep in the article, and the link panel opens beside the toolbar', async () => {
  const editor = bodyEditor(staffPage)

  await selectBodyText(staffPage, 'Afsnit 8')
  await staffPage.evaluate(() => {
    const node = window.getSelection()?.focusNode
    const element = node instanceof Element ? node : node?.parentElement
    element?.scrollIntoView({ block: 'center' })
  })
  expect(await insideViewport(boldButton(staffPage))).toBe(true)
  await boldButton(staffPage).click()
  await expect(editor.locator('[data-bold]')).toHaveText('Afsnit 8')
  await expect(boldButton(staffPage)).toHaveAttribute('aria-pressed', 'true')

  // Link: the panel opens under the stuck toolbar, in view, with the address field
  // focused — and the words the person selected stay where they were on the
  // screen (the panel takes its room above them; scroll anchoring keeps the text
  // still), instead of the page jumping to the top of the article.
  await selectBodyText(staffPage, 'Afsnit 7')
  const selectedLine = () =>
    staffPage.evaluate(() => {
      const node = window.getSelection()?.focusNode
      const element = node instanceof Element ? node : node?.parentElement
      element?.scrollIntoView({ block: 'center' })
      return Math.round(element?.getBoundingClientRect().top ?? -1)
    })
  const lineBefore = await selectedLine()
  await linkButton(staffPage).click()
  const address = staffPage.getByLabel('Linkadresse')
  await expect(address).toBeFocused()
  expect(await insideViewport(address)).toBe(true)
  const lineAfter = await editor.locator('[data-href], p', { hasText: 'Afsnit 7' }).first().evaluate(
    (element) => Math.round(element.getBoundingClientRect().top),
  )
  expect(Math.abs(lineAfter - lineBefore)).toBeLessThan(40)
  expect(await staffPage.evaluate(() => window.scrollY)).toBeGreaterThan(1500)
  expect(await address.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px')
  await expectTargets44(toolbar(staffPage).locator('..'), 'the link panel')
  expect(await violations(staffPage)).toEqual([])

  // `http:` is refused in the panel, in view; `https:` is applied and the keyboard
  // returns to the text where it was.
  await address.fill('http://example.test/usikker')
  await staffPage.getByRole('button', { name: 'Indsæt link' }).click()
  const problem = staffPage.getByText('Linket skal være en fuld https-adresse.')
  await expect(problem).toBeVisible()
  expect(await insideViewport(problem)).toBe(true)

  await address.fill(LONG_HREF)
  await staffPage.getByRole('button', { name: 'Indsæt link' }).click()
  await expect(editor.locator(`[data-href="${LONG_HREF}"]`)).toHaveText('Afsnit 7')
  expect(await focusedKind(staffPage)).toBe('textbox')
  expect(await staffPage.evaluate(() => window.scrollY)).toBeGreaterThan(1500)

  // Annullér hands the keyboard back too.
  await selectBodyText(staffPage, 'Afsnit 6')
  await linkButton(staffPage).click()
  await expect(staffPage.getByLabel('Linkadresse')).toBeFocused()
  await staffPage.getByRole('button', { name: 'Annullér' }).click()
  expect(await focusedKind(staffPage)).toBe('textbox')
  await expect(editor.locator('[data-href]')).toHaveCount(1)

  // Shift+Tab from the text reaches the toolbar; the ring is 1aa's 3 px.
  await editor.click()
  await staffPage.keyboard.press('Shift+Tab')
  await expect(linkButton(staffPage)).toBeFocused()
  expect(await linkButton(staffPage).evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px')

  await waitForAutosaved(staffPage)
})

test('the longest content wraps — in the editor, on the list and on the public preview', async () => {
  const editor = bodyEditor(staffPage)
  await caretToEnd(staffPage)
  await staffPage.keyboard.type(` ${LONG_HREF} ${UNBROKEN_WORD}`)
  await waitForAutosaved(staffPage)

  expect(await scrollsSideways(staffPage), 'the editor with an unbroken word').toBe(false)
  const box = await editor.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)

  // The public rendering of the same body, through Forhåndsvis, at the phone width.
  await staffPage.getByRole('link', { name: 'Forhåndsvis på hjemmesiden' }).click()
  await staffPage.waitForURL(`/nyheder/${SLUG}`)
  await expect(staffPage.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()
  await expect(staffPage.locator('article strong')).toContainText('Afsnit 8')
  expect(await scrollsSideways(staffPage), 'the public article with an unbroken word').toBe(false)
  await staffPage.goto('/api/preview/stop?maal=nyheder')

  // The longest title the schema allows, on the card: it breaks inside the card and
  // the state stays beside it.
  await openArticleEditor(staffPage, TITLE)
  await editorForm(staffPage).getByLabel('Overskrift').fill(LONG_TITLE)
  await saveArticle(staffPage)
  expect((await shownSlug(staffPage)).startsWith('telefon-nyhed-12b-nordisk-burger')).toBe(true)
  expect(await scrollsSideways(staffPage), 'the editor with the longest title').toBe(false)
  const addressBox = await addressLine(staffPage).boundingBox()
  expect((addressBox?.x ?? 0) + (addressBox?.width ?? 0)).toBeLessThanOrEqual(VIEWPORT.width)

  // The confirmation quotes the title: it wraps inside the sheet too.
  await staffPage.getByRole('link', { name: 'Offentliggør' }).click()
  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toContainText('Offentliggør “Telefon-nyhed 12B: Nordisk')
  const dialogBox = await dialog.boundingBox()
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(VIEWPORT.width)
  const heading = await dialog.getByRole('heading').evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))
  expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth)
  expect(await scrollsSideways(staffPage), 'the confirmation with the longest title').toBe(false)
  await staffPage.keyboard.press('Escape')
  await staffPage.waitForURL(/#offentliggoer-nyhed$/)

  await openNewsAdmin(staffPage)
  const row = listRow(staffPage, 'Telefon-nyhed 12B: Nordisk')
  const rowBox = await row.boundingBox()
  expect((rowBox?.x ?? 0) + (rowBox?.width ?? 0)).toBeLessThanOrEqual(VIEWPORT.width)
  expect(rowBox?.height ?? 0).toBeGreaterThan(100)
  await expect(row).toContainText('Kladde')
  expect(await insideViewport(row.getByText('Kladde'))).toBe(true)
  expect(await scrollsSideways(staffPage), 'the list with the longest title').toBe(false)
  await expectTargets44(staffPage.locator('main'), 'the list with the longest title')

  await openArticleEditor(staffPage, 'Telefon-nyhed 12B: Nordisk')
  await editorForm(staffPage).getByLabel('Overskrift').fill(TITLE)
  await saveArticle(staffPage)
})

// ---------------------------------------------------------------------------
// 8. Validation
// ---------------------------------------------------------------------------

test('a refused save comes back readable, bound to its field, in view', async () => {
  await openArticleEditor(staffPage, TITLE)
  await editorForm(staffPage).getByLabel('Overskrift').fill('???')
  await editorForm(staffPage).getByRole('button', { name: 'Gem kladde' }).click()
  await staffPage.waitForURL(/status=ugyldig/)

  const title = editorForm(staffPage).getByLabel('Overskrift')
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  const error = staffPage.getByText('Overskriften skal indeholde mindst ét bogstav')
  await expect(error).toBeVisible()
  expect(await insideViewport(error)).toBe(true)
  expect(await insideViewport(staffPage.getByRole('status').first())).toBe(true)
  expect(await scrollsSideways(staffPage)).toBe(false)
  expect(await violations(staffPage)).toEqual([])

  await title.fill(TITLE)
  await editorForm(staffPage).getByRole('button', { name: 'Gem kladde' }).click()
  await staffPage.waitForURL(/status=gemt/)
})

// ---------------------------------------------------------------------------
// 9–10. Publish, and the first guest request
// ---------------------------------------------------------------------------

test('the publish confirmation stacks the safe choice first, fits, and Esc hands focus back', async () => {
  await openArticleEditor(staffPage, TITLE)
  const publish = staffPage.getByRole('link', { name: 'Offentliggør' })
  await publish.scrollIntoViewIfNeeded()
  expect(await insideViewport(publish)).toBe(true)
  await publish.click()

  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toContainText(`Offentliggør “${TITLE}”?`)
  await expect(dialog.getByRole('link', { name: 'Tilbage' })).toBeFocused()
  await expectStackedChoices(dialog, dialog.getByRole('link', { name: 'Tilbage' }), dialog.getByRole('button', { name: 'Offentliggør' }))
  expect(await violations(staffPage)).toEqual([])

  await staffPage.keyboard.press('Escape')
  await staffPage.waitForURL(/#offentliggoer-nyhed$/)
  await expect(staffPage.getByRole('link', { name: 'Offentliggør' })).toBeFocused()
  await expectComesIntoView(staffPage.getByRole('link', { name: 'Offentliggør' }), 'the control the confirmation came from')
  await expect(stateBadge(staffPage)).toHaveText('Kladde')
})

test('publishing flips the badge in the pinned bar, and the first guest request sees the article', async ({ browser }) => {
  await publishArticle(staffPage, TITLE)

  await expect(stateBadge(staffPage)).toHaveText('Udgivet')
  expect(await insideViewport(stateBadge(staffPage))).toBe(true)
  expect(await insideViewport(staffPage.getByRole('status').first())).toBe(true)
  await expect(addressLine(staffPage)).toContainText('låst')

  await asGuest(browser, async (guest) => {
    await guest.setViewportSize(VIEWPORT)
    const response = await guest.goto(`/nyheder/${SLUG}`)
    expect(response?.status()).toBe(200)
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(TITLE)
    expect(await guest.context().cookies()).toEqual([])
    expect(await scrollsSideways(guest)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 11. Editing the published article on the phone — said where the person is
// ---------------------------------------------------------------------------

test('an edit deep in the published article says it is live, in the pinned bar, and is live', async ({ browser }) => {
  await openArticleEditor(staffPage, TITLE)
  await caretToEnd(staffPage)
  await staffPage.keyboard.type(' Rettet efter offentliggørelsen.')

  const live = banner(staffPage).getByText('Gemt — ændringerne er på hjemmesiden')
  await expect(live).toBeVisible({ timeout: 15_000 })
  expect(await insideViewport(live)).toBe(true)
  expect(await insideViewport(stateBadge(staffPage))).toBe(true)
  await expect(stateBadge(staffPage)).toHaveText('Udgivet')
  expect(await focusedKind(staffPage)).toBe('textbox')

  await asGuest(browser, async (guest) => {
    await guest.goto(`/nyheder/${SLUG}`)
    await expect(guest.getByText('Rettet efter offentliggørelsen.')).toBeVisible()
    await expect(guest.locator(`article a[href="${LONG_HREF}"]`)).toHaveText('Afsnit 7')
  })
})

// ---------------------------------------------------------------------------
// 12. Unpublish
// ---------------------------------------------------------------------------

test('the unpublish confirmation names the article, stacks the safe choice first, and takes it down', async ({ browser }) => {
  await staffPage.getByRole('link', { name: 'Fjern fra hjemmesiden' }).click()

  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toContainText(`Fjern “${TITLE}” fra hjemmesiden?`)
  await expect(dialog.getByRole('link', { name: 'Behold den på hjemmesiden' })).toBeFocused()
  await expectStackedChoices(
    dialog,
    dialog.getByRole('link', { name: 'Behold den på hjemmesiden' }),
    dialog.getByRole('button', { name: /^Fjern fra hjemmesiden/ }),
  )
  expect(await violations(staffPage)).toEqual([])

  await staffPage.keyboard.press('Escape')
  await staffPage.waitForURL(/#fjern-nyhed$/)
  await expect(staffPage.getByRole('link', { name: 'Fjern fra hjemmesiden' })).toBeFocused()

  await unpublishArticle(staffPage)
  await expect(stateBadge(staffPage)).toHaveText('Kladde')
  expect(await insideViewport(stateBadge(staffPage))).toBe(true)

  await asGuest(browser, async (guest) => {
    const response = await guest.goto(`/nyheder/${SLUG}`)
    expect(response?.status(), 'the unpublished address answers 404').toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 13. Delete
// ---------------------------------------------------------------------------

test('the delete confirmation fits, ignores a tap beside it, hands focus back, and deletes', async ({ browser }) => {
  await staffPage.getByRole('link', { name: 'Slet', exact: true }).click()

  const dialog = staffPage.getByRole('dialog')
  await expect(dialog).toContainText(`Slet “${TITLE}”?`)
  await expect(dialog).toContainText('kan ikke fortrydes')
  await expect(dialog.getByRole('link', { name: 'Behold nyheden' })).toBeFocused()
  await expectStackedChoices(dialog, dialog.getByRole('link', { name: 'Behold nyheden' }), dialog.getByRole('button', { name: /^Slet nyhed/ }))
  expect(await violations(staffPage)).toEqual([])

  // A tap beside the sheet deletes nothing and closes nothing.
  await staffPage.mouse.click(8, 8)
  await expect(dialog).toBeVisible()

  await staffPage.keyboard.press('Escape')
  await staffPage.waitForURL(/#slet-nyhed$/)
  await expect(staffPage.getByRole('link', { name: 'Slet', exact: true })).toBeFocused()

  await deleteArticle(staffPage)
  await expect(staffPage.getByRole('status').first()).toContainText('Nyheden er slettet')
  await expect(listRow(staffPage, SEEDED_TITLE)).toBeVisible()
  await expect(staffPage.getByText(/Telefon-nyhed 12B/)).toHaveCount(0)

  await asGuest(browser, async (guest) => {
    await guest.goto('/nyheder')
    await expect(guest.getByText(SEEDED_TITLE)).toBeVisible()
    await expect(guest.locator('article')).toHaveCount(3)
  })
})

// ---------------------------------------------------------------------------
// 14–15. The Owner, and the seed restored
// ---------------------------------------------------------------------------

test('the Owner meets the same phone screen (§5)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true })
  const ownerPage = await context.newPage()
  await signIn(ownerPage, OWNER)

  await openNewEditor(ownerPage)
  await expect(banner(ownerPage)).toHaveCSS('position', 'sticky')
  await fillArticle(ownerPage, { title: 'Ejerens telefon-nyhed 12B', text: 'Ejerens tekst.' })
  await saveArticle(ownerPage)
  await expect(stateBadge(ownerPage)).toHaveText('Kladde')
  expect(await insideViewport(stateBadge(ownerPage))).toBe(true)
  expect(await scrollsSideways(ownerPage)).toBe(false)

  await deleteArticle(ownerPage)
  await expect(ownerPage.getByRole('status').first()).toContainText('Nyheden er slettet')
  await context.close()
})

test('the seed is back: the three articles, nothing of this suite, the library empty', async () => {
  await openNewsAdmin(staffPage)
  await expect(listRow(staffPage, SEEDED_TITLE)).toBeVisible()
  await expect(staffPage.getByText(/Telefon-nyhed|Ejerens/)).toHaveCount(0)
  await expect(staffPage.getByRole('list').getByRole('link')).toHaveCount(3)

  // The fixture image leaves through the library's own door.
  await openImagesAdmin(staffPage)
  await deleteImageNamed(staffPage, /mobil-12b\.jpg/)
})
