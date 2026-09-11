import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DishCard } from '@/components/site/menu/DishCard'
import { FeaturedDishCard } from '@/components/site/menu/FeaturedDishCard'
import { resolvePhoto } from '@/lib/content/load/photo'
import { readImageManifest } from '@/lib/images/manifest'
import { planDerivatives } from '@/lib/images/derivatives'
import type { DishView } from '@/lib/menu/view'

/**
 * The two approved dish frames — the crops and the no-image state the pre-launch pass
 * settled, after the photographs moved onto the dishes that show them.
 *
 * The photograph's **crop travels with the dish** (`focus`, a closed vocabulary), and
 * the **frame decides where its own shape holds it**: one selected photograph, one
 * `focus: upper`, and two frames that hold it differently — which is why the frame's
 * anchor is a class on the card and not a second copy of the image with a different
 * crop written into the content.
 *
 * **The dishes here are made up on purpose.** This suite used to drive the real menu —
 * Frigg for the high crop, Thor for the reserved frame, Odin for an ordinary one — and
 * every one of those is a Pages CMS field: the file, the description and the crop are
 * all the restaurant's, and a dish that gained a photograph or lost a crop would have
 * turned a frame test red without anything about the frames changing. So the dish is a
 * fixture and the *photograph* is real: resolved from `public/photos/` through the same
 * loader the content uses, so the URLs, the rungs and the ladder are the build's own.
 */

/** A real photograph from the library, as a content field would select it. */
const LIBRARY = Object.entries(readImageManifest().photos)

function photograph(kind: 'portrait' | 'landscape', focus: 'center' | 'upper' = 'center') {
  const entry = LIBRARY.find(([, measured]) =>
    kind === 'portrait' ? measured.height > measured.width : measured.width >= measured.height,
  )
  if (entry === undefined) throw new Error(`public/photos/ holds no ${kind} photograph`)

  const [slot, measured] = entry
  return {
    slot,
    measured,
    image: resolvePhoto({ file: `/photos/${measured.file}`, alt: '', focus }, `test ${slot}`)!,
  }
}

function dish(overrides: Partial<DishView> = {}): DishView {
  return {
    id: 'proeveret',
    name: 'Prøveret',
    description: null,
    secondaryNote: null,
    priceOre: 8900,
    labels: [],
    soldOutOn: null,
    featured: false,
    image: null,
    soldOut: false,
    ...overrides,
  }
}

/**
 * The featured card's own anchor, assembled rather than written.
 *
 * Tailwind scans this repository's sources for class names, tests and their comments
 * included, so writing the card's anchor out in full anywhere in this file would add
 * that bare utility to the shipped stylesheet — a rule no page uses, because the card
 * writes the descendant variant of it. Joining the halves keeps the assertion exact
 * and the stylesheet honest.
 */
const FEATURED_ANCHOR = ['object-[50%', '30%]'].join('_')

describe('one photograph, two frames', () => {
  const tall = photograph('portrait', 'upper')
  const high = dish({ image: tall.image })

  it('keeps the menu card anchored on the upper part of the plate', () => {
    expect(high.image?.focus).toBe('upper')

    const html = renderToStaticMarkup(<DishCard dish={high} />)

    // The selected crop is the class SiteImage puts on the <img> itself.
    expect(html).toContain('object-[50%_20%]')
    expect(html).toContain(`/media/${tall.slot}/`)
    // …and the menu card adds no anchor of its own.
    expect(html).not.toContain(FEATURED_ANCHOR)
  })

  it("keeps the Forside's featured card on its own 3:2 anchor", () => {
    const html = renderToStaticMarkup(<FeaturedDishCard dish={high} />)

    // 1g's three-up frame holds every burger — portraits among them — a little above
    // centre, and its descendant rule wins over the image's own class.
    expect(html).toContain(`[&amp;&gt;img]:${FEATURED_ANCHOR}`)
    expect(html).toContain(`/media/${tall.slot}/`)
  })

  it('draws the same photograph in both, at the rungs the build rendered', () => {
    const menu = renderToStaticMarkup(<DishCard dish={high} />)
    const forside = renderToStaticMarkup(<FeaturedDishCard dish={high} />)
    const rungs = planDerivatives(tall.measured.width, tall.measured.height).map(
      (size) => size.width,
    )

    for (const html of [menu, forside]) {
      for (const width of rungs) {
        expect(html, `${tall.slot} @ ${width}`).toContain(`/media/${tall.slot}/${width}.avif ${width}w`)
      }
      // Nothing is upscaled past the source: the ladder stops where the photograph does.
      expect(html).not.toContain(`/media/${tall.slot}/${Math.max(...rungs) * 2}.`)
      expect(html).not.toContain('/photos/')
    }
  })
})

describe('a dish with no photograph', () => {
  it('renders the reserved "Retfoto" frame rather than a faked photograph', () => {
    const bare = dish({ image: null })

    for (const html of [
      renderToStaticMarkup(<DishCard dish={bare} />),
      renderToStaticMarkup(<FeaturedDishCard dish={bare} />),
    ]) {
      expect(html).toContain('Retfoto')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('/media/')
      expect(html).not.toContain('/photos/')
    }
  })
})

describe('a dish that does have a photograph', () => {
  it('draws it with the description it carries, and centres it by default', () => {
    const centred = photograph('landscape')
    const html = renderToStaticMarkup(<DishCard dish={dish({ image: centred.image })} />)

    // The dish photographs sit beside a heading that already names the dish, so an
    // empty description renders alt="" rather than a repetition of the name.
    expect(html).toContain('alt=""')
    expect(html).toContain(`/media/${centred.slot}/`)
    expect(html).not.toContain('Retfoto')
    // Centred is the default and adds no class at all.
    expect(html).not.toContain('object-[50%_20%]')
  })

  it('prints the description the field carries rather than the dish’s name', () => {
    const described = resolvePhoto(
      { file: `/photos/${LIBRARY[0]![1].file}`, alt: 'En tallerken set oppefra.' },
      'test',
    )!
    const html = renderToStaticMarkup(<DishCard dish={dish({ image: described })} />)

    expect(html).toContain('alt="En tallerken set oppefra."')
    expect(html).not.toContain('alt="Prøveret"')
  })
})
