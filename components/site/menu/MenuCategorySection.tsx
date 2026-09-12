import { BURGER_MENU_SECTION_ID, type TapasBoard } from '@/lib/content/types'
import type { MenuCategoryView, MonthlyBurgerView, WeeklySpecialView } from '@/lib/menu/view'

import { DishCard } from './DishCard'
import { DishPriceRow } from './DishPriceRow'
import { MenuSection } from './MenuSection'
import { MonthlyBurgerCard } from './MonthlyBurgerCard'
import { TapasTable } from './TapasTable'
import { WeeklySpecial } from './WeeklySpecial'

/**
 * One of the nine sections, with the body its content calls for — design 1h, 1m.
 *
 * The approved menu draws three different bodies, and which one a section gets follows
 * from the content rather than from a hard-coded list of names:
 *
 *  * a section whose `kind` is `weekly_special` is Ugens ret and Lørdagsmenu;
 *  * a section whose `kind` is `tapas` is the tapas board;
 *  * a section whose dishes are **described** gets photo cards, and a plain price list
 *    gets two-column rows — which is exactly how the design separates Burgere from
 *    Andre retter, Pommes & snacks, Børn, Drikkevarer, Dessert and Varm selv.
 *
 * The first two sections draw one *other* document each and hold no dishes of their
 * own; the restaurant decides whether and where on the card they appear by keeping,
 * removing or moving the section.
 *
 * The one placement that is genuinely fixed by the design rather than by data is
 * Månedens burger, which sits at the end of Burgere (1h). That section is found by the
 * reserved `BURGER_MENU_SECTION_ID` and not by its heading, which the restaurant may
 * reword; `lib/content/validate/menu.ts` keeps the id itself in the document.
 */

export function MenuCategorySection({
  category,
  weeklySpecial,
  monthlyBurger,
  tapas,
  first = false,
}: {
  category: MenuCategoryView
  weeklySpecial: WeeklySpecialView | null
  monthlyBurger: MonthlyBurgerView | null
  tapas: TapasBoard
  /** The page's first section: its first photo is above the fold and loads eagerly. */
  first?: boolean
}) {
  return (
    <MenuSection
      id={category.anchorId}
      title={category.name}
      intro={category.intro}
      note={category.note}
    >
      <CategoryBody
        category={category}
        weeklySpecial={weeklySpecial}
        monthlyBurger={monthlyBurger}
        tapas={tapas}
        first={first}
      />
    </MenuSection>
  )
}

function CategoryBody({
  category,
  weeklySpecial,
  monthlyBurger,
  tapas,
  first,
}: {
  category: MenuCategoryView
  weeklySpecial: WeeklySpecialView | null
  monthlyBurger: MonthlyBurgerView | null
  tapas: TapasBoard
  first: boolean
}) {
  if (category.kind === 'weekly_special') {
    return weeklySpecial === null ? null : <WeeklySpecial weekly={weeklySpecial} />
  }

  if (category.kind === 'tapas') return <TapasTable board={tapas} />

  const showsMonthlyBurger = category.slug === BURGER_MENU_SECTION_ID
  const asCards = category.dishes.some((dish) => dish.description !== null)

  if (asCards) {
    return (
      <div className="flex flex-col gap-3.5">
        {category.dishes.map((dish, index) => (
          <DishCard key={dish.id} dish={dish} loading={first && index === 0 ? 'eager' : 'lazy'} />
        ))}
        {showsMonthlyBurger ? <MonthlyBurgerCard burger={monthlyBurger} /> : null}
      </div>
    )
  }

  return (
    <div className="grid md:grid-cols-2 md:gap-x-11">
      {category.dishes.map((dish) => (
        <DishPriceRow key={dish.id} dish={dish} />
      ))}
    </div>
  )
}
