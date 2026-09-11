import { expect, type Locator, type Page, test } from '@playwright/test'

import { loadAboutPage, loadHomePage } from '@/lib/content/load/pages'
import { formatPrice } from '@/lib/format/danish'
import { formatDailyHours, formatWeekdayName, formatWeeklyHoursLines } from '@/lib/hours/format'
import { categoryAnchorId } from '@/lib/menu/view'
import { weekdayOf } from '@/lib/time/calendar'
import { MENU_CLOSE_DELAY_MS } from '@/lib/site/navigation'
import { copenhagenDateOf } from '@/lib/time/copenhagen'
import {
  ADDRESS_LINE,
  EVERY_DISH,
  FACEBOOK_URL,
  FEATURED_DISHES,
  MENU_CATEGORIES,
  MENU_CONTENT,
  MONTHLY_BURGER,
  PRIMARY_PHONE,
  SECONDARY_PHONE,
  PRIMARY_TEL_HREF,
  PUBLIC_EMAIL,
  PUBLIC_EMAIL_HREF,
  PUBLIC_ROUTES,
  SCHEDULE,
  SECONDARY_TEL_HREF,
  TAKEAWAY,
  TAPAS,
  WEEKLY_SPECIAL,
} from './support/site'
import { belongsToMapEmbed } from './support/map-embed'
import { waitForPublicShell } from './support/public-shell'

/** The space the loader joins a price to "kr." with, so a narrow column cannot split them. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0)

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

    /**
     * The order of the two changes, in the browser's own clock. Two observers are put
     * in place before the tap: one on the panel's `open` attribute, one on the document
     * for the moment the heading of the next page arrives. What comes back is when each
     * happened and whether the panel was still open when the page changed — the flash
     * the pause exists to remove.
     */
    type Handover = { closedAt: number | null; arrivedAt: number | null; openOnArrival: boolean | null }

    async function watchHandover(page: Page, nextHeading: string) {
      await page.evaluate((heading) => {
        const details = document.querySelector('details.site-menu') as HTMLDetailsElement
        const record: Handover = { closedAt: null, arrivedAt: null, openOnArrival: null }
        ;(window as unknown as { __handover: Handover }).__handover = record

        new MutationObserver(() => {
          if (!details.open && record.closedAt === null) record.closedAt = performance.now()
        }).observe(details, { attributes: true, attributeFilter: ['open'] })

        new MutationObserver(() => {
          if (record.arrivedAt !== null) return
          if (document.querySelector('h1')?.textContent === heading) {
            record.arrivedAt = performance.now()
            record.openOnArrival = details.open
          }
        }).observe(document.body, { childList: true, subtree: true, characterData: true })
      }, nextHeading)
    }

    async function handover(page: Page): Promise<Handover> {
      return page.evaluate(() => (window as unknown as { __handover: Handover }).__handover)
    }

    const OM_OS = PUBLIC_ROUTES.find((route) => route.navLabel === 'Om os')!

    for (const width of [375, 390]) {
      test.describe(`at ${width} px`, () => {
        test.use({ viewport: { width, height: 812 } })

        test('a tap clears the panel first, and the page follows a moment later', async ({
          page,
        }) => {
          await page.goto('/')
          await openMenu(page)
          await watchHandover(page, OM_OS.heading)

          await panel(page).getByRole('link', { name: 'Om os', exact: true }).click()

          // The panel is gone at once — before the router has been asked for anything.
          await expect(menu(page)).not.toHaveAttribute('open', '')
          await expect(panel(page)).toBeHidden()

          await expect(page).toHaveURL(/\/om-os\/$/)
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(OM_OS.heading)

          const seen = await handover(page)
          expect(seen.closedAt).not.toBeNull()
          expect(seen.arrivedAt).not.toBeNull()
          // Closed first, the page after; and never the page under an open panel.
          expect(seen.openOnArrival).toBe(false)
          // A timer never fires early; a few milliseconds late is the browser's business.
          expect(seen.arrivedAt! - seen.closedAt!).toBeGreaterThanOrEqual(MENU_CLOSE_DELAY_MS - 10)
          expect(seen.arrivedAt! - seen.closedAt!).toBeLessThan(1000)
        })
      })
    }

    test.describe('for a visitor who asked for less motion', () => {
      test.use({ contextOptions: { reducedMotion: 'reduce' } })

      test('the panel closes and the page comes at once, with no pause', async ({ page }) => {
        await page.goto('/')
        await openMenu(page)
        await watchHandover(page, OM_OS.heading)

        await panel(page).getByRole('link', { name: 'Om os', exact: true }).click()

        await expect(page).toHaveURL(/\/om-os\/$/)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(OM_OS.heading)
        await expect(menu(page)).not.toHaveAttribute('open', '')

        const seen = await handover(page)
        expect(seen.openOnArrival).toBe(false)
        // The route is prefetched while its link is on screen, so without the pause the
        // page is a handful of milliseconds behind the close — never the full delay.
        expect(seen.arrivedAt! - seen.closedAt!).toBeLessThan(MENU_CLOSE_DELAY_MS)
      })
    })

    test('two quick taps are one navigation', async ({ page }) => {
      await page.goto('/')
      await openMenu(page)
      const before = await page.evaluate(() => history.length)

      // Two clicks in the same task, the way a nervous thumb lands twice: the second
      // finds the panel already closing and must not queue a second route change.
      await panel(page)
        .getByRole('link', { name: 'Om os', exact: true })
        .evaluate((link: HTMLAnchorElement) => {
          link.click()
          link.click()
        })

      await expect(page).toHaveURL(/\/om-os\/$/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(OM_OS.heading)
      // Give a second, queued navigation every chance to show itself before counting.
      await page.waitForTimeout(MENU_CLOSE_DELAY_MS * 3)
      expect(await page.evaluate(() => history.length)).toBe(before + 1)
      await expect(page).toHaveURL(/\/om-os\/$/)
    })

    test('a modifier-click opens a new tab and leaves the panel and the page alone', async ({
      page,
      context,
    }) => {
      await page.goto('/')
      await openMenu(page)

      const opened = context.waitForEvent('page')
      await panel(page)
        .getByRole('link', { name: 'Om os', exact: true })
        .click({ modifiers: ['ControlOrMeta'] })
      const tab = await opened

      await expect(tab).toHaveURL(/\/om-os\/$/)
      await page.waitForTimeout(MENU_CLOSE_DELAY_MS * 3)
      await expect(page).toHaveURL(/\/$/)
      await expect(menu(page)).toHaveAttribute('open', '')
      await tab.close()
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

/**
 * The hours on the page are the hours in the document, put through the formatter.
 *
 * These used to be asserted against `CONFIRMED_SCHEDULE`, the fixture the engine suites
 * are written around — which made the restaurant's own week a code invariant, so moving
 * Wednesday from 15:00 to 16:00 in Pages CMS would have gone red. The engine's own
 * behaviour still belongs on a fixed schedule and still lives on one, in
 * `tests/unit/hours/`; what a browser can prove is the correspondence.
 */
test.describe('opening hours come from the phase 2 engine', () => {
  test('Find os prints exactly the rows the formatter produces', async ({ page }) => {
    await page.goto('/find-os')
    // The `count()` below answers immediately — the streamed shell has to be in the
    // document first, or the disclosure reads as absent on a page that carries it.
    await waitForPublicShell(page)

    const expected = formatDailyHours(SCHEDULE)

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

    for (const line of formatWeeklyHoursLines(SCHEDULE)) {
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
  /**
   * The band shows the dishes the menu marked, and no others.
   *
   * This used to name Odin, Frigg and Ragnar. "Vis på forsiden" is a checkbox on every
   * dish, so promoting a different burger next month would have failed CI for it — and
   * the claim worth making is not *which* three, it is that the page prints the marked
   * dishes rather than a list of its own.
   */
  test('shows the dishes the menu marks for the Forside, undisturbed by Månedens burger', async ({
    page,
  }) => {
    await page.goto('/')

    const featured = page.getByRole('region', { name: 'Tre fra menuen' })
    await expect(featured.getByRole('listitem')).toHaveCount(FEATURED_DISHES.length)

    for (const dish of FEATURED_DISHES) {
      await expect(featured.getByRole('heading', { name: dish.name, exact: true })).toBeVisible()
    }
  })

  /**
   * Månedens burger sits between the award band and the three dishes, in whichever of
   * its two states the document puts it in.
   *
   * The empty card used to be asserted flatly — 1ab listed Månedens burger as still
   * outstanding — but "Vis månedens burger" is a switch the restaurant flips, so the
   * state follows the document and only the *order* of the page is fixed.
   */
  test('places Månedens burger between the award and the three dishes, in its document’s state', async ({
    page,
  }) => {
    await page.goto('/')

    const section = page.getByRole('region', { name: 'Månedens burger' })
    await expect(section.getByRole('heading', { level: 2, name: 'Månedens burger' })).toBeVisible()

    if (MONTHLY_BURGER === null) {
      // No burger: the Forside draws the menu page's own empty card — the same sentence,
      // under the section's own heading — and invents no burger, price or ordering action.
      await expect(section.getByText('ingen månedens burger lige nu', { exact: false })).toBeVisible()
      await expect(section.getByText('Skiftende')).toBeVisible()
      await expect(section.getByRole('link')).toHaveCount(0)
      await expect(section.getByText('kr.')).toHaveCount(0)
    } else {
      await expect(section.getByText(MONTHLY_BURGER.name, { exact: false })).toBeVisible()
      await expect(section.getByText('ingen månedens burger lige nu', { exact: false })).toHaveCount(0)
    }

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
  test('lists the document’s own sections, in the document’s order', async ({ page }) => {
    await page.goto('/menu')

    const headings = await page.getByRole('heading', { level: 2 }).allInnerTexts()
    expect(headings).toEqual(MENU_CATEGORIES.map((category) => category.name))
  })

  /**
   * Every dish on the card is on the page, and the page invents none.
   *
   * This used to be "exactly the forty-six confirmed dishes", counted. A count is the
   * restaurant's — adding, removing and renaming dishes is the whole point of the
   * "Retter" list in Pages CMS — so what is compared is the page against the menu it was
   * built from, name for name and in order.
   */
  test('lists exactly the dishes the menu document carries, in its order', async ({ page }) => {
    await page.goto('/menu')

    // Every dish is an <h3> — a card or a price row. The other <h3>s in the body are the
    // tapas board's own group headings and the two cards that stand in for an absent
    // week or month, so they are excluded by name rather than counted as dishes.
    const NOT_A_DISH = new Set([
      ...TAPAS.groups.map((group) => group.heading),
      'Månedens burger',
      'Lørdagsmenu',
    ])
    // `textContent`, not `innerText`: the eyebrow headings are uppercased by CSS.
    const headings = await page
      .getByRole('main')
      .locator('h3')
      .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''))
    const dishes = headings.filter((heading) => !NOT_A_DISH.has(heading))

    expect(dishes).toEqual(EVERY_DISH.map((dish) => dish.name))
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

  /**
   * Every price on the card, printed as the page formats it — and nothing behind an
   * interaction.
   *
   * "Pris i kroner" is the field a restaurant changes most often, so the five burger
   * prices are gone from here, and so are the five burger names: what is asserted is
   * that each dish's own price is on the page, formatted by `lib/format/danish.ts`. A
   * dish with no price prints none, which is a real state and is excluded rather than
   * demanded.
   */
  test('prints each dish’s own price, with nothing behind an interaction', async ({ page }) => {
    await page.goto('/menu')

    const priced = EVERY_DISH.filter((dish) => dish.priceOre !== null)
    expect(priced.length, 'the menu prices nothing at all').toBeGreaterThan(0)

    const body = await page.getByRole('main').innerText()
    for (const dish of priced) {
      expect(body, `${dish.name} is missing its price`).toContain(formatPrice(dish.priceOre!))
    }

    // The one prose field the loader retypesets: each number in that section's
    // introduction is joined to "kr." with a non-breaking space, so a narrow column
    // never wraps to a line starting with "kr.". Asserted against the loaded sentence
    // rather than a quotation of it, so rewording the line cannot fail this.
    const joined = MENU_CONTENT.categories.find((category) =>
      category.intro?.includes(NO_BREAK_SPACE),
    )
    if (joined !== undefined) {
      const section = page.locator(`#${categoryAnchorId(joined.slug)}`)
      // getByText normalises whitespace, so the sentence matches with ordinary spaces;
      // the raw text below proves the non-breaking space survived into the document.
      const line = section.getByText(joined.intro!.split(NO_BREAK_SPACE).join(' '))
      await expect(line).toBeVisible()
      expect(await line.innerText()).toContain(NO_BREAK_SPACE)
    }

    // No accordion, no disclosure: every section body is already on the page.
    for (const category of MENU_CATEGORIES) {
      await expect(page.locator(`#${category.anchor}`), category.anchor).toBeVisible()
    }
  })

  test('renders the tapas lists as content, not as a configurator', async ({ page }) => {
    const section = MENU_CATEGORIES.find((category) => category.kind === 'tapas')
    test.skip(section === undefined, 'the menu draws no tapas board')

    await page.goto('/menu')

    const tapas = page.locator(`#${section!.anchor}`)
    for (const group of TAPAS.groups) {
      await expect(tapas.getByText(group.heading, { exact: false }).first()).toBeVisible()
      // Every item the board lists is on the page as text, under its own heading.
      for (const item of group.items) {
        await expect(tapas.getByText(item, { exact: false }).first()).toBeAttached()
      }
    }
    await expect(tapas.locator('input, button, select')).toHaveCount(0)
  })

  /**
   * Ugens ret in whichever of its two states the document puts it in.
   *
   * "Vis ugens ret" is a switch the kitchen flips on a Monday, so the empty card is no
   * longer asserted flatly: with no week the section draws the approved empty states and
   * invents nothing, and with a week it draws the week that was written. The section's
   * own note is likewise the document's words rather than a quotation of them.
   */
  test('shows Ugens ret exactly as its document has it, and never a week of its own', async ({
    page,
  }) => {
    const section = MENU_CONTENT.categories.find((category) => category.kind === 'weekly_special')
    test.skip(section === undefined, 'the menu draws no Ugens ret section')

    await page.goto('/menu')
    const week = page.locator(`#${categoryAnchorId(section!.slug)}`)

    if (WEEKLY_SPECIAL === null) {
      // No week: no dish card, no week number, no days — only the approved "no Saturday
      // menu" card and whatever note the section itself carries (1af).
      await expect(week.getByRole('article')).toHaveCount(0)
      await expect(week.getByText(/^Uge \d+$/)).toHaveCount(0)
      await expect(week.getByText('Ingen lørdagsmenu denne uge')).toBeVisible()
    } else {
      await expect(
        week.getByRole('heading', { name: WEEKLY_SPECIAL.name!, exact: true }),
      ).toBeVisible()
    }

    if (section!.note !== null) {
      await expect(week.getByText(section!.note, { exact: false })).toBeVisible()
    }
  })

  test('draws Månedens burger in the burger list, in its document’s state', async ({ page }) => {
    await page.goto('/menu')

    const card = page
      .getByRole('main')
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: 'Månedens burger' }) })
    await expect(card).toHaveCount(1)

    if (MONTHLY_BURGER === null) {
      await expect(card.getByText('ingen månedens burger lige nu', { exact: false })).toBeVisible()
    } else {
      await expect(card.getByText(MONTHLY_BURGER.name, { exact: false })).toBeVisible()
    }

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

    // The four address fields are `readonly: true` in Pages CMS, so the page is held to
    // the document's exact words here rather than to the shape of an address.
    const address = page.locator('address').first()
    await expect(address).toContainText(ADDRESS_LINE.split(',')[0]!)
    await expect(address).toContainText(ADDRESS_LINE.split(', ')[1]!)
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

    // "Ekstra telefon" is optional: the second line is there when the document carries
    // one and absent when it does not, and the block never invents a label for it.
    if (SECONDARY_PHONE === null) {
      await expect(main.getByText(/^eller \+?\d/)).toHaveCount(0)
    } else {
      await expect(main.getByText(`eller ${SECONDARY_PHONE}`)).toBeVisible()
    }
    await expect(main.getByText('Ekstra nummer')).toHaveCount(0)
  })

  test('prints the stored e-mail address as a mailto link, once', async ({ page }) => {
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

    // Order in the contact block: primary number, the second number when there is one,
    // then the e-mail address (1g).
    const links = page.getByRole('contentinfo').locator('address a')
    const expected = SECONDARY_PHONE === null ? 2 : 3

    await expect(links).toHaveCount(expected)
    await expect(links.nth(0)).toHaveAttribute('href', PRIMARY_TEL_HREF)
    if (SECONDARY_PHONE !== null) {
      await expect(links.nth(1)).toHaveText(`eller ${SECONDARY_PHONE}`)
      await expect(links.nth(1)).toHaveAttribute('href', SECONDARY_TEL_HREF!)
    }
    await expect(links.nth(expected - 1)).toHaveAttribute('href', PUBLIC_EMAIL_HREF)
  })

  test('leaves the Facebook link to the footer rather than repeating it beside the map', async ({
    page,
  }) => {
    await page.goto('/find-os')

    // The page carries no "Følg os" card of its own: the footer on every page is the
    // one place the stored Facebook link is offered.
    await expect(page.getByRole('main').getByRole('link', { name: 'Facebook' })).toHaveCount(0)

    const facebook = page.getByRole('contentinfo').getByRole('link', { name: 'Facebook' })
    if (FACEBOOK_URL === null) {
      await expect(facebook).toHaveCount(0)
      return
    }

    await expect(facebook).toHaveAttribute('href', FACEBOOK_URL)
    await expect(facebook).toHaveAttribute('rel', /noopener/)
  })
})

test.describe('Mad ud af huset', () => {
  /**
   * The page prints its own document and adds nothing.
   *
   * This used to hold the page to a list of catering terms nobody had confirmed —
   * "minimum", "kuverter", "levering" — which was the right guard while the copy was
   * written here and could not be corrected from anywhere else. It is the wrong guard
   * now: the heading, the introduction, the telephone note and every section body are
   * ordinary Pages CMS fields, and a restaurant that decides it *does* deliver must be
   * able to write so. What is held instead is that every word on the page came from the
   * document, and that the page contributes none of its own.
   */
  test('is reachable, and prints its document’s own words', async ({ page }) => {
    const response = await page.goto('/mad-ud-af-huset')
    expect(response?.status()).toBe(200)

    const main = page.getByRole('main')
    for (const words of [TAKEAWAY.intro, TAKEAWAY.phoneNote, ...TAKEAWAY.sections.map((s) => s.body)]) {
      if (words === null) continue
      await expect(main.getByText(words, { exact: false }).first()).toBeVisible()
    }
  })

  test('prints each phone number once, in the hero, and closes with one band', async ({ page }) => {
    await page.goto('/mad-ud-af-huset')

    const main = page.getByRole('main')
    const text = await main.innerText()
    for (const number of [PRIMARY_PHONE, SECONDARY_PHONE]) {
      if (number === null) continue
      expect(text.split(number).length - 1, `${number} should appear once in the page body`).toBe(1)
    }

    // One band, with the document's own heading on it and its own label on the button.
    await expect(main.getByRole('heading', { level: 2 })).toHaveCount(TAKEAWAY.sections.length)
    for (const section of TAKEAWAY.sections) {
      if (section.heading === null) continue
      await expect(main.getByRole('heading', { name: section.heading })).toBeVisible()
    }
    await expect(
      main.getByRole('link', { name: TAKEAWAY.ctaLabel, exact: true }),
    ).toHaveAttribute('href', PRIMARY_TEL_HREF)
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

  /**
   * The dishes drawn as **cards** — the only body that has a photo frame at all.
   *
   * `MenuCategorySection` picks a section's body from its content: a section any of
   * whose dishes carries a description gets photo cards, and a plain price list gets
   * two-column rows with no frame, reserved or otherwise. So both halves below are
   * scoped to the card sections, worked out the same way the renderer works them out
   * rather than from a list of section names.
   */
  const CARD_DISHES = MENU_CONTENT.categories
    .filter(
      (category) =>
        category.kind === 'dishes' && category.dishes.some((dish) => dish.description !== null),
    )
    .flatMap((category) => category.dishes)
    .map((dish) => EVERY_DISH.find((entry) => entry.id === dish.id)!)

  /** Every card dish that has selected a photograph, and every card dish that has not. */
  const ILLUSTRATED = CARD_DISHES.filter((dish) => dish.image !== null)
  const UNILLUSTRATED = CARD_DISHES.filter((dish) => dish.image === null)

  test('the menu renders every dish photograph from the derivative ladder alone', async ({
    page,
  }) => {
    test.skip(ILLUSTRATED.length === 0, 'no dish on the menu has selected a photograph')

    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))

    await page.goto('/menu')

    // Each illustrated dish draws *its own* selected photograph, at the rungs the build
    // rendered for that file and no others. Which dish has which picture, what its
    // description says and where its crop is anchored are all Pages CMS fields, so every
    // expectation below comes from the loaded dish rather than from a name typed here.
    for (const dish of ILLUSTRATED) {
      const image = dishImage(page, dish.name)
      const selected = dish.image!

      await expect(image, dish.name).toHaveAttribute('src', selected.src)
      await expect(image, dish.name).toHaveAttribute('alt', selected.alt)
      await expect(image, dish.name).toHaveAttribute('width', String(selected.width))
      await expect(image, dish.name).toHaveAttribute('height', String(selected.height))
      await expect(image, dish.name).toHaveAttribute('sizes', /rem/)

      const srcset = (await image.getAttribute('srcset')) ?? ''
      for (const candidate of selected.candidates) {
        expect(srcset, `${dish.name} @ ${candidate.width}`).toContain(
          `${candidate.webpUrl} ${candidate.width}w`,
        )
      }
      // Nothing above the top rung: the ladder stops where the photograph does.
      expect(srcset, dish.name).not.toMatch(
        new RegExp(`/${selected.candidates[selected.candidates.length - 1]!.width * 2}\\.`),
      )

      await expect(
        image.locator('xpath=..').locator('source[type="image/avif"]'),
        dish.name,
      ).toHaveCount(1)

      // The crop travels with the dish: a high anchor is a class on the <img>, and a
      // centred one adds none at all.
      if (selected.focus === 'upper') {
        await expect(image, dish.name).toHaveClass(/object-\[50%_20%\]/)
      } else {
        await expect(image, dish.name).not.toHaveClass(/object-\[/)
      }
    }

    // A dish with no photograph keeps its reserved frame rather than a stand-in (1h/1m),
    // and those frames are the only reserved ones on the page.
    for (const dish of UNILLUSTRATED) {
      const card = page
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: dish.name, exact: true }) })
      await expect(card.locator('picture'), dish.name).toHaveCount(0)
      await expect(card.locator('.media-placeholder'), dish.name).toHaveCount(1)
    }
    await expect(page.getByRole('main').locator('.media-placeholder')).toHaveCount(
      UNILLUSTRATED.length,
    )

    // The narrow dish slot takes the smallest rung at either width, once, as AVIF —
    // never the largest and never a source file.
    const first = ILLUSTRATED[0]!
    const slot = first.image!.src.split('/')[2]
    await expect(dishImage(page, first.name)).toBeVisible()
    await page.waitForLoadState('networkidle')
    const forFirst = requested.filter((url) => url.includes(`/media/${slot}/`))
    expect(forFirst).toHaveLength(1)
    expect(forFirst[0]).toMatch(
      new RegExp(`/${first.image!.candidates[0]!.width}\\.avif$`),
    )
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

  test('the Forside, Om os and Mad ud af huset carry the photographs their documents select', async ({
    page,
  }) => {
    const HOME = loadHomePage()
    const ABOUT = loadAboutPage()

    await page.goto('/')
    if (HOME.hero.image !== null) {
      const hero = page.locator('section[aria-labelledby="forside-titel"] picture img')
      await expect(hero).toHaveAttribute('src', HOME.hero.image.src)
      await expect(hero).toHaveAttribute('alt', HOME.hero.image.alt)
      // The page's primary photograph is the one image that loads eagerly.
      await expect(hero).toHaveAttribute('loading', 'eager')
    }
    if (HOME.aboutExcerpt.image !== null) {
      await expect(
        page.locator(`img[src="${HOME.aboutExcerpt.image.src}"]`).first(),
      ).toHaveAttribute('alt', HOME.aboutExcerpt.image.alt)
    }

    await page.goto('/om-os')
    if (ABOUT.venueImage !== null) {
      const venue = page.getByRole('main').locator(`img[src="${ABOUT.venueImage.src}"]`)
      await expect(venue).toHaveCount(1)
      await expect(venue).toHaveAttribute('alt', ABOUT.venueImage.alt)
    }

    await page.goto('/mad-ud-af-huset')
    if (TAKEAWAY.image !== null) {
      const takeaway = page.getByRole('main').locator('picture img')
      await expect(takeaway).toHaveAttribute('src', TAKEAWAY.image.src)
      await expect(takeaway).toHaveAttribute('alt', TAKEAWAY.image.alt)
    }
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
