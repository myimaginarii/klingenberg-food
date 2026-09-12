import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MenuCategorySection } from '@/components/site/menu/MenuCategorySection'
import { menuCategoriesFrom } from '@/lib/content/load/menu'
import { keepPriceTogether } from '@/lib/content/load/text'
import { BURGER_MENU_SECTION_ID } from '@/lib/content/types'
import type { DishView, MenuCategoryView, MonthlyBurgerView } from '@/lib/menu/view'

/**
 * What the reserved section id is actually *for* — the two places that address a menu
 * section by id rather than by its heading.
 *
 * `lib/content/validate/menu.ts` refuses a menu that has renamed or deleted
 * `BURGER_MENU_SECTION_ID`, which is only worth doing while the application still reads
 * that id. So this is the other half of the same guard: it asks the renderer and the
 * loader which section they single out, rather than restating an answer, so a change
 * that moved Månedens burger somewhere else — or dropped the typography rule — cannot
 * leave the validator defending a requirement nothing has any more.
 *
 * Nothing here reads `content/site/`. The sections below are made up, and the *only*
 * thing that comes from the repository is the reserved id itself: a suite that drove the
 * real Burgere section would go red the day the restaurant reworded its introduction,
 * which is precisely the coupling the CMS-editability audit removed everywhere else.
 */

const NO_BREAK_SPACE = String.fromCharCode(0xa0)

function dish(overrides: Partial<DishView> = {}): DishView {
  return {
    id: 'en-ret',
    name: 'En ret',
    description: 'En beskrivelse, så afsnittet tegnes som kort.',
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

function view(overrides: Partial<MenuCategoryView> = {}): MenuCategoryView {
  return {
    id: BURGER_MENU_SECTION_ID,
    slug: BURGER_MENU_SECTION_ID,
    anchorId: `menu-${BURGER_MENU_SECTION_ID}`,
    name: 'En overskrift restauranten selv har valgt',
    intro: null,
    note: null,
    kind: 'dishes',
    dishes: [dish()],
    ...overrides,
  }
}

/** The same section after the restaurant has cleared every description — a price list. */
const asPriceList = (category: MenuCategoryView): MenuCategoryView => ({
  ...category,
  dishes: category.dishes.map((entry) => ({ ...entry, description: null })),
})

/** The section as a page draws it, with no burger published unless one is handed in. */
const drawn = (category: MenuCategoryView, burger: MonthlyBurgerView | null = null) =>
  renderToStaticMarkup(
    <MenuCategorySection
      category={category}
      weeklySpecial={null}
      monthlyBurger={burger}
      tapas={{ priceOre: null, secondaryNote: null, groups: [] }}
    />,
  )

/** How many cards the section drew: a dish card, or the burger card, is one `article`. */
const cards = (html: string) => html.split('<article').length - 1

describe('Månedens burger is placed by the reserved section id', () => {
  it('draws the card in the section carrying that id, whatever the heading says', () => {
    expect(drawn(view())).toContain('Månedens burger')
    expect(drawn(view({ name: 'Noget helt andet' }))).toContain('Månedens burger')
  })

  it('draws it in no other section, however much the section looks like one', () => {
    expect(drawn(view({ id: 'burgers', slug: 'burgers' }))).not.toContain('Månedens burger')
    expect(drawn(view({ id: 'burger', slug: 'burger', name: 'Burgere' }))).not.toContain(
      'Månedens burger',
    )
  })
})

/**
 * The id, and *only* the id.
 *
 * Whether the dishes in a section are described is the restaurant's content: a
 * description is optional on every dish on the menu, and clearing the last one in the
 * reserved section is an ordinary save the CMS allows and the validator accepts. It
 * changes how those dishes are drawn — photo cards become a two-column price list — and
 * it used to also take Månedens burger off the menu, because the burger card was a child
 * of the photo-card list. That made the reserved id a half-guard: the section was still
 * there, still carried the id, and the burger was gone anyway.
 */
describe('the dishes decide their own presentation, never whether the burger is drawn', () => {
  const twoDishes = [dish({ id: 'frigg', name: 'Frigg' }), dish({ id: 'thor', name: 'Thor' })]
  const last = (html: string, needle: string) => html.lastIndexOf(needle)

  it('draws the card after described dishes, which the section draws as photo cards', () => {
    const html = drawn(view({ dishes: twoDishes }))

    expect(cards(html)).toBe(3)
    expect(html).toContain('Månedens burger')
    expect(last(html, 'Thor')).toBeLessThan(html.indexOf('Månedens burger'))
  })

  it('draws the card after the dishes when every description has been cleared', () => {
    const html = drawn(asPriceList(view({ dishes: twoDishes })))

    expect(html).not.toContain('En beskrivelse')
    // One card only: the burger's. The dishes became price rows, which are not cards.
    expect(cards(html)).toBe(1)
    expect(html).toContain('Frigg')
    expect(last(html, 'Thor')).toBeLessThan(html.indexOf('Månedens burger'))
  })

  it('draws the published burger beside a price list, not only the empty card', () => {
    const burger: MonthlyBurgerView = {
      name: 'Septemberburgeren',
      description: null,
      priceOre: 13900,
      startsOn: null,
      endsOn: null,
      soldOutOn: null,
      showOnHomepage: false,
      image: null,
      soldOut: false,
    }
    const html = drawn(asPriceList(view({ dishes: twoDishes })), burger)

    expect(html).toContain('Septemberburgeren')
    expect(last(html, 'Thor')).toBeLessThan(html.indexOf('Septemberburgeren'))
  })

  /**
   * The reserved section exists to host Månedens burger, so an empty one is a section
   * waiting for dishes — not a reason to take the burger off the menu. "No dishes" is a
   * state the validator allows on purpose (a section an editor has just created), and
   * the burger is published in its own document either way.
   */
  it('draws the card in the reserved section even when it holds no dishes at all', () => {
    const html = drawn(view({ dishes: [] }))

    expect(cards(html)).toBe(1)
    expect(html).toContain('Månedens burger')
  })

  it('draws it in no price list outside the reserved section', () => {
    const html = drawn(asPriceList(view({ id: 'drikkevarer', slug: 'drikkevarer' })))

    expect(cards(html)).toBe(0)
    expect(html).not.toContain('Månedens burger')
  })
})

describe('the joined price typography follows the same reserved id', () => {
  const loaded = (id: string, intro: string) =>
    menuCategoriesFrom({ categories: [{ id, name: 'Et afsnit', intro }] }, 'fixture')[0]!.intro

  it('joins each price to “kr.” in the reserved section’s introduction', () => {
    const written = 'Som menu: 124 kr., og 132 kr. for den store.'

    expect(loaded(BURGER_MENU_SECTION_ID, written)).toBe(keepPriceTogether(written))
    expect(loaded(BURGER_MENU_SECTION_ID, written)).toContain(NO_BREAK_SPACE)
  })

  it('leaves every other section’s introduction the text as written', () => {
    const written = 'Som menu: 124 kr.'

    for (const id of ['drikkevarer', 'burgers', 'andre-retter']) {
      expect(loaded(id, written), id).toBe(written)
      expect(loaded(id, written), id).not.toContain(NO_BREAK_SPACE)
    }
  })
})
