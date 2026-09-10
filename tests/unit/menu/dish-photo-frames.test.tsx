import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DishCard } from '@/components/site/menu/DishCard'
import { FeaturedDishCard } from '@/components/site/menu/FeaturedDishCard'
import { loadOpeningHours } from '@/lib/content/load/hours'
import { loadMenu } from '@/lib/content/load/menu'
import { buildMenuView } from '@/lib/menu/view'
import type { DishView } from '@/lib/menu/view'

/**
 * The two approved dish frames, drawn from the real menu — the crops and the no-image
 * state the pre-launch pass settled, held to after the photographs moved onto the
 * dishes that show them.
 *
 * The photograph's **crop travels with the dish** (`focus`, a closed vocabulary), and
 * the **frame decides where its own shape holds it**. Frigg is the case that proves
 * both: one selected photograph, one `focus: upper`, and two frames that hold it
 * differently — which is why the frame's anchor is a class on the card and not a
 * second copy of the image with a different crop written into the content.
 */

const VIEW = buildMenuView(loadMenu(), loadOpeningHours(), new Date('2026-09-10T12:00:00+02:00'))
const DISHES = VIEW.categories.flatMap((category) => category.dishes)

function dish(id: string): DishView {
  const found = DISHES.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`the menu has no dish "${id}"`)
  return found
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

describe('Frigg — one photograph, two frames', () => {
  it('keeps the menu card anchored on the upper part of the plate', () => {
    const frigg = dish('frigg')
    expect(frigg.image?.focus).toBe('upper')

    const html = renderToStaticMarkup(<DishCard dish={frigg} />)

    // The selected crop is the class SiteImage puts on the <img> itself.
    expect(html).toContain('object-[50%_20%]')
    expect(html).toContain('/media/dish-frigg/')
    // …and the menu card adds no anchor of its own.
    expect(html).not.toContain(FEATURED_ANCHOR)
  })

  it("keeps the Forside's featured card on its own 3:2 anchor", () => {
    const html = renderToStaticMarkup(<FeaturedDishCard dish={dish('frigg')} />)

    // 1g's three-up frame holds every burger — two of the three are portraits — a
    // little above centre, and its descendant rule wins over the image's own class.
    expect(html).toContain(`[&amp;&gt;img]:${FEATURED_ANCHOR}`)
    expect(html).toContain('/media/dish-frigg/')
  })

  it('draws the same photograph in both, at the rungs the build rendered', () => {
    const frigg = dish('frigg')
    const menu = renderToStaticMarkup(<DishCard dish={frigg} />)
    const forside = renderToStaticMarkup(<FeaturedDishCard dish={frigg} />)

    for (const html of [menu, forside]) {
      expect(html).toContain('/media/dish-frigg/480.avif 480w')
      expect(html).toContain('/media/dish-frigg/960.webp 960w')
      // 1086 px wide: the ladder stops at 960 and nothing is upscaled to 1440.
      expect(html).not.toContain('/media/dish-frigg/1440.')
      expect(html).not.toContain('/photos/')
    }
  })
})

describe('Thor — the dish with no photograph', () => {
  it('renders the reserved "Retfoto" frame rather than a faked photograph', () => {
    const thor = dish('thor')
    expect(thor.image).toBeNull()

    for (const html of [
      renderToStaticMarkup(<DishCard dish={thor} />),
      renderToStaticMarkup(<FeaturedDishCard dish={thor} />),
    ]) {
      expect(html).toContain('Retfoto')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('/media/')
      expect(html).not.toContain('/photos/')
    }
  })
})

describe('a dish that does have a photograph', () => {
  it('draws it with an empty description, because the heading beside it names the dish', () => {
    const html = renderToStaticMarkup(<DishCard dish={dish('odin')} />)

    expect(html).toContain('alt=""')
    expect(html).toContain('/media/dish-odin/')
    expect(html).not.toContain('Retfoto')
    // Centred is the default and adds no class at all.
    expect(html).not.toContain('object-[50%_20%]')
  })
})
