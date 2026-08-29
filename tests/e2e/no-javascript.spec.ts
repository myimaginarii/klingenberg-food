import { expect, test } from '@playwright/test'

import { ADDRESS_LINE, PRIMARY_TEL_HREF, PUBLIC_ROUTES } from './support/site'

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

  await expect(page).toHaveURL(/\/om-os$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vores historie')
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

test('the menu is one scroll of nine sections, and its chips still jump', async ({ page }) => {
  await page.goto('/menu')

  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(9)
  await expect(page.getByText('89 kr.').first()).toBeVisible()

  const chip = page
    .getByRole('navigation', { name: 'Menuens kategorier' })
    .getByRole('link', { name: 'Børn', exact: true })
  await chip.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await chip.click()

  await expect(page).toHaveURL(/#menu-boern$/)
  await expect(page.locator('#menu-boern h2')).toBeInViewport()
})

test('the opening hours are readable, and the seven-day view still opens', async ({ page }) => {
  await page.goto('/find-os')

  await expect(page.getByRole('main').getByText('Ons–fre').first()).toBeVisible()

  // The persistent bar is fixed to the bottom of the viewport, so a control scrolled to
  // the very bottom would sit under it. Centring it is what a person scrolling does too.
  const toggle = page.getByText('Vis alle syv dage')
  await toggle.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await toggle.click()

  await expect(page.getByRole('main').getByText('Onsdag', { exact: false }).first()).toBeVisible()
})

test('the map is still a link to directions', async ({ page }) => {
  await page.goto('/find-os')

  const mapLink = page.getByRole('main').locator('a[href*="google.com/maps/dir"]:has(img)')
  await expect(mapLink).toBeVisible()
  expect(decodeURIComponent((await mapLink.getAttribute('href')) ?? '')).toContain(ADDRESS_LINE)
})

test('the open/closed badge degrades to the server-rendered value, not to nothing', async ({
  page,
}) => {
  await page.goto('/find-os')

  await expect(page.getByRole('main').getByText(/^(Åbent nu|Lukket)/).first()).toBeVisible()
})

test('a news article is readable without scripting', async ({ page }) => {
  await page.goto('/nyheder')
  await page.getByRole('link', { name: /Læs mere/ }).first().click()

  await expect(page).toHaveURL(/\/nyheder\/[a-z0-9-]+$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Overskrift placeholder')
})

test('still no cookie is set with scripting disabled', async ({ page, context }) => {
  for (const route of PUBLIC_ROUTES) {
    await page.goto(route.path)
  }

  expect(await context.cookies()).toEqual([])
})
