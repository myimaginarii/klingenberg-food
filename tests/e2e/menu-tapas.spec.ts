import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'

import { signIn, STAFF } from './support/admin'
import {
  addTapasItem,
  dishForm,
  dishRow,
  editTapasItem,
  moveTapasItem,
  openTapasDish,
  pressTapas,
  publicTapasHeadings,
  publicTapasItems,
  publishMenu,
  removeTapasItem,
  saveDish,
  tapasField,
  tapasGroup,
  tapasHeadingField,
  tapasItems,
  waitForTapasItems,
} from './support/menu-admin'

/**
 * The Tapas lists — technical plan §4 (decision 3), §6; phase 5F.
 *
 * The promise this suite exists for: **a Tapas edit is a draft on an ordinary dish.**
 * Everything else here is in service of proving that an item can be added, edited,
 * removed and moved without a single guest seeing anything change until somebody presses
 * Offentliggør — and that when they do, it is phase 4's publish that runs, not a
 * Tapas-shaped path beside it.
 *
 *     public   Pesto · Hummus · Urtemayo · Estragonmayo · Chilimayo · Aioli
 *     admin    Hummus · Pesto · Urtemayo · Estragonmayo · Chilimayo        (after editing)
 *     preview  Hummus · Pesto · Urtemayo · Estragonmayo · Chilimayo
 *     public   Hummus · Pesto · Urtemayo · Estragonmayo · Chilimayo        (after Offentliggør)
 *
 * It runs in order and shares one signed-in page, because it is one story. The last
 * scenarios put the seeded board back and publish it, so an interrupted run leaves the
 * next one unaffected and the database ends where the seed left it.
 */

test.describe.configure({ mode: 'serial' })

/** The seeded board, exactly as `supabase/seed/confirmed.sql` writes it. */
const SEEDED = {
  base: {
    heading: 'På bordet — altid med',
    items: [
      'Hjemmebagt brød',
      'Rugchips',
      'Grissini',
      'Saltmandler',
      'Syltede rødløg',
      'Syltet peberfrugt',
      'Kryddersmør',
      'Oliven',
      'Frugt',
    ],
  },
  choose7: {
    heading: 'I vælger 7',
    items: [
      'Laksetatar',
      'Stegte tigerrejer',
      'Krondyr-spegepølse med jalapeños',
      'Chorizo',
      'Serranoskinke',
      'Bresaola',
      'Hønsesalat',
      'Krebsehalesalat',
      'Ølpinde',
      'Mini porre/bacon-tærte',
      'Paté med hvidløg',
      'Gouda med brændenælde',
      'Gouda med chili',
      'Brie',
    ],
  },
  dressing: {
    heading: 'Og 3 dressinger',
    items: ['Pesto', 'Hummus', 'Urtemayo', 'Estragonmayo', 'Chilimayo', 'Aioli'],
  },
} as const

/** The four edits this suite makes, and what each list looks like afterwards. */
const ADDED = 'Syltede agurker'
const EDITED_CHOICE = 'Chorizo picante'

const BASE_AFTER = [...SEEDED.base.items, ADDED]
const CHOOSE7_AFTER = SEEDED.choose7.items.map((item) =>
  item === 'Chorizo' ? EDITED_CHOICE : item,
)
/** Aioli removed, then Pesto moved below Hummus. */
const DRESSING_AFTER = ['Hummus', 'Pesto', 'Urtemayo', 'Estragonmayo', 'Chilimayo']

/** A visitor: a browser that has never signed in and holds no cookie. */
async function visit(browser: Browser, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(path)

  return { context, page }
}

/** What a guest currently reads on the tapas board. */
async function guestBoard(browser: Browser) {
  const { context, page } = await visit(browser, '/menu')

  const board = {
    headings: await publicTapasHeadings(page),
    base: await publicTapasItems(page, 'base'),
    choose7: await publicTapasItems(page, 'choose7'),
    dressing: await publicTapasItems(page, 'dressing'),
  }

  await context.close()

  return board
}

let staffPage: Page

test.beforeAll(async ({ browser }) => {
  // An explicit context, as in the deletion and reorder suites: `@axe-core/playwright`
  // refuses a page that was opened straight from the browser.
  const context = await browser.newContext()
  staffPage = await context.newPage()
  await signIn(staffPage, STAFF)
})

test.afterAll(async () => {
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// The editor itself
// ---------------------------------------------------------------------------

test('the Tapas dish opens with the three fixed lists, and the seeded content', async () => {
  await openTapasDish(staffPage)

  // The ordinary dish fields from phase 5B are still there, unchanged.
  await expect(dishForm(staffPage).getByLabel('Navn', { exact: true })).toHaveValue('Tapas')
  await expect(dishForm(staffPage).getByLabel('Pris (kr.)', { exact: true })).toHaveValue('295')

  await expect(staffPage.getByRole('heading', { name: 'Tapas-indhold' })).toBeVisible()

  for (const [group, seeded] of [
    ['Fast indhold', SEEDED.base],
    ['Vælg 7', SEEDED.choose7],
    ['Vælg 3 dressinger', SEEDED.dressing],
  ] as const) {
    await expect(tapasHeadingField(staffPage, group)).toHaveValue(seeded.heading)
    expect(await tapasItems(staffPage, group)).toEqual([...seeded.items])
  }
})

test('the lists appear on the Tapas dish and on no other', async () => {
  await staffPage.goto('/admin/menu?sektion=burgere')
  await staffPage
    .getByRole('list', { name: /^Retter i / })
    .getByRole('link', { name: /^Odin/ })
    .click()
  await expect(dishForm(staffPage)).toBeVisible()

  await expect(staffPage.getByRole('heading', { name: 'Tapas-indhold' })).toHaveCount(0)
  await expect(staffPage.getByRole('form', { name: /^Tapas — / })).toHaveCount(0)
})

test('mode, choose and the group ids are nowhere on the screen as fields', async () => {
  await openTapasDish(staffPage)

  // The structure is stated in the headings, and is not editable anywhere.
  for (const label of ['Fast indhold', 'Vælg 7', 'Vælg 3 dressinger'] as const) {
    await expect(staffPage.getByRole('heading', { name: label, exact: true })).toBeVisible()
  }

  const names = await staffPage
    .locator('#tapas-indhold input, #tapas-indhold select, #tapas-indhold textarea')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('name')))

  expect(new Set(names)).toEqual(
    new Set([
      'tapas_ret',
      'tapas_version',
      'tapas_gruppe',
      'tapas_sektion',
      'tapas_overskrift',
      'tapas_punkt',
      'tapas_nyt',
    ]),
  )
})

// ---------------------------------------------------------------------------
// Add, edit, remove, reorder — each an ordinary draft change
// ---------------------------------------------------------------------------

test('Tilføj punkt adds an item to Fast indhold', async () => {
  await openTapasDish(staffPage)
  await addTapasItem(staffPage, 'Fast indhold', ADDED)

  await waitForTapasItems(staffPage, 'Fast indhold', BASE_AFTER)
  await expect(staffPage.getByRole('status').first()).toContainText(
    'Hjemmesiden viser stadig den gamle liste',
  )
})

test('one Vælg 7 option is edited, and the other thirteen are left alone', async () => {
  await editTapasItem(staffPage, 'Vælg 7', 4, EDITED_CHOICE)

  await waitForTapasItems(staffPage, 'Vælg 7', CHOOSE7_AFTER)
})

test('Fjern removes a dressing, as a draft — no confirmation and no Fortryd', async () => {
  // Removal is not one of the two immediate paths (§6), so there is nothing live to
  // undo and nothing to confirm: it is a draft like every other edit here.
  await removeTapasItem(staffPage, 'Vælg 3 dressinger', 6)

  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', [
    'Pesto',
    'Hummus',
    'Urtemayo',
    'Estragonmayo',
    'Chilimayo',
  ])

  await expect(
    staffPage.getByRole('button', { name: /^Fortryd/ }),
  ).toHaveCount(0)
})

test('Flyt ned moves a dressing without losing or duplicating anything', async () => {
  await moveTapasItem(staffPage, 'Vælg 3 dressinger', 1, 'ned')

  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', DRESSING_AFTER)
})

test('a move can be made with the keyboard alone', async () => {
  // Tab out of the item's own field: the next thing in the tab order is that item's
  // Flyt op, which is what makes the list reorderable without a pointer at all.
  await tapasField(staffPage, 'Vælg 3 dressinger', 'Punkt 2').focus()
  await staffPage.keyboard.press('Tab')

  const button = tapasGroup(staffPage, 'Vælg 3 dressinger').getByRole('button', {
    name: 'Flyt op Vælg 3 dressinger punkt 2',
    exact: true,
  })

  await expect(button).toBeFocused()

  // The ring the design promises (1aa), on the control the keyboard is actually on.
  const ring = await button.evaluate((node) => {
    const style = window.getComputedStyle(node)
    return { visible: node.matches(':focus-visible'), width: style.outlineWidth }
  })
  expect(ring.visible).toBe(true)
  expect(Number.parseFloat(ring.width)).toBeGreaterThanOrEqual(3)

  await staffPage.keyboard.press('Enter')
  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', [
    'Pesto',
    'Hummus',
    'Urtemayo',
    'Estragonmayo',
    'Chilimayo',
  ])

  // …and back, so the story continues from where it was.
  await moveTapasItem(staffPage, 'Vælg 3 dressinger', 1, 'ned')
  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', DRESSING_AFTER)
})

test('the list can be reordered with JavaScript switched off', async ({ browser }) => {
  // The whole editor is ordinary forms, so this is a proof rather than a hope: with no
  // scripting at all, Flyt op / Flyt ned still move an item, because they are submit
  // buttons and nothing else. The phase brief asks for exactly this fallback.
  //
  // The session is carried over from the signed-in context rather than signed in again:
  // what is being proved here is the *editor's* fallback, and logging in without
  // scripting is a different promise belonging to a different screen.
  const context = await browser.newContext({
    javaScriptEnabled: false,
    // Reduced motion, for the reason `playwright.config.ts` gives the public no-JS run:
    // the administration's smooth scrolling turns a fragment navigation into a moving
    // target, and a control that is still gliding is a control nothing can click.
    reducedMotion: 'reduce',
    storageState: await staffPage.context().storageState(),
  })
  const page = await context.newPage()

  try {
    await openTapasDish(page)

    expect(await tapasItems(page, 'Vælg 3 dressinger')).toEqual(DRESSING_AFTER)

    await tapasGroup(page, 'Vælg 3 dressinger')
      .getByRole('button', { name: 'Flyt ned Vælg 3 dressinger punkt 1', exact: true })
      .click()

    const moved = [...DRESSING_AFTER]
    moved.splice(1, 0, ...moved.splice(0, 1))
    await waitForTapasItems(page, 'Vælg 3 dressinger', moved)

    // …and back, so the story continues from where it was.
    await tapasGroup(page, 'Vælg 3 dressinger')
      .getByRole('button', { name: 'Flyt op Vælg 3 dressinger punkt 2', exact: true })
      .click()
    await waitForTapasItems(page, 'Vælg 3 dressinger', DRESSING_AFTER)
  } finally {
    await context.close()
  }
})

// ---------------------------------------------------------------------------
// Kladde, preview, publish
// ---------------------------------------------------------------------------

test('the dish says a new list is waiting, in the Kladde tone', async () => {
  await staffPage.goto('/admin/menu?sektion=tapas')

  await expect(dishRow(staffPage, 'Tapas')).toContainText('Kladde')
  await expect(dishRow(staffPage, 'Tapas')).toContainText('Ny liste afventer offentliggørelse')
})

test('the Tapas dish is listed as a pending change on the dashboard', async () => {
  await staffPage.goto('/admin')

  await expect(
    staffPage
      .getByRole('form', { name: 'Ændringer der venter' })
      .getByRole('checkbox', { name: /Tapas/ }),
  ).toHaveCount(1)
})

test('the public menu still shows the old lists — a Tapas edit publishes nothing', async ({
  browser,
}) => {
  const board = await guestBoard(browser)

  expect(board.base).toEqual([...SEEDED.base.items])
  expect(board.choose7).toEqual([...SEEDED.choose7.items])
  expect(board.dressing).toEqual([...SEEDED.dressing.items])
})

test('Forhåndsvis shows the edited lists before anybody has published them', async () => {
  await staffPage.goto('/api/preview/start?maal=menu')
  await expect(staffPage).toHaveURL(/\/menu$/)
  await expect(staffPage.getByText('Forhåndsvisning — ikke live')).toBeVisible()

  expect(await publicTapasItems(staffPage, 'base')).toEqual(BASE_AFTER)
  expect(await publicTapasItems(staffPage, 'choose7')).toEqual(CHOOSE7_AFTER)
  expect(await publicTapasItems(staffPage, 'dressing')).toEqual(DRESSING_AFTER)

  await staffPage.goto('/api/preview/stop')
})

test('Offentliggør puts the new lists live, through phase 4 and nothing else', async ({
  browser,
}) => {
  await publishMenu(staffPage)
  await expect(staffPage.getByRole('status').first()).toContainText(
    'Menuen er opdateret på hjemmesiden',
  )

  const board = await guestBoard(browser)

  expect(board.base).toEqual(BASE_AFTER)
  expect(board.choose7).toEqual(CHOOSE7_AFTER)
  expect(board.dressing).toEqual(DRESSING_AFTER)

  // Published means nothing is pending any more.
  await staffPage.goto('/admin/menu?sektion=tapas')
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// The headings are content too (§9 of the phase brief)
// ---------------------------------------------------------------------------

test('a heading is editable, and changing it changes nothing structural', async ({
  browser,
}) => {
  await openTapasDish(staffPage)
  await tapasHeadingField(staffPage, 'Vælg 3 dressinger').fill('Og 3 dressinger til bordet')
  await pressTapas(staffPage, 'Vælg 3 dressinger', 'Gem liste — Vælg 3 dressinger')

  await expect
    .poll(async () => tapasHeadingField(staffPage, 'Vælg 3 dressinger').inputValue())
    .toBe('Og 3 dressinger til bordet')

  // The administration still calls the group by its structural name…
  await expect(
    staffPage.getByRole('heading', { name: 'Vælg 3 dressinger', exact: true }),
  ).toBeVisible()
  // …and the items are exactly where they were.
  expect(await tapasItems(staffPage, 'Vælg 3 dressinger')).toEqual(DRESSING_AFTER)

  await publishMenu(staffPage)
  expect((await guestBoard(browser)).headings).toContain('Og 3 dressinger til bordet')

  // Put the heading back.
  await openTapasDish(staffPage)
  await tapasHeadingField(staffPage, 'Vælg 3 dressinger').fill(SEEDED.dressing.heading)
  await pressTapas(staffPage, 'Vælg 3 dressinger', 'Gem liste — Vælg 3 dressinger')
  await expect
    .poll(async () => tapasHeadingField(staffPage, 'Vælg 3 dressinger').inputValue())
    .toBe(SEEDED.dressing.heading)
  await publishMenu(staffPage)
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('a duplicate is refused, case-insensitively, beneath the item that earned it', async () => {
  await openTapasDish(staffPage)
  await addTapasItem(staffPage, 'Vælg 3 dressinger', 'HUMMUS')

  const group = tapasGroup(staffPage, 'Vælg 3 dressinger')
  await expect(group.getByText('Punktet står allerede på listen.')).toBeVisible()

  // The message belongs to the field, not to a summary somewhere else on the screen.
  const field = tapasField(staffPage, 'Vælg 3 dressinger', `Punkt ${DRESSING_AFTER.length + 1}`)
  await expect(field).toHaveValue('HUMMUS')
  await expect(field).toHaveAttribute('aria-invalid', 'true')

  // Nothing was stored: the list is what it was.
  await staffPage.goto('/admin/menu?sektion=tapas')
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('a blank item is refused rather than quietly dropped', async () => {
  await openTapasDish(staffPage)
  await editTapasItem(staffPage, 'Vælg 3 dressinger', 2, '   ')

  const group = tapasGroup(staffPage, 'Vælg 3 dressinger')
  await expect(
    group.getByText('Punktet må ikke være tomt. Skriv en tekst, eller fjern punktet.'),
  ).toBeVisible()

  // The item is still on the screen, at the position the message points at.
  expect(await tapasItems(staffPage, 'Vælg 3 dressinger')).toHaveLength(DRESSING_AFTER.length)

  await staffPage.goto('/admin/menu?sektion=tapas')
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('a blank heading is refused', async () => {
  await openTapasDish(staffPage)
  await tapasHeadingField(staffPage, 'Fast indhold').fill('  ')
  await pressTapas(staffPage, 'Fast indhold', 'Gem liste — Fast indhold')

  await expect(
    tapasGroup(staffPage, 'Fast indhold').getByText('Overskriften må ikke være tom.'),
  ).toBeVisible()

  await staffPage.goto('/admin/menu?sektion=tapas')
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('Tilføj punkt with an empty field says so, and adds nothing', async () => {
  await openTapasDish(staffPage)
  await pressTapas(staffPage, 'Vælg 7', '+ Tilføj punkt til Vælg 7')

  await expect(
    tapasGroup(staffPage, 'Vælg 7').getByText('Skriv teksten til det nye punkt.'),
  ).toBeVisible()

  expect(await tapasItems(staffPage, 'Vælg 7')).toEqual(CHOOSE7_AFTER)
})

// ---------------------------------------------------------------------------
// Draft integrity — the property this phase most easily breaks (§4, §6)
// ---------------------------------------------------------------------------

test('a pending price survives a Tapas edit, and a pending list survives a dish edit', async () => {
  // 1. A price change, waiting.
  await openTapasDish(staffPage)
  await saveDish(staffPage, { 'Pris (kr.)': '305' })

  // 2. A Tapas edit on the same dish.
  await openTapasDish(staffPage)
  await addTapasItem(staffPage, 'Vælg 3 dressinger', 'Rævesauce')
  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', [...DRESSING_AFTER, 'Rævesauce'])

  // The price change is still there.
  await expect(dishForm(staffPage).getByLabel('Pris (kr.)', { exact: true })).toHaveValue('305')

  // 3. And the other way round: an ordinary dish edit leaves the Tapas draft alone.
  //
  // The dish is reopened first, so the panel's Gem is pressed from an address that does
  // not already carry a `status` — `saveDish` waits for one, and would otherwise resolve
  // instantly against the Tapas save's own report.
  await openTapasDish(staffPage)
  await saveDish(staffPage, { Beskrivelse: 'Til hele bordet.' })
  await openTapasDish(staffPage)

  expect(await tapasItems(staffPage, 'Vælg 3 dressinger')).toEqual([
    ...DRESSING_AFTER,
    'Rævesauce',
  ])
  await expect(dishForm(staffPage).getByLabel('Pris (kr.)', { exact: true })).toHaveValue('305')

  // The row says all three are waiting.
  await staffPage.goto('/admin/menu?sektion=tapas')
  await expect(dishRow(staffPage, 'Tapas')).toContainText('Kladde')

  // 4. Put every one of them back, and check the draft disappears entirely.
  await openTapasDish(staffPage)
  await removeTapasItem(staffPage, 'Vælg 3 dressinger', DRESSING_AFTER.length + 1)
  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', DRESSING_AFTER)

  await openTapasDish(staffPage)
  await saveDish(staffPage, { 'Pris (kr.)': '295', Beskrivelse: '' })

  await staffPage.goto('/admin/menu?sektion=tapas')
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

test('an edit that ends where it started leaves no pending change at all', async () => {
  await openTapasDish(staffPage)
  await moveTapasItem(staffPage, 'Vælg 3 dressinger', 1, 'ned')
  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', [
    'Pesto',
    'Hummus',
    'Urtemayo',
    'Estragonmayo',
    'Chilimayo',
  ])
  // Checked from the list rather than from the panel, because at 375 px the editor *is*
  // the screen and the list steps aside (1y) — the badge is on the row, and the row is
  // not on screen while somebody is editing.
  await staffPage.goto('/admin/menu?sektion=tapas')
  await expect(dishRow(staffPage, 'Tapas')).toContainText('Kladde')

  await openTapasDish(staffPage)
  await moveTapasItem(staffPage, 'Vælg 3 dressinger', 2, 'op')
  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', DRESSING_AFTER)

  await staffPage.goto('/admin/menu?sektion=tapas')
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

test('the Tapas editor has no accessibility violations', async () => {
  await openTapasDish(staffPage)

  const results = await new AxeBuilder({ page: staffPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([])
})

test('the refusal state has no accessibility violations either', async () => {
  await openTapasDish(staffPage)
  await addTapasItem(staffPage, 'Vælg 7', 'brie')

  await expect(
    tapasGroup(staffPage, 'Vælg 7').getByText('Punktet står allerede på listen.'),
  ).toBeVisible()

  const results = await new AxeBuilder({ page: staffPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(results.violations.map((violation) => violation.id)).toEqual([])
})

test('every control a person presses is at least 44 px, at this width', async () => {
  await openTapasDish(staffPage)

  const small = await staffPage
    .locator('#tapas-indhold button')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const box = node.getBoundingClientRect()
          return { name: node.textContent?.trim().slice(0, 24), h: box.height, w: box.width }
        })
        .filter((box) => box.h < 44 || box.w < 44),
    )

  expect(small).toEqual([])
})

test('the editor does not make the screen scroll sideways', async () => {
  await openTapasDish(staffPage)

  const overflow = await staffPage.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
  }))

  expect(overflow.body).toBeLessThanOrEqual(overflow.client)
})

// ---------------------------------------------------------------------------
// Leaving the seed as it was found
// ---------------------------------------------------------------------------

test('the board is back to its seeded content, live, with nothing pending', async ({
  browser,
}) => {
  await openTapasDish(staffPage)

  // Undo the four edits, in the order they were made.
  await removeTapasItem(staffPage, 'Fast indhold', BASE_AFTER.length)
  await waitForTapasItems(staffPage, 'Fast indhold', SEEDED.base.items)

  await editTapasItem(staffPage, 'Vælg 7', 4, 'Chorizo')
  await waitForTapasItems(staffPage, 'Vælg 7', SEEDED.choose7.items)

  await moveTapasItem(staffPage, 'Vælg 3 dressinger', 2, 'op')
  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', [
    'Pesto',
    'Hummus',
    'Urtemayo',
    'Estragonmayo',
    'Chilimayo',
  ])

  await addTapasItem(staffPage, 'Vælg 3 dressinger', 'Aioli')
  await waitForTapasItems(staffPage, 'Vælg 3 dressinger', SEEDED.dressing.items)

  await publishMenu(staffPage)

  const board = await guestBoard(browser)
  expect(board.base).toEqual([...SEEDED.base.items])
  expect(board.choose7).toEqual([...SEEDED.choose7.items])
  expect(board.dressing).toEqual([...SEEDED.dressing.items])
  expect(board.headings).toEqual([
    SEEDED.base.heading,
    SEEDED.choose7.heading,
    SEEDED.dressing.heading,
  ])

  await staffPage.goto('/admin/menu?sektion=tapas')
  await expect(staffPage.getByText('Kladde', { exact: true })).toHaveCount(0)

  await staffPage.goto('/admin')
  await expect(staffPage.getByRole('form', { name: 'Ændringer der venter' })).toHaveCount(0)
})
