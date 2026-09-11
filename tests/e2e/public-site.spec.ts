import { expect, type Locator, type Page, test } from '@playwright/test'

import { formatDailyHours, formatWeekdayName, formatWeeklyHoursLines } from '@/lib/hours/format'
import { weekdayOf } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'
import { CONFIRMED_SCHEDULE } from '../unit/fixtures/hours'
import {
  ADDRESS_LINE,
  MENU_CATEGORIES,
  PRIMARY_PHONE,
  SECONDARY_PHONE,
  PRIMARY_TEL_HREF,
  PUBLIC_EMAIL,
  PUBLIC_EMAIL_HREF,
  PUBLIC_ROUTES,
  SECONDARY_TEL_HREF,
} from './support/site'
import { belongsToMapEmbed } from './support/map-embed'
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

  /**
   * The fullscreen panel covers the page it takes you to, and a client-side route
   * change leaves the layout — and so the panel — mounted. Every way out of it is
   * asserted here: the six links, the page you are already on, the browser's own Back,
   * the keyboard, Escape and the ×.
   */
  test.describe('the fullscreen menu closes itself', () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'the panel is the navigation below 1024 px')

    const menu = (page: Page) => page.locator('details.site-menu')
    const panel = (page: Page) => page.getByRole('navigation', { name: 'Alle sider' })

    async function openMenu(page: Page) {
      await menu(page).locator('summary').click()
      await expect(menu(page)).toHaveAttribute('open', '')
    }

    for (const route of PUBLIC_ROUTES) {
      test(`${route.navLabel} leaves no panel over the page it opened`, async ({ page }) => {
        await page.goto('/')
        await openMenu(page)

        await panel(page).getByRole('link', { name: route.navLabel, exact: true }).click()

        await expect(page).toHaveURL(new RegExp(`${route.path === '/' ? '/$' : route.path}`))
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading)
        // Both halves matter: the element's own state, and that nothing of the panel is
        // still on screen for a guest to have to tap away.
        await expect(menu(page)).not.toHaveAttribute('open', '')
        await expect(panel(page)).toBeHidden()
      })
    }

    test('the page you are already on closes it too, and hands focus back to the control', async ({
      page,
    }) => {
      await page.goto('/menu')
      await openMenu(page)

      await panel(page).getByRole('link', { name: 'Menu', exact: true }).click()

      await expect(page).toHaveURL(/\/menu\/$/)
      await expect(menu(page)).not.toHaveAttribute('open', '')
      await expect(panel(page)).toBeHidden()
      // Focus was inside the panel, and the panel is gone: it belongs on the control
      // that opened it, never on an element that has just been hidden.
      await expect(menu(page).locator('summary')).toBeFocused()
    })

    test('a navigation the panel did not start closes it as well', async ({ page }) => {
      await page.goto('/')
      await openMenu(page)
      await panel(page).getByRole('link', { name: 'Om os', exact: true }).click()
      await expect(page).toHaveURL(/\/om-os\/$/)

      // Open it again and leave through the browser's own Back, which the panel never
      // hears about as a click.
      await openMenu(page)
      await page.goBack()

      await expect(page).toHaveURL(/\/$/)
      await expect(menu(page)).not.toHaveAttribute('open', '')
      await expect(panel(page)).toBeHidden()

      await openMenu(page)
      await page.goForward()

      await expect(page).toHaveURL(/\/om-os\/$/)
      await expect(menu(page)).not.toHaveAttribute('open', '')
    })

    test('the keyboard opens it, follows a link and closes it', async ({ page }) => {
      await page.goto('/')

      await menu(page).locator('summary').press('Enter')
      await expect(menu(page)).toHaveAttribute('open', '')

      await panel(page).getByRole('link', { name: 'Nyheder', exact: true }).press('Enter')

      await expect(page).toHaveURL(/\/nyheder\/$/)
      await expect(menu(page)).not.toHaveAttribute('open', '')
    })

    test('Escape and the × close it without going anywhere', async ({ page }) => {
      await page.goto('/find-os')

      // Escape: a panel covering the whole viewport needs a way out that is not a hunt
      // for the ×. A plain <details> has none of its own, so this is ours.
      await openMenu(page)
      await page.keyboard.press('Escape')
      await expect(menu(page)).not.toHaveAttribute('open', '')
      await expect(menu(page).locator('summary')).toBeFocused()

      // The × is the same single control as the hamburger, and still closes it.
      await openMenu(page)
      await menu(page).locator('summary').click()
      await expect(menu(page)).not.toHaveAttribute('open', '')

      await expect(page).toHaveURL(/\/find-os\/$/)
    })
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
    await expect(bar.getByRole('link', { name: 'Menu' })).toHaveAttribute('href', '/menu/')
    await expect(bar.getByRole('link', { name: 'Tider' })).toHaveAttribute(
      'href',
      '/find-os/#aabningstider',
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

    // The prerendered HTML claims nothing; the browser decides and replaces the
    // neutral label with the real state. `toBeVisible` waits for that to happen.
    const badge = page.getByRole('main').getByText(/^(Åbent nu|Lukket)/).first()
    await expect(badge).toBeVisible()
  })

  test('the browser decides which row of the hours table is today', async ({ page }) => {
    await page.goto('/find-os')

    // The context runs in Europe/Copenhagen, so the browser's own weekday is the
    // answer the page must reach. Asserted on the element rather than on its
    // visibility: at 375 px the seven-day list sits inside a collapsed <details>.
    const weekday = formatWeekdayName(weekdayOf(copenhagenDateOf(new Date())), 'long')
    const today = weekday.charAt(0).toUpperCase() + weekday.slice(1)

    await expect(
      page.getByRole('main').locator('dt', { hasText: '· i dag' }).first(),
    ).toHaveText(new RegExp(`^${today}`))
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

  test('shows Månedens burger as not yet supplied, between the award and the three dishes', async ({
    page,
  }) => {
    // Nothing is configured in the seed (1ab lists Månedens burger as still outstanding),
    // so the Forside draws the menu page's own empty card — the same sentence, under the
    // section's own heading — and invents no burger, price or ordering action.
    await page.goto('/')

    const section = page.getByRole('region', { name: 'Månedens burger' })
    await expect(section.getByRole('heading', { level: 2, name: 'Månedens burger' })).toBeVisible()
    await expect(section.getByText('ingen månedens burger lige nu', { exact: false })).toBeVisible()
    await expect(section.getByText('Skiftende')).toBeVisible()
    await expect(section.getByRole('link')).toHaveCount(0)
    await expect(section.getByText('kr.')).toHaveCount(0)

    // Order on the page: the burgundy award band, then this section, then "Tre fra menuen".
    const award = page.locator('#udmaerkelse-titel')
    const featured = page.getByRole('region', { name: 'Tre fra menuen' })
    const top = (locator: Locator) =>
      locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY)
    const [awardTop, sectionTop, featuredTop] = await Promise.all([
      top(award),
      top(section),
      top(featured),
    ])
    expect(awardTop).toBeLessThan(sectionTop)
    expect(sectionTop).toBeLessThan(featuredTop)
  })
})

test.describe('the menu', () => {
  test('lists the nine confirmed sections in the approved order', async ({ page }) => {
    await page.goto('/menu')

    const headings = await page.getByRole('heading', { level: 2 }).allInnerTexts()
    expect(headings).toEqual(MENU_CATEGORIES.map((category) => category.name))
  })

  test('lists exactly the forty-six confirmed dishes', async ({ page }) => {
    await page.goto('/menu')

    // Every dish is an <h3> — a card or a price row — except the tapas board, which
    // is one dish rendered as three lists under its own three headings. The other
    // <h3>s in the body are the two approved empty cards.
    const NOT_A_DISH = new Set([
      'Altid med på bordet',
      'I vælger 7',
      'Og 3 dressinger',
      'Månedens burger',
      'Lørdagsmenu',
    ])
    // `textContent`, not `innerText`: the eyebrow headings are uppercased by CSS.
    const headings = await page
      .getByRole('main')
      .locator('h3')
      .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''))
    const dishes = headings.filter((heading) => !NOT_A_DISH.has(heading))

    expect(dishes).toHaveLength(45)
    await expect(page.locator('#menu-tapas').getByText('Til to personer', { exact: true })).toBeVisible()
    expect(dishes).not.toContain('Salat efter sæson')
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

    // The menu price is one line under the Burgere introduction, Ragnar's exception in
    // it, and no card repeats it; the four 89 kr. burgers and Ragnar keep their prices.
    const burgers = page.locator('#menu-burgere')
    // getByText normalises whitespace, so the plain-space string matches; the raw text
    // check below proves the loader put a non-breaking space between number and "kr.".
    const menuPriceLine = burgers.getByText(
      'Som menu med pommes frites og sodavand: 124 kr., Ragnar 132 kr.',
    )
    await expect(menuPriceLine).toBeVisible()
    await expect(menuPriceLine).toHaveText(/124 kr\., Ragnar 132 kr\./)
    await expect(page.getByRole('main').getByText(/som menu/i)).toHaveCount(1)
    await expect(burgers.getByText('89 kr.', { exact: true })).toHaveCount(4)
    await expect(burgers.getByText('97 kr.', { exact: true })).toHaveCount(1)

    // The additions the brief calls out by name.
    await expect(page.getByRole('heading', { name: 'Dip', exact: true })).toBeVisible()
    await expect(page.getByText('BBQ · chili · aioli')).toBeVisible()

    // No accordion, no disclosure: every section body is already on the page.
    await expect(page.locator('#menu-varm-selv')).toBeVisible()
  })

  test('renders the three tapas lists as content, not as a configurator', async ({ page }) => {
    await page.goto('/menu')

    const tapas = page.locator('#menu-tapas')
    await expect(tapas.getByText('Altid med på bordet', { exact: false })).toBeVisible()
    await expect(tapas.getByText('I vælger 7', { exact: false })).toBeVisible()
    await expect(tapas.getByText('Og 3 dressinger', { exact: false })).toBeVisible()
    await expect(tapas.locator('input, button, select')).toHaveCount(0)
  })

  test('shows the approved Ugens ret and Lørdagsmenu states, with no invented week', async ({ page }) => {
    await page.goto('/menu')

    // The kitchen has not supplied a week: no dish card, no week number, no days —
    // only the approved "no Saturday menu" card and the section's own note (1af).
    const section = page.locator('#menu-ugens-ret')
    await expect(section.getByRole('article')).toHaveCount(0)
    await expect(section.getByText(/^Uge \d+$/)).toHaveCount(0)
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
    await expect(card.getByText('ingen månedens burger lige nu', { exact: false })).toBeVisible()

    // The menu carries the in-list card and only that. The Forside's promotional
    // section is the Forside's alone, in any burger state, so its heading must never
    // appear here — the menu page does not ask the Forside's question (§7d).
    await expect(page.locator('#maanedens-burger-titel')).toHaveCount(0)
  })
})

test.describe('Find os', () => {
  test('the map is the official Google Maps embed, and the page adds no second directions link', async ({
    page,
  }) => {
    await page.goto('/find-os')

    const main = page.getByRole('main')
    const frame = main.locator('iframe[title^="Kort over"]')
    await expect(frame).toBeVisible()
    expect(await frame.getAttribute('src')).toContain('https://www.google.com/maps/embed?pb=')

    // The embed is the page's directions. "Vis vej" stays on the Forside and in the
    // mobile bar, but Find os no longer repeats it beside the map.
    await expect(main.getByRole('link', { name: 'Vis vej' })).toHaveCount(0)
  })

  test('the Forside still opens directions to the confirmed address', async ({ page }) => {
    await page.goto('/')

    const directions = page.getByRole('main').getByRole('link', { name: 'Vis vej' }).first()
    const href = await directions.getAttribute('href')
    expect(href).toContain('api=1')
    expect(decodeURIComponent(href ?? '')).toContain(ADDRESS_LINE)
  })

  test('the address is real text beside the map, not only inside the image', async ({ page }) => {
    await page.goto('/find-os')

    const address = page.locator('address').first()
    await expect(address).toContainText('Lumbyvej 62')
    await expect(address).toContainText('5792 Nørre Lyndelse')
  })

  test('shows both numbers once, with the primary one as the one call action', async ({
    page,
  }) => {
    await page.goto('/find-os')

    const main = page.getByRole('main')

    // The primary number is stated once, inside the Telefon block, and that one
    // statement is the tappable "Ring" action — no second button above it.
    await expect(main.getByText('Telefon', { exact: true })).toBeVisible()
    const ring = main.getByRole('link', { name: `Ring ${PRIMARY_PHONE}` })
    await expect(ring).toHaveCount(1)
    await expect(ring).toBeVisible()
    await expect(ring).toHaveAttribute('href', PRIMARY_TEL_HREF)
    await expect(main.getByText(PRIMARY_PHONE)).toHaveCount(1)

    await expect(main.getByText(`eller ${SECONDARY_PHONE}`)).toBeVisible()
    await expect(main.getByText('Ekstra nummer')).toHaveCount(0)
  })

  test('prints the confirmed e-mail address as a mailto link, once', async ({ page }) => {
    await page.goto('/find-os')

    const main = page.getByRole('main')
    const email = main.locator('a[href^="mailto:"]')

    // One address, one link: the value is the stored one, and it is beside the telephone
    // information rather than repeated down the page (C4).
    await expect(email).toHaveCount(1)
    await expect(email).toHaveAttribute('href', PUBLIC_EMAIL_HREF)
    await expect(email).toHaveText(PUBLIC_EMAIL)
    await expect(main.getByText('E-mail', { exact: true })).toBeVisible()
  })

  test('the e-mail address is in the footer of every page, and in main only on Find os', async ({
    page,
  }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path)

      // The footer carries the address on every page, under the two numbers.
      const footerEmail = page.getByRole('contentinfo').locator('a[href^="mailto:"]')
      await expect(footerEmail, route.path).toHaveCount(1)
      await expect(footerEmail, route.path).toHaveAttribute('href', PUBLIC_EMAIL_HREF)
      await expect(footerEmail, route.path).toHaveText(PUBLIC_EMAIL)

      // Inside the page itself it stays a Find os block: no other page repeats it.
      const expected = route.path === '/find-os/' ? 1 : 0
      await expect(page.getByRole('main').locator('a[href^="mailto:"]'), route.path).toHaveCount(
        expected,
      )
    }
  })

  test('the footer keeps the phones ahead of the address', async ({ page }) => {
    await page.goto('/find-os')

    // Order in the contact block: primary number, secondary number, e-mail (1g).
    const links = page.getByRole('contentinfo').locator('address a')
    await expect(links).toHaveCount(3)
    await expect(links.nth(0)).toHaveAttribute('href', PRIMARY_TEL_HREF)
    await expect(links.nth(1)).toHaveText(`eller ${SECONDARY_PHONE}`)
    await expect(links.nth(2)).toHaveAttribute('href', PUBLIC_EMAIL_HREF)
  })

  test('leaves the Facebook link to the footer rather than repeating it beside the map', async ({
    page,
  }) => {
    await page.goto('/find-os')

    // The page carries no "Følg os" card of its own: the footer on every page is the
    // one place the confirmed Facebook link is offered.
    await expect(page.getByRole('main').getByRole('link', { name: 'Facebook' })).toHaveCount(0)

    const facebook = page.getByRole('contentinfo').getByRole('link', { name: 'Facebook' })
    await expect(facebook).toHaveAttribute('href', /facebook\.com\/carlnielsencafeen/)
    await expect(facebook).toHaveAttribute('rel', /noopener/)
  })
})

test.describe('Mad ud af huset', () => {
  test('is reachable, and invents no catering terms', async ({ page }) => {
    const response = await page.goto('/mad-ud-af-huset')
    expect(response?.status()).toBe(200)

    await expect(page.getByText('klarer vi over telefonen', { exact: false })).toBeVisible()

    const body = (await page.locator('main').innerText()).toLowerCase()
    for (const invented of ['minimum', 'kuverter', 'levering', 'depositum', 'senest 48']) {
      expect(body, `the page states a catering term nobody confirmed: ${invented}`).not.toContain(
        invented,
      )
    }
  })

  test('prints each phone number once, in the hero, and closes with one band', async ({ page }) => {
    await page.goto('/mad-ud-af-huset')

    const main = page.getByRole('main')
    const text = await main.innerText()
    for (const number of ['+45 63 90 83 00', '+45 51 79 45 66']) {
      expect(text.split(number).length - 1, `${number} should appear once in the page body`).toBe(1)
    }

    await expect(main.getByRole('heading', { level: 2 })).toHaveCount(1)
    await expect(main.getByRole('heading', { name: 'Til selskaber og sammenkomster' })).toBeVisible()
    await expect(main.getByRole('link', { name: 'Ring og hør mere', exact: true })).toHaveAttribute(
      'href',
      'tel:+4563908300',
    )
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

/**
 * The photographs — the static twin of the retired `public-images.spec.ts` guest half
 * (phase 10C-2, brief §36, §38, §41): every public photo is a processed derivative
 * under `/media/`, served as plain files, chosen by `sizes`, and rendered as server
 * HTML. The build renders exactly the rungs the page names, so a missing file here is
 * a broken registry, not a slow network.
 */
test.describe('photographs', () => {
  const dishImage = (page: Page, dish: string) =>
    page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: dish, exact: true }) })
      .first()
      .locator('picture img')

  test('the menu renders the four dish photographs from the derivative ladder alone', async ({
    page,
  }) => {
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))

    await page.goto('/menu')

    const odin = dishImage(page, 'Odin')
    await expect(odin).toHaveAttribute('src', '/media/dish-odin/960.webp')
    await expect(odin).toHaveAttribute('srcset', /480w.*960w.*1440w/)
    await expect(odin).toHaveAttribute('sizes', /9\.375rem/)
    await expect(odin).toHaveAttribute('width', '1440')
    await expect(odin).toHaveAttribute('height', '1080')
    await expect(odin.locator('xpath=..').locator('source[type="image/avif"]')).toHaveCount(1)

    const ragnar = dishImage(page, 'Ragnar')
    await expect(ragnar).toHaveAttribute('src', '/media/dish-ragnar/960.webp')
    await expect(ragnar).toHaveAttribute('srcset', /480w.*960w/)
    await expect(ragnar).not.toHaveAttribute('srcset', /1440w/)

    const frigg = dishImage(page, 'Frigg')
    await expect(frigg).toHaveAttribute('src', '/media/dish-frigg/960.webp')
    await expect(frigg).toHaveAttribute('alt', '')
    // Frigg's tall photograph is framed on its upper part, so the bun stays in view.
    await expect(frigg).toHaveClass(/object-\[50%_20%\]/)

    const gladeGris = dishImage(page, 'Glade Gris')
    await expect(gladeGris).toHaveAttribute('src', '/media/dish-glade-gris/960.webp')
    await expect(gladeGris).not.toHaveClass(/object-\[/)

    // Thor has no accurate supplied photograph yet, so it keeps its reserved frame (1h/1m)
    // rather than a misleading stand-in; it is the only reserved frame on the menu.
    const thor = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Thor', exact: true }) })
    await expect(thor.locator('picture')).toHaveCount(0)
    await expect(thor.locator('.media-placeholder')).toHaveCount(1)
    await expect(page.getByRole('main').locator('.media-placeholder')).toHaveCount(1)

    // The 6rem / 9.375rem slot takes the 480 rung at either width, once, as AVIF —
    // never the largest rung and never a source file.
    await expect(odin).toBeVisible()
    await page.waitForLoadState('networkidle')
    const forOdin = requested.filter((url) => url.includes('/media/dish-odin/'))
    expect(forOdin).toHaveLength(1)
    expect(forOdin[0]).toMatch(/\/480\.avif$/)
    // Never a source photograph. The one PNG the site serves is the competition seal
    // (`public/brand/award.png`, a brand asset like the logo), which the router may
    // prefetch for the Forside from any page; it is not a photograph and not under /media/.
    expect(
      requested.filter((url) => /\.png(\?|$)/.test(url) && !url.includes('/brand/')),
    ).toEqual([])

    const html = await page.content()
    expect(html).not.toContain('supabase')
    expect(html).not.toContain('/storage/v1/')
  })

  test('the Forside, Om os and Mad ud af huset carry their photographs with the recorded descriptions', async ({
    page,
  }) => {
    await page.goto('/')
    const hero = page.locator('section[aria-labelledby="forside-titel"] picture img')
    await expect(hero).toHaveAttribute('src', '/media/home-hero/960.webp')
    await expect(hero).toHaveAttribute('alt', 'Burger med bacon og spejlæg')
    await expect(hero).toHaveAttribute('loading', 'eager')
    await expect(page.locator('img[src^="/media/about-venue/"]').first()).toHaveAttribute(
      'alt',
      'Spisesalen hos Klingenberg Food',
    )

    await page.goto('/om-os')
    await expect(page.getByRole('main').locator('img[src^="/media/about-venue/"]')).toHaveCount(1)

    await page.goto('/mad-ud-af-huset')
    const takeaway = page.getByRole('main').locator('picture img')
    await expect(takeaway).toHaveAttribute('src', '/media/takeaway/960.webp')
    await expect(takeaway).toHaveAttribute('alt', 'Tre sandwiches')
  })
})

test.describe('privacy', () => {
  test('a visitor to any public page is given no cookie at all', async ({ page, context }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path)
    }
    await page.goto('/nyheder/ukendt-artikel/')

    expect(await context.cookies()).toEqual([])
  })

  /*
   * §12, as revised by phase 14B3 (§0ap, §0aq). The site itself must still load nothing
   * from anybody — no analytics, no pixel, no tag manager, no font from a CDN. The one
   * accepted exception is Google's map frame, and it is excluded by *who asked* rather
   * than by host, so the guarantee survives Google changing its own hosts and a tracker
   * added to the site's own document still fails here (`./support/map-embed`).
   */
  test('no third-party script, pixel or tag manager is loaded', async ({ page }) => {
    const external: string[] = []

    page.on('request', (request) => {
      const url = new URL(request.url())
      if (['localhost', '127.0.0.1'].includes(url.hostname)) return
      if (belongsToMapEmbed(request)) return
      external.push(request.url())
    })

    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path)
    }

    expect(external).toEqual([])
  })
})
