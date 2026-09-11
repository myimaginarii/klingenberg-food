import { expect, test, type Locator, type Page } from '@playwright/test'

import { loadMenu } from '@/lib/content/load/menu'
import { loadAboutPage, loadHomePage, loadTakeawayPage } from '@/lib/content/load/pages'
import { planDerivatives } from '@/lib/images/derivatives'
import { readImageManifest } from '@/lib/images/manifest'

import { waitForPublicShell } from './support/public-shell'

/**
 * The photographs the static site renders — technical plan §1 (adjustment 3), §11.
 *
 * The promise: **every image a guest sees is a processed derivative the build wrote
 * into `public/media/`, served from this origin, at a rung the model actually planned.**
 * There is no storage service, no image proxy and no runtime resizing — the whole
 * pipeline ran once, at build time, over the tracked photographs in `public/photos/`,
 * and this suite reads back what a browser gets.
 *
 * The expectations come from the two generated-from-source facts and never from a
 * second copy of them: the manifest says what was measured, and the loaded content says
 * which photograph each surface selected and what its description is.
 *
 * Both widths run it, because the frames draw different slots at 375 and 1440 and
 * `sizes` must pick a different rung for each.
 */

/** What the build measured, as a list. */
const PHOTOS = Object.entries(readImageManifest().photos)

/**
 * Where each photograph is drawn, worked out from the content rather than listed.
 *
 * This used to be a written-down table of slots — `home-hero` on the Forside,
 * `dish-odin` on the menu — and every one of those is a Pages CMS choice: which picture
 * a frame draws is the "Billede" field on that frame, and a restaurant replacing a
 * photograph would have failed a test that named the one it replaced. So the placements
 * are derived: each surface's *selected* image names its own slot, and the page it is
 * drawn on is the page that owns that surface.
 */
const PLACEMENTS = (() => {
  const home = loadHomePage()
  const about = loadAboutPage()
  const takeaway = loadTakeawayPage()
  const dishes = loadMenu().categories.flatMap((category) => category.dishes)

  const slotOf = (src: string) => src.split('/')[2]!

  return [
    ...[home.hero.image, home.award.image, home.aboutExcerpt.image].map((image) => ({
      image,
      path: '/',
    })),
    ...[about.venueImage, about.team.image, about.method.image].map((image) => ({
      image,
      path: '/om-os/',
    })),
    { image: takeaway.image, path: '/mad-ud-af-huset/' },
    ...dishes.map((dish) => ({ image: dish.image, path: '/menu/' })),
  ]
    .filter((placement) => placement.image !== null)
    .map((placement) => ({ slot: slotOf(placement.image!.src), path: placement.path, image: placement.image! }))
})()

/** Every `<img>` the site serves from its own rendered derivative folder. */
function mediaImages(page: Page): Locator {
  return page.locator('img[src^="/media/"]')
}
test.describe('the rendered derivative ladder', () => {
  for (const { slot, path } of PLACEMENTS) {
    test(`${slot} is drawn on ${path} from its own /media folder`, async ({ page }) => {
      await page.goto(path)
      await waitForPublicShell(page)

      const image = page.locator(`img[src^="/media/${slot}/"]`).first()
      await expect(image).toBeAttached()

      // The `<picture>` offers AVIF before WebP, both over the same slot.
      const picture = image.locator('xpath=ancestor::picture[1]')
      await expect(picture).toBeAttached()
      const avif = picture.locator('source[type="image/avif"]')
      await expect(avif).toHaveAttribute('srcset', new RegExp(`^/media/${slot}/\\d+\\.avif `))

      // Intrinsic dimensions are stated, so the box is reserved before the bytes land.
      await expect(image).toHaveAttribute('width', /^\d+$/)
      await expect(image).toHaveAttribute('height', /^\d+$/)
    })
  }

  test('every rendered candidate is a file the build actually wrote', async ({ page, request }) => {
    await page.goto('/')
    await waitForPublicShell(page)

    const measured = new Map(PHOTOS)
    const sources = await mediaImages(page).evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLImageElement).getAttribute('src') ?? ''),
    )

    expect(sources.length).toBeGreaterThan(0)

    for (const source of sources) {
      const [, , slot, file] = source.split('/')
      const photo = measured.get(slot!)
      expect(photo, `${source} names a slot no photograph in public/photos/ produces`).toBeDefined()

      // The rung must be one `planDerivatives` chose for that source; nothing else exists.
      const planned = planDerivatives(photo!.width, photo!.height).map((size) => size.width)
      const width = Number(file!.split('.')[0])
      expect(planned, `${source} is not a planned rung`).toContain(width)

      const response = await request.get(source)
      expect(response.status(), source).toBe(200)
      expect(response.headers()['content-type']).toMatch(/^image\/(avif|webp)$/)
    }
  })

  /**
   * The source photographs are tracked under `public/`, so the export carries them.
   * That is the deliberate simplicity of the CMS media folder — but nothing the site
   * renders may point at one: a page that served an unprocessed original would be
   * downloading megabytes where it planned kilobytes.
   */
  test('no page points a browser at an unprocessed source photograph', async ({ page }) => {
    for (const path of ['/', '/menu/', '/om-os/', '/mad-ud-af-huset/']) {
      await page.goto(path)
      await waitForPublicShell(page)

      const referenced = await page
        .locator('img, source')
        .evaluateAll((nodes) =>
          nodes
            .flatMap((node) => [node.getAttribute('src') ?? '', node.getAttribute('srcset') ?? ''])
            .filter((value) => value.includes('/photos/')),
        )

      expect(referenced, path).toEqual([])
    }
  })

  test('every photograph carries the description its own field selected', async ({ page }) => {
    // Alternative text is Pages CMS's "Alternativ tekst" on every frame, and an empty
    // one is a deliberate answer: a dish photograph sits beside the heading that already
    // names the dish, so repeating it would be duplicate verbose text. Both answers are
    // asserted the same way — the page hears the field, whatever the field says.
    for (const path of [...new Set(PLACEMENTS.map((placement) => placement.path))]) {
      await page.goto(path)
      await waitForPublicShell(page)

      for (const placement of PLACEMENTS.filter((entry) => entry.path === path)) {
        await expect(
          page.locator(`img[src^="/media/${placement.slot}/"]`).first(),
          `${placement.slot} on ${path}`,
        ).toHaveAttribute('alt', placement.image.alt)
      }
    }
  })
})

test.describe('nothing is served from anywhere but this origin', () => {
  for (const { path } of [{ path: '/' }, { path: '/menu/' }, { path: '/om-os/' }, { path: '/mad-ud-af-huset/' }]) {
    test(`${path} loads no image from a foreign host`, async ({ page }) => {
      await page.goto(path)
      await waitForPublicShell(page)

      const foreign = await page
        .locator('img, source')
        .evaluateAll((nodes) =>
          nodes
            .flatMap((node) => [
              node.getAttribute('src') ?? '',
              node.getAttribute('srcset') ?? '',
            ])
            .filter((value) => /^[a-z]+:\/\//i.test(value)),
        )

      expect(foreign).toEqual([])
    })
  }
})
