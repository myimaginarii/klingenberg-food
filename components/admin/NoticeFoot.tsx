/**
 * The foot of a phone screen — design 1y; technical plan §15 (phases 12A and 12C).
 *
 * 1y draws the things that *just happened* — the green Fortryd strip, the pending band —
 * at the bottom of the phone screen, under the thumb, rather than at the top of the page
 * where the address's fragment has just scrolled them out of sight. Phase 12A built that
 * for the Menu as one container inline in the menu page; phase 12C measured the same
 * defect on Ugens ret, Månedens burger, Åbningstider and Besked på hjemmesiden (every
 * strip 115–1,694 px above the viewport at the moment it appeared) and made the
 * container this one component, so the five screens share exactly one arrangement
 * rather than five that drift.
 *
 * WHAT IT IS, AND WHAT IT IS NOT
 *
 * It is a **container** and nothing else. It knows no sentence, no action, no entity and
 * no rule: what goes into it — a status notice, a strip, a band — is each screen's own
 * decision, made in the screen's own domain, exactly as before. Below `md` it is `sticky`
 * to the bottom of the viewport and visually last (`order-last`) while staying **first in
 * the DOM**, where the notices have always been: the tab order and a screen reader's
 * reading order are unchanged at every width, and a live region is already in the tree
 * before its text arrives. From `md` it is an ordinary block exactly where the notices
 * were drawn before. `empty:hidden` takes it away when nothing renders inside it — every
 * notice returns `null` for a status it does not know, and the strips remove themselves
 * after ten seconds — so an empty foot never draws a border or a gap.
 *
 * `.admin-foot` is the hook `app/globals.css` uses for `scroll-padding-bottom` below `md`,
 * so a control the browser scrolls into view at the bottom edge lands above the foot, not
 * under it. The main column's `py-6` is what `-mb-6` undoes, so the foot sits flush with
 * the bottom of the screen; every screen that uses it has that padding.
 */
export function NoticeFoot({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-foot flex flex-col gap-3 empty:hidden max-md:sticky max-md:bottom-0 max-md:z-10 max-md:order-last max-md:-mx-gutter max-md:-mb-6 max-md:border-t max-md:border-border max-md:bg-bg max-md:px-gutter max-md:py-3 md:gap-4">
      {children}
    </div>
  )
}
