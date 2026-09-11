import { expect, test } from '@playwright/test'

import { loadNews } from '@/lib/content/load/news'
import { formatPrice } from '@/lib/format/danish'
import { formatWeeklyHours } from '@/lib/hours/format'
import {
  EVERY_DISH,
  MENU_CATEGORIES,
  PRIMARY_TEL_HREF,
  PUBLIC_ROUTES,
  SCHEDULE,
} from './support/site'

/** Whatever the restaurant has published, as the list page reads it. */
const NEWS = loadNews()

/**
 * The public site with JavaScript switched off — technical plan §7e, item 11.
 *
 * "Den offentlige side skal fungere fuldt ud uden JavaScript: telefonlinks, menu,
 * åbningstider, navigation, kortlinket, nyheder." Three things are allowed to degrade,
 * and each to a server-rendered value at most five minutes old: the open/closed badge,
 * the announcement bar (phase 7) and — in most implementations — the fullscreen mobile
 * menu.
 *
 * The mobile menu here is a `<details>` element, so it does not degrade at all: opening
 * and closing it is the browser's own behaviour, and these tests prove it by driving it
 * with scripting disabled.
 *
 * This project runs at 375 px, which is the width where the least is available without
 * scripting: no desktop navigation bar, and the fullscreen menu carrying four of the six
 * routes.
 */

test('every page renders its content without scripting', async ({ page }) => {
  for (const route of PUBLIC_ROUTES) {
    const response = await page.goto(route.path)

    expect(response?.status(), `${route.path} did not respond`).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading)
  }
})

test('the fullscreen menu opens and closes without scripting', async ({ page }) => {
  await page.goto('/')

  const disclosure = page.locator('details.site-menu')
  const summary = disclosure.locator('summary')

  await expect(disclosure).not.toHaveAttribute('open', '')

  await summary.click()
  await expect(disclosure).toHaveAttribute('open', '')

  // The same control closes it again — it is the hamburger, then the ×.
  await summary.click()
  await expect(disclosure).not.toHaveAttribute('open', '')
})

test('the fullscreen menu reaches every page without scripting', async ({ page }) => {
  await page.goto('/')

  await page.locator('details.site-menu summary').click()

  const panel = page.getByRole('navigation', { name: 'Alle sider' })
  for (const route of PUBLIC_ROUTES) {
    await expect(panel.getByRole('link', { name: route.navLabel, exact: true })).toHaveAttribute(
      'href',
      route.path,
    )
  }

  await panel.getByRole('link', { name: 'Om os', exact: true }).click()

  await expect(page).toHaveURL(/\/om-os\/$/)
  // Without scripting a link is a fresh document, so the panel cannot survive the
  // navigation. Stated rather than assumed: it is the same promise the scripted site
  // keeps by closing the panel itself.
  await expect(page.locator('details.site-menu')).not.toHaveAttribute('open', '')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    PUBLIC_ROUTES.find((route) => route.navLabel === 'Om os')!.heading,
  )
})

test('the persistent bar still calls, routes and points the way', async ({ page }) => {
  await page.goto('/')

  const bar = page.getByRole('navigation', { name: 'Genveje' })
  await expect(bar.getByRole('link', { name: 'Bestil' })).toHaveAttribute('href', PRIMARY_TEL_HREF)
  await expect(bar.getByRole('link', { name: 'Vis vej' })).toHaveAttribute(
    'href',
    /google\.com\/maps\/dir/,
  )
})

test('the menu is one scroll of every section, and its chips still jump', async ({ page }) => {
  await page.goto('/menu')

  // How many sections there are and what they are called is the restaurant's; that the
  // whole card is one scroll, with a chip per section, is the design's.
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(MENU_CATEGORIES.length)

  const priced = EVERY_DISH.find((dish) => dish.priceOre !== null)
  if (priced !== undefined) {
    await expect(page.getByText(formatPrice(priced.priceOre!)).first()).toBeVisible()
  }

  // The last chip, so the jump has somewhere to go from the top of the page.
  const target = MENU_CATEGORIES[MENU_CATEGORIES.length - 1]!
  const chip = page
    .getByRole('navigation', { name: 'Menuens kategorier' })
    .getByRole('link', { name: target.name, exact: true })
  await chip.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await chip.click()

  await expect(page).toHaveURL(new RegExp(`#${target.anchor}$`))
  await expect(page.locator(`#${target.anchor} h2`)).toBeInViewport()
})

test('the opening hours are readable, and the seven-day view still opens', async ({ page }) => {
  await page.goto('/find-os')

  // The grouped line the document's own week produces, rather than the one today's
  // schedule happens to make: "Ons-fre" is a value of `content/site/hours.json`.
  const grouped = formatWeeklyHours(SCHEDULE)[0]
  if (grouped !== undefined) {
    await expect(page.getByRole('main').getByText(grouped.days, { exact: true }).first()).toBeVisible()
  }

  // The persistent bar is fixed to the bottom of the viewport, so a control scrolled to
  // the very bottom would sit under it. Centring it is what a person scrolling does too.
  const toggle = page.getByText('Vis alle syv dage')
  await toggle.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await toggle.click()

  await expect(page.getByRole('main').getByText('Onsdag', { exact: false }).first()).toBeVisible()
})

test('the map embed and the call action both render without scripting', async ({ page }) => {
  await page.goto('/find-os')

  const main = page.getByRole('main')
  const frame = main.locator('iframe[title^="Kort over"]')
  await expect(frame).toBeVisible()
  expect(await frame.getAttribute('src')).toContain('https://www.google.com/maps/embed?pb=')

  // The one call action on the page is a plain `tel:` anchor inside the Telefon block.
  const ring = main.getByRole('link', { name: /^Ring \+45/ })
  await expect(ring).toHaveAttribute('href', /^tel:\+45/)
})

test('the open/closed badge degrades to a neutral label, never to a stale claim', async ({
  page,
}) => {
  await page.goto('/find-os')

  // The site is a static export. "Åbent nu" in prerendered HTML would be an answer to
  // "was the restaurant open when this site was built" — a claim the page cannot
  // support and one that would be wrong most of the time. Without scripting the badge
  // therefore names its subject and asserts nothing about now.
  // Every badge on the page, including the fullscreen menu's own copy, which is in
  // the document but not on screen until the panel is opened.
  const badges = page.locator('[data-open-status]')
  await expect(page.getByRole('main').locator('[data-open-status]').first()).toBeVisible()

  for (const state of await badges.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-open-status')),
  )) {
    expect(state).toBe('undecided')
  }

  await expect(page.getByRole('main').getByText('Åbningstider', { exact: true }).first()).toBeVisible()
})

test('the hours table marks no day as today, and still gives the whole week', async ({ page }) => {
  await page.goto('/find-os')

  const main = page.getByRole('main')

  // Same reason: a weekday read at build time would mark the same row forever.
  await expect(main.locator('dt', { hasText: '· i dag' })).toHaveCount(0)

  // The schedule itself is entirely there — the grouped lines on the phone, and the
  // seven days behind a <details> that needs no scripting to open.
  for (const row of formatWeeklyHours(SCHEDULE)) {
    await expect(main.getByText(row.days, { exact: true }).first()).toBeVisible()
  }
  await expect(main.getByText('Vis alle syv dage')).toBeVisible()
})

test('the news page lists what is published without scripting, and invents no article', async ({
  page,
}) => {
  await page.goto('/nyheder')

  const main = page.getByRole('main')

  // Publishing an article is the most ordinary thing the restaurant does, so the empty
  // state is asserted only when the tree is empty; the other half — never an article
  // that is not a published file — is the claim that holds either way.
  if (NEWS.length === 0) {
    await expect(main.getByText('Der er ingen nyheder lige nu.')).toBeVisible()
    await expect(page.getByRole('link', { name: /Læs mere/ })).toHaveCount(0)
    return
  }

  await expect(main.getByText('Der er ingen nyheder lige nu.')).toHaveCount(0)
  for (const article of NEWS) {
    await expect(main.getByRole('link', { name: article.title, exact: false }).first()).toBeVisible()
  }
})

test('still no cookie is set with scripting disabled', async ({ page, context }) => {
  for (const route of PUBLIC_ROUTES) {
    await page.goto(route.path)
  }

  expect(await context.cookies()).toEqual([])
})
