import { expect, test, type Browser, type Page } from '@playwright/test'

import {
  DRAFT_COOKIE,
  editorForm,
  OWNER,
  publishOnly,
  saveDraft,
  signIn,
  STAFF,
} from './support/admin'

/**
 * Kladde → Forhåndsvis → Offentliggør, in a real browser — technical plan §6, §9.
 *
 * The one promise this phase exists to keep:
 *
 *     **Editing changes nothing a guest can see. Publishing changes it at once.**
 *
 * So every test below is written from a guest's side of that line as much as from the
 * administration's. The field the tests move is the "Sådan laver vi burgere" heading on
 * Om os, which no other spec asserts.
 *
 * The tests run in order and share one signed-in page, because they are one story: a
 * draft has to exist before it can be previewed, and be previewed before it is
 * published. The project is also configured to run after the public suites, so nothing
 * here can change a page while another spec is reading it.
 *
 * The suite is idempotent by construction rather than by luck: `beforeAll` publishes the
 * baseline heading whatever the database currently holds, and the last test publishes it
 * again. A run that is interrupted halfway therefore leaves the next run unaffected, and
 * the database ends where the seed left it.
 */

test.describe.configure({ mode: 'serial' })

/** The heading Om os is seeded with, and the two a draft moves it to. */
const BASELINE_HEADING = 'Sådan laver vi burgere'
const DRAFT_HEADING = 'Kladde — sådan laver vi burgere'
const PUBLISHED_HEADING = 'Sådan laver vi burgere hos Klingenberg'

/** The label of the field that carries it, and the entity's row in the dashboard. */
const METHOD_FIELD = 'Overskrift på metodeafsnit'
const ABOUT_PENDING = 'Om os'
const HOME_PENDING = 'Forsiden'

/**
 * The heading as a guest sees it on Om os. `h2#om-os-metode` is the element the page
 * renders `about.method.heading` into, so this is the published value or nothing.
 */
function methodHeading(page: Page) {
  return page.locator('h2#om-os-metode')
}

/** A visitor: a browser that has never signed in and holds no cookie. */
async function visit(browser: Browser, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(path)

  return { context, page }
}

let staffPage: Page

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)

  // Publish the baseline before anything else, so the suite starts from a known live
  // value however the previous run ended. Saving and publishing the same value it
  // already holds is a no-op for a guest and costs one audit row.
  await staffPage.goto('/admin/indhold')
  await saveDraft(staffPage, 'Om os', { [METHOD_FIELD]: BASELINE_HEADING })
  await publishOnly(staffPage, [ABOUT_PENDING])
})

test.afterAll(async () => {
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// 1–2. Editing writes a draft, and the public site does not move
// ---------------------------------------------------------------------------

test('editing a content field saves a draft rather than changing anything', async () => {
  await staffPage.goto('/admin/indhold')

  await expect(editorForm(staffPage, 'Om os').getByLabel(METHOD_FIELD)).toHaveValue(BASELINE_HEADING)

  await saveDraft(staffPage, 'Om os', { [METHOD_FIELD]: DRAFT_HEADING })

  await expect(staffPage.getByRole('status')).toContainText('Kladden er gemt')
  await expect(staffPage.getByText('Kladde — ikke offentliggjort').first()).toBeVisible()
})

test('the draft appears in the dashboard with who edited it and when', async () => {
  await staffPage.goto('/admin')

  const row = staffPage.getByRole('form', { name: 'Ændringer der venter' }).getByRole('listitem')

  await expect(row.filter({ hasText: ABOUT_PENDING })).toContainText('Kladde')
  await expect(row.filter({ hasText: ABOUT_PENDING })).toContainText('Lokal Medarbejder')
})

test('a guest still sees the published value, not the draft', async ({ browser }) => {
  const { context, page } = await visit(browser, '/om-os')

  await expect(methodHeading(page)).toHaveText(BASELINE_HEADING)
  await expect(page.getByText('Forhåndsvisning')).toHaveCount(0)

  await context.close()
})

// ---------------------------------------------------------------------------
// 3–4. Preview shows the draft, and only to the person previewing
// ---------------------------------------------------------------------------

test('Forhåndsvis opens the real public page with the draft merged in', async () => {
  await staffPage.goto('/api/preview/start?maal=om-os')

  await expect(staffPage).toHaveURL(/\/om-os$/)
  await expect(methodHeading(staffPage)).toHaveText(DRAFT_HEADING)
  await expect(staffPage.getByText('Forhåndsvisning — ikke live endnu')).toBeVisible()
  await expect(staffPage.getByRole('link', { name: 'Afslut forhåndsvisning' })).toBeVisible()

  const cookies = await staffPage.context().cookies()
  expect(cookies.map((cookie) => cookie.name)).toContain(DRAFT_COOKIE)
})

test('an ordinary visitor is unaffected by somebody else previewing', async ({ browser }) => {
  const { context, page } = await visit(browser, '/om-os')

  await expect(methodHeading(page)).toHaveText(BASELINE_HEADING)
  expect(await context.cookies()).toEqual([])

  await context.close()
})

// ---------------------------------------------------------------------------
// 5–6. Publishing, and the public page moving at once
// ---------------------------------------------------------------------------

test('publishing puts the draft live', async () => {
  await staffPage.goto('/admin/indhold')
  await saveDraft(staffPage, 'Om os', { [METHOD_FIELD]: PUBLISHED_HEADING })
  await expect(staffPage.getByRole('status')).toContainText('Kladden er gemt')

  await publishOnly(staffPage, [ABOUT_PENDING])

  await expect(staffPage.getByRole('status').first()).toContainText('offentliggjort')
  await expect(staffPage.getByText(ABOUT_PENDING)).toHaveCount(0)
})

test('the next public request shows the published value immediately', async ({ browser }) => {
  const { context, page } = await visit(browser, '/om-os')

  await expect(methodHeading(page)).toHaveText(PUBLISHED_HEADING)

  await context.close()
})

test('publishing one page does not expire an unrelated one', async ({ browser }) => {
  // The menu carries the `menu`, `weekly` and `monthly` tags; Om os carries
  // `page:about`. Publishing Om os must therefore leave the menu's cached page alone,
  // which Next.js reports in its own cache header.
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('/menu')
  const response = await page.goto('/menu')

  expect(await response?.headerValue('x-nextjs-cache')).toBe('HIT')

  await context.close()
})

// ---------------------------------------------------------------------------
// 7. Leaving preview
// ---------------------------------------------------------------------------

test('exiting the preview returns the staff member to ordinary browsing', async () => {
  await staffPage.goto('/api/preview/start?maal=om-os')
  await staffPage.getByRole('link', { name: 'Afslut forhåndsvisning' }).click()

  await expect(staffPage).toHaveURL(/\/admin$/)

  const cookies = await staffPage.context().cookies()
  expect(cookies.map((cookie) => cookie.name)).not.toContain(DRAFT_COOKIE)

  await staffPage.goto('/admin/indhold')
  await saveDraft(staffPage, 'Om os', { [METHOD_FIELD]: DRAFT_HEADING })

  await staffPage.goto('/om-os')
  await expect(methodHeading(staffPage)).toHaveText(PUBLISHED_HEADING)
  await expect(staffPage.getByText('Forhåndsvisning — ikke live endnu')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 8–9. Preview cannot be started by a visitor, or aimed anywhere else
// ---------------------------------------------------------------------------

test('a visitor cannot enable Draft Mode', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('/api/preview/start?maal=om-os')

  await expect(page).toHaveURL(/\/admin\/login/)
  expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain(DRAFT_COOKIE)

  // And the published site is still what they get.
  await page.goto('/om-os')
  await expect(methodHeading(page)).toHaveText(PUBLISHED_HEADING)

  await context.close()
})

test('a preview cannot be aimed at an address outside this site', async () => {
  // A target key from the closed set, or nothing. Neither an absolute URL nor a
  // protocol-relative one nor a traversal is a key, so all three are refused before
  // Draft Mode is enabled at all (§8).
  const forged = [
    'https:' + '//andet-sted.test',
    '//andet-sted.test',
    '/admin/indhold',
    '../../etc/passwd',
    '',
  ]

  for (const target of forged) {
    await staffPage.goto(`/api/preview/start?maal=${encodeURIComponent(target)}`)

    await expect(staffPage, target).toHaveURL(/\/admin\?fejl=ukendt-forhaandsvisning$/)
    const cookies = await staffPage.context().cookies()
    expect(cookies.map((cookie) => cookie.name), target).not.toContain(DRAFT_COOKIE)
  }
})

// ---------------------------------------------------------------------------
// 10. Staff cannot publish Owner-only content, however the request is made
// ---------------------------------------------------------------------------

test('staff cannot publish the owner-only Forsiden, even by submitting it directly', async ({
  browser,
}) => {
  // The owner leaves a pending change on the Forsiden — a draft heading in the
  // approved editor (1u, phase 11A) — and takes it back at the end, so the live page
  // is identical throughout and this test cannot alter what a guest sees.
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signIn(ownerPage, OWNER)

  await ownerPage.goto('/admin/forsiden')
  const heroForm = ownerPage.getByRole('form', { name: 'Øverst på siden', exact: true })
  const heroHeading = heroForm.getByLabel('Overskrift', { exact: true })
  const liveHeading = await heroHeading.inputValue()
  await heroHeading.fill(`${liveHeading} (kladde)`)
  await heroForm.getByRole('button', { name: 'Gem' }).click()
  await ownerPage.waitForURL(/status=gemt/)

  // Staff sees it, and sees that it is not theirs to publish.
  await staffPage.goto('/admin')
  const form = staffPage.getByRole('form', { name: 'Ændringer der venter' })
  const forsiden = form.getByRole('listitem').filter({ hasText: HOME_PENDING })

  await expect(forsiden).toContainText('Kun ejeren kan offentliggøre dette')
  await expect(forsiden.getByRole('checkbox')).toBeDisabled()

  // Submit the Forsiden and nothing else, so the report is unambiguous.
  for (const checkbox of await form.getByRole('checkbox').all()) {
    if (await checkbox.isDisabled()) continue
    await checkbox.uncheck()
  }

  // The disabled attribute is a courtesy. Re-enable it in the browser, submit anyway,
  // and the server must still refuse — that is the only check that counts (§5, §8).
  await forsiden.getByRole('checkbox').evaluate((checkbox: HTMLInputElement) => {
    checkbox.disabled = false
    checkbox.checked = true
  })
  await form.getByRole('button', { name: 'Offentliggør valgte ændringer' }).click()
  await staffPage.waitForURL(/\/admin\?[a-z_]+=/)

  await expect(staffPage.getByRole('status').first()).toContainText('kræver ejer-adgang')

  // Still pending, and still exactly as the owner left it.
  await expect(
    staffPage.getByRole('form', { name: 'Ændringer der venter' }).getByText(HOME_PENDING),
  ).toBeVisible()

  // The owner takes the change back: saving the section as the hjemmeside already
  // has it removes it from the draft (the §4 delta rule), so nothing is published and
  // the dashboard is left as it was found.
  await ownerPage.goto('/admin/forsiden')
  await ownerPage
    .getByRole('form', { name: 'Øverst på siden', exact: true })
    .getByLabel('Overskrift', { exact: true })
    .fill(liveHeading)
  await ownerPage
    .getByRole('form', { name: 'Øverst på siden', exact: true })
    .getByRole('button', { name: 'Gem' })
    .click()
  await ownerPage.waitForURL(/status=uaendret/)

  await ownerPage.goto('/admin')
  await expect(
    ownerPage.getByRole('form', { name: 'Ændringer der venter' }).getByText(HOME_PENDING),
  ).toHaveCount(0)

  await ownerContext.close()
})

// ---------------------------------------------------------------------------
// 11. Two sessions, one row
// ---------------------------------------------------------------------------

test('a second editor who started from an older version is refused, not overwritten', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signIn(ownerPage, OWNER)

  // Both people open the same editor, so both forms carry the same version.
  await staffPage.goto('/admin/indhold')
  await ownerPage.goto('/admin/indhold')

  // The staff member saves first.
  await saveDraft(staffPage, 'Om os', { [METHOD_FIELD]: 'Medarbejderens rettelse' })
  await expect(staffPage.getByRole('status')).toContainText('Kladden er gemt')

  // The owner submits the form they loaded before that, and is told so.
  await saveDraft(ownerPage, 'Om os', { [METHOD_FIELD]: 'Ejerens rettelse' })
  await expect(ownerPage.getByRole('status')).toContainText('Nogen andre har rettet dette')

  // Nothing of the first person's work was lost.
  await staffPage.goto('/admin/indhold')
  await expect(editorForm(staffPage, 'Om os').getByLabel(METHOD_FIELD)).toHaveValue(
    'Medarbejderens rettelse',
  )

  // Reloading gives the owner the current version, and their save then works.
  await ownerPage.goto('/admin/indhold')
  await saveDraft(ownerPage, 'Om os', { [METHOD_FIELD]: 'Ejerens rettelse' })
  await expect(ownerPage.getByRole('status')).toContainText('Kladden er gemt')

  await ownerContext.close()
})

// ---------------------------------------------------------------------------
// 12. Put the seeded content back, so the suite can be run again
// ---------------------------------------------------------------------------

test('the seeded Om os heading is restored', async () => {
  await staffPage.goto('/admin/indhold')
  await saveDraft(staffPage, 'Om os', { [METHOD_FIELD]: BASELINE_HEADING })
  await publishOnly(staffPage, [ABOUT_PENDING])

  await staffPage.goto('/om-os')
  await expect(methodHeading(staffPage)).toHaveText(BASELINE_HEADING)
})
