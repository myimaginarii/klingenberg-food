import { MONTHLY_BURGER_MENU_SECTION_SLUG } from '@/lib/menu/monthly'
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
 *  * a section holding an entry with a tapas document is the tapas board;
 *  * a section whose dishes are **described** gets photo cards, and a plain price list
 *    gets two-column rows — which is exactly how the design separates Burgere from
 *    Andre retter, Pommes & snacks, Børn, Drikkevarer, Dessert and Varm selv.
 *
 * The one placement that is genuinely fixed by the design rather than by data is
 * Månedens burger, which sits at the end of Burgere (1h).
 */
const MONTHLY_BURGER_CATEGORY_SLUG = MONTHLY_BURGER_MENU_SECTION_SLUG

export function MenuCategorySection({
  category,
  weeklySpecial,
  monthlyBurger,
  first = false,
}: {
  category: MenuCategoryView
  weeklySpecial: WeeklySpecialView | null
  monthlyBurger: MonthlyBurgerView | null
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
        first={first}
      />
    </MenuSection>
  )
}

function CategoryBody({
  category,
  weeklySpecial,
  monthlyBurger,
  first,
}: {
  category: MenuCategoryView
  weeklySpecial: WeeklySpecialView | null
  monthlyBurger: MonthlyBurgerView | null
  first: boolean
}) {
  if (category.kind === 'weekly_special') {
    return weeklySpecial === null ? null : <WeeklySpecial weekly={weeklySpecial} />
  }

  const tapas = category.dishes.find((dish) => dish.tapas !== null)
  if (tapas !== undefined) return <TapasTable dish={tapas} />

  const showsMonthlyBurger = category.slug === MONTHLY_BURGER_CATEGORY_SLUG
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
