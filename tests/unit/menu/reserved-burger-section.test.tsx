import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MenuCategorySection } from '@/components/site/menu/MenuCategorySection'
import { menuCategoriesFrom } from '@/lib/content/load/menu'
import { keepPriceTogether } from '@/lib/content/load/text'
import { BURGER_MENU_SECTION_ID } from '@/lib/content/types'
import type { MenuCategoryView } from '@/lib/menu/view'

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

function view(overrides: Partial<MenuCategoryView> = {}): MenuCategoryView {
  return {
    id: BURGER_MENU_SECTION_ID,
    slug: BURGER_MENU_SECTION_ID,
    anchorId: `menu-${BURGER_MENU_SECTION_ID}`,
    name: 'En overskrift restauranten selv har valgt',
    intro: null,
    note: null,
    kind: 'dishes',
    dishes: [
      {
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
      },
    ],
    ...overrides,
  }
}

/** The section as a page draws it, with no burger published — the card still says so. */
const drawn = (category: MenuCategoryView) =>
  renderToStaticMarkup(
    <MenuCategorySection
      category={category}
      weeklySpecial={null}
      monthlyBurger={null}
      tapas={{ priceOre: null, secondaryNote: null, groups: [] }}
    />,
  )

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
