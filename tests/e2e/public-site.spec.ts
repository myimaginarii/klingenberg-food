import { expect, test } from '@playwright/test'

import { formatDailyHours, formatWeeklyHoursLines } from '@/lib/hours/format'
import { CONFIRMED_SCHEDULE } from '../unit/fixtures/hours'
import {
  ADDRESS_LINE,
  MENU_CATEGORIES,
  PRIMARY_PHONE,
  PRIMARY_TEL_HREF,
  PUBLIC_ROUTES,
  SECONDARY_TEL_HREF,
} from './support/site'
import { waitForPublicShell } from './support/public-shell'

/**
 * The public site, in a real browser — technical plan §9.
 *
 * These are the paths where a bug would be visible to a guest standing in the hall with
 * a phone: can they reach every page, can they call, can they find the place, and do the
 * hours on the page agree with the engine that computes them.
 */

test.describe('every public route is reachable', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} responds and renders its heading`, async ({ page }) => {
      const response = await page.goto(route.path)

      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading)
    })
  }

  test('an unknown address renders the designed 404 rather than a framework page', async ({
    page,
  }) => {
    const response = await page.goto('/denne-side-findes-ikke')

    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vi kunne ikke finde siden')
  })
})

test.describe('navigation', () => {
  test('every main navigation item leads to its page', async ({ page, viewport }) => {
    const wide = (viewport?.width ?? 0) >= 1024

    for (const route of PUBLIC_ROUTES) {
      await page.goto('/')

      if (wide) {
        await page.getByRole('navigation', { name: 'Hovedmenu' }).getByRole('link', { name: route.navLabel, exact: true }).click()
      } else {
        await page.getByRole('group').first().locator('summary').click()
        await page
          .getByRole('navigation', { name: 'Alle sider' })
          .getByRole('link', { name: route.navLabel, exact: true })
          .click()
      }

      await expect(page).toHaveURL(new RegExp(`${route.path === '/' ? '/$' : route.path}`))
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading)
    }
  })

  test('the current page is marked for assistive technology, not by colour alone', async ({
    page,
    viewport,
  }) => {
    test.skip((viewport?.width ?? 0) < 1024, 'the desktop bar is hidden below 1024 px')

    await page.goto('/menu')

    const nav = page.getByRole('navigation', { name: 'Hovedmenu' })
    await expect(nav.getByRole('link', { name: 'Menu', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(nav.getByRole('link', { name: 'Find os', exact: true })).not.toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('the footer links to every page except the one it sits under', async ({ page }) => {
    await page.goto('/')

    const footer = page.getByRole('navigation', { name: 'Sider i bunden' })
    for (const route of PUBLIC_ROUTES.filter((entry) => entry.path !== '/')) {
      await expect(footer.getByRole('link', { name: route.navLabel, exact: true })).toHaveAttribute(
        'href',
        route.path,
      )
    }
  })
})

test.describe('ordering is by telephone', () => {
  test('every phone link dials a real number, and the primary one leads', async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path)

      // Every phone link in the document, including the one inside the fullscreen
      // mobile menu, which is display:none at desktop widths but still markup we ship.
      const telLinks = page.locator('a[href^="tel:"]')

      const hrefs = await telLinks.evaluateAll((links) =>
        links.map((link) => link.getAttribute('href')),
      )

      expect(hrefs.length, `${route.path} has no phone link`).toBeGreaterThan(0)
      expect(
        hrefs.every((href) => href === PRIMARY_TEL_HREF || href === SECONDARY_TEL_HREF),
        `${route.path} links a number that is not one of the two confirmed ones: ${hrefs.join(', ')}`,
      ).toBe(true)
      expect(hrefs, `${route.path} never offers the primary number`).toContain(PRIMARY_TEL_HREF)
    }
  })

  test('the persistent mobile bar calls the primary number from "Bestil"', async ({
    page,
    viewport,
  }) => {
    test.skip((viewport?.width ?? 0) >= 768, 'the bottom bar is a phone-only control')

    await page.goto('/')

    const bar = page.getByRole('navigation', { name: 'Genveje' })
    await expect(bar.getByRole('link', { name: 'Bestil' })).toHaveAttribute(
      'href',
      PRIMARY_TEL_HREF,
    )
    await expect(bar.getByRole('link', { name: 'Menu' })).toHaveAttribute('href', '/menu')
    await expect(bar.getByRole('link', { name: 'Tider' })).toHaveAttribute(
      'href',
      '/find-os#aabningstider',
    )
  })

  test('there is no reservation form or online ordering anywhere', async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path)
      await expect(page.locator('form')).toHaveCount(0)
      await expect(page.locator('input, textarea, select')).toHaveCount(0)
    }
  })
})

test.describe('opening hours come from the phase 2 engine', () => {
  test('Find os prints exactly the rows the formatter produces', async ({ page }) => {
    await page.goto('/find-os')
    // The `count()` below answers immediately — the streamed shell has to be in the
    // document first, or the disclosure reads as absent on a page that carries it.
    await waitForPublicShell(page)

    const expected = formatDailyHours(CONFIRMED_SCHEDULE)

    // On a phone the seven days sit behind the "Vis alle syv dage" disclosure (1l);
    // on a wide screen they are simply shown. Open it when it is there.
    const disclosure = page.locator('#aabningstider details')
    if (await disclosure.count()) {
      await disclosure.evaluate((element: HTMLDetailsElement) => {
        element.open = true
      })
    }

    const table = page.locator('#aabningstider dl:visible').last()
    const days = await table.locator('dt').allInnerTexts()
    const hours = await table.locator('dd').allInnerTexts()

    expect(hours).toEqual(expected.map((row) => row.hours))
    expect(days.map((day) => day.split(' ·')[0])).toEqual(expected.map((row) => row.day))
  })

  test('the footer prints the grouped lines from the same schedule', async ({ page }) => {
    await page.goto('/')

    for (const line of formatWeeklyHoursLines(CONFIRMED_SCHEDULE)) {
      await expect(page.getByRole('contentinfo').getByText(line, { exact: true })).toBeVisible()
    }
  })

  test('the status badge names a state in words, never colour alone', async ({ page }) => {
    await page.goto('/find-os')

    const badge = page.getByRole('main').getByText(/^(Åbent nu|Lukket)/).first()
    await expect(badge).toBeVisible()
  })
})

test.describe('Forsiden', () => {
  test('shows the three featured dishes, undisturbed by Månedens burger', async ({ page }) => {
    await page.goto('/')

    const featured = page.getByRole('region', { name: 'Tre fra menuen' })
    await expect(featured.getByRole('listitem')).toHaveCount(3)
    await expect(featured.getByRole('heading', { name: 'Odin', exact: true })).toBeVisible()
    await expect(featured.getByRole('heading', { name: 'Frigg', exact: true })).toBeVisible()
    await expect(featured.getByRole('heading', { name: 'Ragnar', exact: true })).toBeVisible()
  })

  test('hides the whole Månedens burger section rather than saying one is missing', async ({
    page,
  }) => {
    // Nothing is configured in the seed (1ab lists Månedens burger as still outstanding),
    // so the section must be absent from the Forside — not present and empty, and not
    // carrying the menu page's "ikke oplyst endnu" development wording.
    await page.goto('/')

    await expect(page.locator('#maanedens-burger-titel')).toHaveCount(0)
    await expect(page.getByRole('main').getByText('Månedens burger')).toHaveCount(0)
    await expect(page.getByRole('main').getByText('ikke oplyst endnu')).toHaveCount(0)
  })
})

test.describe('the menu', () => {
  test('lists the nine confirmed sections in the approved order', async ({ page }) => {
    await page.goto('/menu')

    const headings = await page.getByRole('heading', { level: 2 }).allInnerTexts()
    expect(headings).toEqual(MENU_CATEGORIES.map((category) => category.name))
  })

  test('every category control jumps to its section', async ({ page }) => {
    await page.goto('/menu')

    const bar = page.getByRole('navigation', { name: 'Menuens kategorier' })

    for (const category of MENU_CATEGORIES) {
      const chip = bar.getByRole('link', { name: category.name, exact: true })
      await expect(chip).toHaveAttribute('href', `#${category.anchor}`)
      await expect(page.locator(`#${category.anchor}`)).toHaveCount(1)
    }
  })

  test('clicking a chip scrolls its section into view below the sticky bar', async ({ page }) => {
    await page.goto('/menu')

    await page
      .getByRole('navigation', { name: 'Menuens kategorier' })
      .getByRole('link', { name: 'Tapas', exact: true })
      .click()

    await expect(page).toHaveURL(/#menu-tapas$/)

    const heading = page.locator('#menu-tapas h2')
    await expect(heading).toBeInViewport()
  })

  test('shows the confirmed dishes and prices, with nothing behind an interaction', async ({
    page,
  }) => {
    await page.goto('/menu')

    for (const dish of ['Odin', 'Frigg', 'Ragnar', 'Thor', 'Glade Gris']) {
      await expect(page.getByRole('heading', { name: dish, exact: true })).toBeVisible()
    }

    await expect(page.getByText('89 kr.').first()).toBeVisible()
    await expect(page.getByText('97 kr.').first()).toBeVisible()

    // The additions the brief calls out by name.
    await expect(page.getByRole('heading', { name: 'Dip', exact: true })).toBeVisible()
    await expect(page.getByText('BBQ · chili · aioli')).toBeVisible()

    // No accordion, no disclosure: every section body is already on the page.
    await expect(page.locator('#menu-varm-selv')).toBeVisible()
  })

  test('renders the three tapas lists as content, not as a configurator', async ({ page }) => {
    await page.goto('/menu')

    const tapas = page.locator('#menu-tapas')
    await expect(tapas.getByText('På bordet — altid med', { exact: false })).toBeVisible()
    await expect(tapas.getByText('I vælger 7', { exact: false })).toBeVisible()
    await expect(tapas.getByText('Og 3 dressinger', { exact: false })).toBeVisible()
    await expect(tapas.locator('input, button, select')).toHaveCount(0)
  })

  test('shows the approved Ugens ret and Lørdagsmenu states', async ({ page }) => {
    await page.goto('/menu')

    const section = page.locator('#menu-ugens-ret')
    await expect(section.getByText('Uge 35')).toBeVisible()
    await expect(section.getByText('Onsdag · torsdag · fredag')).toBeVisible()
    await expect(section.getByText('Ingen lørdagsmenu denne uge')).toBeVisible()
    await expect(
      section.getByText('Alle ugens retter kan også laves glutenfrie og laktosefrie.', {
        exact: false,
      }),
    ).toBeVisible()
  })

  test('shows Månedens burger as not yet supplied rather than inventing one', async ({ page }) => {
    await page.goto('/menu')

    const card = page.locator('#menu-burgere').getByRole('article').last()
    await expect(card.getByRole('heading', { name: 'Månedens burger' })).toBeVisible()
    await expect(card.getByText('ikke oplyst endnu', { exact: false })).toBeVisible()

    // The menu carries the in-list card and only that. The Forside's promotional
    // section is the Forside's alone, in any burger state, so its heading must never
    // appear here — the menu page does not ask the Forside's question (§7d).
    await expect(page.locator('#maanedens-burger-titel')).toHaveCount(0)
  })
})

test.describe('Find os', () => {
  test('the whole map is one link to directions', async ({ page }) => {
    await page.goto('/find-os')

    const mapLink = page.getByRole('main').locator('a[href*="google.com/maps/dir"]:has(img)')
    await expect(mapLink).toBeVisible()

    const href = await mapLink.getAttribute('href')
    expect(href).toContain('api=1')
    expect(decodeURIComponent(href ?? '')).toContain(ADDRESS_LINE)

    await expect(mapLink.locator('img')).toHaveCount(1)
    await expect(mapLink.locator('img')).toHaveAttribute('width', '1200')
    await expect(mapLink.locator('img')).toHaveAttribute('height', '900')
  })

  test('the address is real text beside the map, not only inside the image', async ({ page }) => {
    await page.goto('/find-os')

    const address = page.locator('address').first()
    await expect(address).toContainText('Lumbyvej 62')
    await expect(address).toContainText('5792 Nørre Lyndelse')
  })

  test('shows both numbers, with the primary one dominant', async ({ page }) => {
    await page.goto('/find-os')

    const main = page.getByRole('main')
    await expect(main.getByText(PRIMARY_PHONE).first()).toBeVisible()
    await expect(main.getByText('Ekstra nummer', { exact: false })).toBeVisible()
  })

  test('links to the restaurant Facebook page and nowhere else off-site', async ({ page }) => {
    await page.goto('/find-os')

    const facebook = page.getByRole('main').getByRole('link', { name: 'Facebook' }).first()
    await expect(facebook).toHaveAttribute('href', /facebook\.com\/carlnielsencafeen/)
    await expect(facebook).toHaveAttribute('rel', /noopener/)
  })
})

test.describe('Mad ud af huset', () => {
  test('is reachable, and invents no catering terms', async ({ page }) => {
    const response = await page.goto('/mad-ud-af-huset')
    expect(response?.status()).toBe(200)

    await expect(page.getByText('der er ingen formular', { exact: false })).toBeVisible()

    const body = (await page.locator('main').innerText()).toLowerCase()
    for (const invented of ['minimum', 'kuverter', 'levering', 'depositum', 'senest 48']) {
      expect(body, `the page states a catering term nobody confirmed: ${invented}`).not.toContain(
        invented,
      )
    }
  })

  test('is listed in the navigation while the page is switched on', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 1024, 'the desktop bar is hidden below 1024 px')

    await page.goto('/')
    await expect(
      page
        .getByRole('navigation', { name: 'Hovedmenu' })
        .getByRole('link', { name: 'Mad ud af huset' }),
    ).toBeVisible()
  })
})

test.describe('privacy', () => {
  test('a visitor to any public page is given no cookie at all', async ({ page, context }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path)
    }
    await page.goto('/nyheder/overskrift-placeholder-ny-burger')

    expect(await context.cookies()).toEqual([])
  })

  test('no third-party script, pixel or tag manager is loaded', async ({ page }) => {
    const external: string[] = []

    page.on('request', (request) => {
      const url = new URL(request.url())
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) external.push(request.url())
    })

    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path)
    }

    expect(external).toEqual([])
  })
})
