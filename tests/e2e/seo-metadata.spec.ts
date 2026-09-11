import { expect, test, type Page } from '@playwright/test'

import { weeklyOpeningHoursJsonLd } from '@/lib/seo/restaurant'

import { ADDRESS_LINE, PRIMARY_TEL_HREF, PUBLIC_ROUTES, SCHEDULE } from './support/site'

/**
 * The metadata the static export actually ships — technical plan §11; phase 2B.
 *
 * The unit suites pin what the builders *return*; this pins what a crawler, a search
 * result and a pasted link *receive*, read out of the served HTML. That distinction has
 * teeth here: `og:image` is written into the source as a site-relative path and is
 * absolute only because Next resolves it against `metadataBase`, and the canonical URL
 * carries the deployment's own origin rather than a literal.
 *
 * THE SITE IS PRE-LAUNCH. `noindex, nofollow` on every page is asserted as a
 * requirement, not tolerated as a leftover: removing it is a deliberate launch step, and
 * this suite fails if it goes early.
 */

/** The absolute address of a site path, as the running deployment serves it. */
function absolute(baseURL: string, path: string): string {
  return new URL(path, baseURL).toString()
}

async function headContent(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) =>
      element instanceof HTMLLinkElement
        ? element.getAttribute('href') ?? ''
        : element.getAttribute('content') ?? '',
    ),
  )
}

test.describe('the six public pages', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} carries its title, canonical URL and share card`, async ({
      page,
      baseURL,
    }) => {
      await page.goto(route.path)
      const canonical = absolute(baseURL!, route.path)

      // Exactly one of each — a second title or canonical is the duplicate-metadata bug
      // a metadata refactor produces, and it is invisible in a browser.
      await expect(page).toHaveTitle(route.title)
      expect(await headContent(page, 'link[rel="canonical"]')).toEqual([canonical])
      expect(await headContent(page, 'meta[property="og:url"]')).toEqual([canonical])

      const [description] = await headContent(page, 'meta[name="description"]')
      expect(description, 'one description, and a real one').toBeTruthy()
      expect(description!.length).toBeGreaterThan(60)
      expect(description!.length).toBeLessThan(175)
      expect(description, 'no em dash in public prose').not.toContain('—')

      expect(await headContent(page, 'meta[property="og:title"]')).toEqual([route.title])
      expect(await headContent(page, 'meta[property="og:description"]')).toEqual([description])
      expect(await headContent(page, 'meta[property="og:site_name"]')).toEqual(['Klingenberg Food'])
      expect(await headContent(page, 'meta[property="og:locale"]')).toEqual(['da_DK'])
      expect(await headContent(page, 'meta[property="og:type"]')).toEqual(['website'])
      expect(await headContent(page, 'meta[name="twitter:card"]')).toEqual(['summary_large_image'])

      // One share image, absolute, served from this origin — never a dev path and never
      // a URL Next failed to resolve.
      const [ogImage] = await headContent(page, 'meta[property="og:image"]')
      expect(ogImage).toMatch(/^https?:\/\//)
      expect(ogImage!.startsWith(new URL('/', baseURL!).toString())).toBe(true)
      expect(ogImage).toContain('/media/')
      expect((await page.request.get(ogImage!)).status()).toBe(200)
    })

    test(`${route.path} is still noindex before launch`, async ({ page }) => {
      await page.goto(route.path)
      expect(await headContent(page, 'meta[name="robots"]')).toEqual(['noindex, nofollow'])
    })
  }

  test('no two pages share a title or a description', async ({ page }) => {
    const titles: string[] = []
    const descriptions: string[] = []

    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path)
      titles.push(await page.title())
      descriptions.push((await headContent(page, 'meta[name="description"]'))[0]!)
    }

    expect(new Set(titles).size).toBe(PUBLIC_ROUTES.length)
    expect(new Set(descriptions).size).toBe(PUBLIC_ROUTES.length)
  })

  test('every page has exactly one h1', async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path)
      await expect(page.locator('h1'), route.path).toHaveCount(1)
    }
  })
})

test.describe('the Restaurant structured data', () => {
  /** The parsed JSON-LD blocks of the current page. */
  async function jsonLdBlocks(page: Page): Promise<Record<string, unknown>[]> {
    const raw = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((elements) => elements.map((element) => element.textContent ?? ''))
    return raw.map((text) => JSON.parse(text) as Record<string, unknown>)
  }

  for (const path of ['/', '/find-os/']) {
    test(`${path} carries one valid Restaurant block`, async ({ page, baseURL }) => {
      await page.goto(path)
      const blocks = await jsonLdBlocks(page)

      expect(blocks).toHaveLength(1)
      const restaurant = blocks[0]!

      expect(restaurant['@context']).toBe('https://schema.org')
      expect(restaurant['@type']).toBe('Restaurant')
      // The same identifier on both pages: one business, described twice.
      expect(restaurant['@id']).toBe(`${absolute(baseURL!, '/')}#restaurant`)
      expect(restaurant.name).toBe('Klingenberg Food')
      expect(restaurant.url).toBe(absolute(baseURL!, '/'))
      expect(restaurant.hasMenu).toBe(absolute(baseURL!, '/menu/'))
      expect(restaurant.image).toMatch(/^https?:\/\/.*\/media\//)

      // The facts, as the page beside them prints them — read off the contact
      // document rather than written down, because the number is editable and the
      // address is not (`./support/site`).
      expect(restaurant.telephone).toBe(PRIMARY_TEL_HREF.replace('tel:', ''))
      expect(restaurant.address).toMatchObject({
        '@type': 'PostalAddress',
        streetAddress: ADDRESS_LINE.split(',')[0],
        addressCountry: 'DK',
      })
      // One entry per group of days that share their hours — however the week is set.
      expect(restaurant.openingHoursSpecification).toHaveLength(
        weeklyOpeningHoursJsonLd(SCHEDULE).length,
      )

      // Nothing anybody has answered with a guess.
      for (const property of ['geo', 'priceRange', 'aggregateRating', 'review', 'alternateName']) {
        expect(property in restaurant, property).toBe(false)
      }
    })
  }

  test('the pages that are not about the business carry no structured data', async ({ page }) => {
    for (const path of ['/menu/', '/om-os/', '/nyheder/', '/mad-ud-af-huset/']) {
      await page.goto(path)
      await expect(page.locator('script[type="application/ld+json"]'), path).toHaveCount(0)
    }
  })
})

test.describe('sitemap and robots', () => {
  test('the sitemap names the six public pages, absolute and trailing-slashed', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.status()).toBe(200)

    const xml = await response.text()
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!)

    expect(locations).toEqual(PUBLIC_ROUTES.map((route) => absolute(baseURL!, route.path)))
    for (const location of locations) expect(location.endsWith('/')).toBe(true)

    // Nothing from a retired administration, a rollback host, or a build that did not
    // know its own address.
    expect(xml).not.toContain('/admin')
    expect(xml).not.toContain('/api')
    expect(xml).not.toContain('github.io')
    expect(xml).not.toContain('klingenberg-food/')
    // The news *list* is one of the six, and the sitemap advertises the list alone: the
    // articles are paginated under it and each one is self-canonical (§7f). An address
    // that is not one of the six is a 404 a crawler was sent to, published or not.
    expect(locations.filter((location) => /\/nyheder\/.+/.test(location))).toEqual([])
  })

  test('robots.txt allows the crawl the noindex tag depends on', async ({ request, baseURL }) => {
    const response = await request.get('/robots.txt')
    expect(response.status()).toBe(200)

    const text = await response.text()
    expect(text).toContain('Allow: /')
    // A Disallow would stop a crawler before it could read the page's own noindex.
    expect(text).not.toContain('Disallow')
    expect(text).toContain(`Sitemap: ${absolute(baseURL!, '/sitemap.xml')}`)
  })
})

test.describe('the 404', () => {
  test('answers 404, refuses indexing and claims no address', async ({ page, baseURL }) => {
    const response = await page.goto('/en-adresse-der-ikke-findes/')

    expect(response?.status()).toBe(404)
    await expect(page).toHaveTitle('Siden findes ikke | Klingenberg Food')
    expect((await headContent(page, 'meta[name="robots"]')).every((value) =>
      value.includes('noindex'),
    )).toBe(true)

    // No canonical URL, no share card and no structured data for a page that is not one.
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
    await expect(page.locator('meta[property^="og:"]')).toHaveCount(0)
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0)
    expect(baseURL).toBeTruthy()
  })
})
