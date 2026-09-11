'use client'

import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

import { MENU_CLOSE_DELAY_MS, type SiteRoute } from '@/lib/site/navigation'

/**
 * The fullscreen menu's open state, and the two ways it ends — design 1n.
 *
 * The panel is a `<details>` element and stays one: the browser owns opening it, the
 * `aria-expanded` announcement and the whole thing working with JavaScript disabled
 * (§7e, item 11), which is what makes four of the six pages reachable from a phone
 * without scripting. This module adds the one thing the browser cannot know about — a
 * client-side route change leaves the layout, and therefore the open panel, mounted —
 * and adds it as an enhancement layered on top, never as a replacement.
 *
 * Two closes, because a navigation can happen two ways:
 *
 *   * `onNavigate` on each link in the panel, which the framework calls only for a
 *     same-origin client-side navigation — so a modifier-click opening a new tab, or a
 *     `tel:` link, leaves the panel alone. It fires for the page you are already on as
 *     well, which is the case a pathname watcher alone would miss.
 *   * the pathname, for a navigation the panel did not start: Back and Forward, or the
 *     persistent bottom bar behind it.
 *
 * The first of those is also held back a moment. Left to itself the framework swaps the
 * page in the same frame the panel disappears, and on a phone the two changes land as
 * one abrupt cut, with the new page visible for an instant under the panel that is
 * still going. So a tap in the panel closes it first and asks the router for the page
 * `MENU_CLOSE_DELAY_MS` later — long enough to read as "the menu went, then the page came",
 * short enough never to feel like waiting. The event's own `preventDefault()` is what
 * holds the framework's navigation back, so nothing about the link changes: the href is
 * a real address, a modifier-click and a new tab never reach this code, and a visitor
 * without scripting was never in it. A visitor who asked for less motion gets the page
 * at once, because for them the pause is not a transition but a delay.
 *
 * Escape closes it too. A plain `<details>` has no Escape behaviour of its own — the
 * browser gives that only to a dialog or a popover — so a fullscreen panel covering the
 * whole viewport had no keyboard way out but tabbing back to the ×. That is the one
 * behaviour here that a visitor without scripting does not get; the × is still their
 * way out, and it is the same single control it has always been.
 *
 * Closing returns focus to the summary — the control that opened the panel — whenever
 * focus was inside it, so a keyboard or screen-reader user is never left on an element
 * that has just been hidden. That holds after a real navigation as well: the router
 * leaves focus where it found it, and the summary is a place to carry on from at the
 * top of the page you asked for.
 */

/** What the panel hands a link inside it: the framework's navigation event, and where the link goes. */
export type MenuNavigateHandler = (event: { preventDefault(): void }, href: SiteRoute) => void

const MenuNavigateContext = createContext<MenuNavigateHandler | null>(null)

/** The enclosing panel's navigation handle, or `null` outside one (the desktop bar, the footer). */
export function useMobileMenuNavigate(): MenuNavigateHandler | null {
  return useContext(MenuNavigateContext)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function MobileMenuDisclosure({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  // The pathname the panel has already been told about. Set at the first render rather
  // than in the effect, so hydration cannot close a panel a visitor opened while the
  // page was still loading.
  const settled = useRef(pathname)
  // The one navigation the panel is holding back, if any. A second tap while it is
  // pending — the same link, or another one, before the panel has left the screen —
  // must not queue a second route change behind the first.
  const pending = useRef<number | null>(null)

  const close = useCallback(() => {
    const details = ref.current
    if (!details?.open) return

    const returnFocus = details.contains(document.activeElement)
    details.open = false

    if (returnFocus) {
      details.querySelector('summary')?.focus({ preventScroll: true })
    }
  }, [])

  const navigate = useCallback<MenuNavigateHandler>(
    (event, href) => {
      if (pending.current !== null) {
        event.preventDefault()
        return
      }

      close()

      if (prefersReducedMotion()) return

      event.preventDefault()
      pending.current = window.setTimeout(() => {
        pending.current = null
        router.push(href)
      }, MENU_CLOSE_DELAY_MS)
    },
    [close, router],
  )

  useEffect(() => {
    if (settled.current === pathname) return
    settled.current = pathname
    close()
  }, [close, pathname])

  useEffect(() => {
    // One listener for the life of the page rather than one added and removed around
    // each opening: it asks the element itself whether it is open, so there is no second
    // copy of the open state to keep in step with the browser's.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && ref.current?.open) close()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  useEffect(() => {
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current)
    }
  }, [])

  return (
    <MenuNavigateContext.Provider value={navigate}>
      <details ref={ref} className={className}>
        {children}
      </details>
    </MenuNavigateContext.Provider>
  )
}
