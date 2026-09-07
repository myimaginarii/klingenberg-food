import { expect, test, type Locator, type Page } from '@playwright/test'

import photos from '@/content/site/photos.json'
import { planDerivatives } from '@/lib/images/derivatives'

import { waitForPublicShell } from './support/public-shell'

/**
 * The photographs the static site renders — technical plan §1 (adjustment 3), §11.
 *
 * The promise: **every image a guest sees is a processed derivative the build wrote
 * into `public/media/`, served from this origin, at a rung the model actually planned.**
 * There is no storage service, no image proxy and no runtime resizing — the whole
 * pipeline ran once, at build time, from the five tracked photographs in
 * `content/site/photos.json`, and this suite reads back what a browser gets.
 *
 * Both widths run it, because the frames draw different slots at 375 and 1440 and
 * `sizes` must pick a different rung for each.
 */

/** The tracked registry, as a list. */
const PHOTOS = Object.entries(photos.photos) as [
  string,
  { file: string; width: number; height: number; alt: string | null },
][]

/** Where each slot is drawn, so a rendered page can be checked rather than the JSON. */
const PLACEMENTS = [
  { slot: 'home-hero', path: '/' },
  { slot: 'about-venue', path: '/om-os/' },
  { slot: 'takeaway', path: '/mad-ud-af-huset/' },
  { slot: 'dish-odin', path: '/menu/' },
  { slot: 'dish-ragnar', path: '/menu/' },
] as const

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

    const registry = new Map(PHOTOS)
    const sources = await mediaImages(page).evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLImageElement).getAttribute('src') ?? ''),
    )

    expect(sources.length).toBeGreaterThan(0)

    for (const source of sources) {
      const [, , slot, file] = source.split('/')
      const photo = registry.get(slot!)
      expect(photo, `${source} names a slot that is not in photos.json`).toBeDefined()

      // The rung must be one `planDerivatives` chose for that source; nothing else exists.
      const planned = planDerivatives(photo!.width, photo!.height).map((size) => size.width)
      const width = Number(file!.split('.')[0])
      expect(planned, `${source} is not a planned rung`).toContain(width)

      const response = await request.get(source)
      expect(response.status(), source).toBe(200)
      expect(response.headers()['content-type']).toMatch(/^image\/(avif|webp)$/)
    }
  })

  test('the tracked description is what a screen reader hears', async ({ page }) => {
    await page.goto('/')
    await waitForPublicShell(page)

    const hero = page.locator('img[src^="/media/home-hero/"]').first()
    await expect(hero).toHaveAttribute('alt', photos.photos['home-hero'].alt!)
  })

  test('a photograph with no tracked description renders alt="" rather than an invented one', async ({
    page,
  }) => {
    await page.goto('/menu/')
    await waitForPublicShell(page)

    // Both dish photographs are tracked with `alt: null` — they sit beside the dish
    // heading that already names them, so repeating it would be duplicate verbose text.
    for (const slot of ['dish-odin', 'dish-ragnar']) {
      expect(photos.photos[slot as 'dish-odin'].alt).toBeNull()
      await expect(page.locator(`img[src^="/media/${slot}/"]`).first()).toHaveAttribute('alt', '')
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
