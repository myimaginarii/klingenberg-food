import type { MenuCategoryView } from '@/lib/menu/view'

import { PageContainer } from '../PageContainer'

/**
 * The category bar — design 1h (sticky, wrapping) and 1m (horizontally scrolling chips).
 *
 * One row of links at both sizes: it scrolls sideways on a phone and wraps on a wide
 * screen, which is a difference in overflow behaviour rather than in structure. Each
 * chip is an ordinary in-page anchor, so the bar works with JavaScript disabled, is in
 * the tab order, and each target is at least 44 px tall (1aa, 1m). 1h draws the chips
 * 40 px tall on a wide screen; 1aa's own rule — "Tryk-mål mindst 44 × 44 px" — and the
 * mobile frame both say 44, so 44 it is at every width.
 *
 * The approved frames tint the first chip to show which section you are in. That state
 * needs scroll tracking, which needs JavaScript on a page that otherwise ships none, so
 * it is deliberately not built: the chips are a way to jump, and the heading you land on
 * already says where you are.
 */
export function MenuCategoryNav({ categories }: { categories: readonly MenuCategoryView[] }) {
  return (
    <nav
      aria-label="Menuens kategorier"
      className="border-border bg-bg/95 sticky top-0 z-20 border-b backdrop-blur-[6px]"
    >
      <PageContainer className="py-2.5 md:py-3">
        <ul className="chip-scroller flex gap-2 overflow-x-auto md:flex-wrap md:overflow-x-visible">
          {categories.map((category) => (
            <li key={category.id} className="shrink-0">
              <a
                href={`#${category.anchorId}`}
                className="border-border bg-surface text-ink rounded-badge hover:border-brand-700 hover:text-brand-700 flex min-h-tap items-center border px-4 text-[0.875rem] font-medium whitespace-nowrap no-underline md:text-[0.90625rem]"
              >
                {category.name}
              </a>
            </li>
          ))}
        </ul>
      </PageContainer>
    </nav>
  )
}
