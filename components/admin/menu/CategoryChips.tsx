import Link from 'next/link'

import { mayHoldDishes, type AdminMenuSection } from '@/lib/menu/admin'

/**
 * The section navigation — design 1r (desktop) and 1y (mobile).
 *
 * The two frames draw the same chips and differ in two specific ways, both of which
 * are honoured here rather than approximated by shrinking the desktop row:
 *
 *   * **Desktop wraps and counts.** 1r shows "Burgere (6)", "Ugens ret (1)" … on as
 *     many lines as it takes, beside "+ Tilføj ret".
 *   * **The phone scrolls and does not count.** 1y shows one row of chips that runs
 *     off the right edge, with no counts at all — there is no room for them and they
 *     are not what a person is looking for on a phone.
 *
 * So the count is rendered but hidden below the `md` breakpoint, which keeps one list
 * of links, one active state and one tab order for both. The count stays in the
 * accessible name at every width, because "Burgere, 6 retter" is useful to a screen
 * reader on a phone even though the number does not fit on the screen.
 *
 * Each chip is a real link to this screen's own address, so the section survives a
 * reload, can be linked to, and works with no JavaScript. The active chip carries
 * `aria-current="page"`, which is what tells a screen reader which one is open — the
 * burgundy fill alone would be colour carrying meaning (1aa).
 */
export function CategoryChips({
  sections,
  activeSlug,
  hrefFor,
}: {
  sections: readonly AdminMenuSection[]
  activeSlug: string | null
  hrefFor: (slug: string) => string
}) {
  return (
    <nav aria-label="Menuens sektioner">
      {/* One row that scrolls on a phone (1y) and wraps from the md breakpoint (1r). */}
      <ul className="chip-scroller -mx-gutter flex gap-2 overflow-x-auto px-gutter md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {sections.map(({ category, dishCount }) => {
          const active = category.slug === activeSlug
          // Ugens ret holds no dishes at all — it is the `weekly_special` row (§4) — so
          // it gets no count rather than a "(0)" that reads like an empty section.
          const counted = mayHoldDishes(category)

          return (
            <li className="shrink-0" key={category.id}>
              <Link
                aria-current={active ? 'page' : undefined}
                className={`rounded-badge min-h-tap inline-flex items-center gap-1 px-4 text-meta whitespace-nowrap ${
                  active
                    ? 'bg-brand-700 font-semibold text-white'
                    : 'border-border text-ink hover:border-rule border font-medium'
                }`}
                href={hrefFor(category.slug)}
              >
                {category.name}
                {counted ? (
                  <>
                    <span className="sr-only">{`, ${String(dishCount)} retter`}</span>
                    <span aria-hidden="true" className="hidden md:inline">
                      ({dishCount})
                    </span>
                  </>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
