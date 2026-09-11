'use client'

import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

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
const CloseMenuContext = createContext<(() => void) | null>(null)

/** The enclosing panel's close handle, or `null` outside one (the desktop bar, the footer). */
export function useCloseMobileMenu(): (() => void) | null {
  return useContext(CloseMenuContext)
}

export function MobileMenuDisclosure({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const pathname = usePathname()
  // The pathname the panel has already been told about. Set at the first render rather
  // than in the effect, so hydration cannot close a panel a visitor opened while the
  // page was still loading.
  const settled = useRef(pathname)

  const close = useCallback(() => {
    const details = ref.current
    if (!details?.open) return

    const returnFocus = details.contains(document.activeElement)
    details.open = false

    if (returnFocus) {
      details.querySelector('summary')?.focus({ preventScroll: true })
    }
  }, [])

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

  return (
    <CloseMenuContext.Provider value={close}>
      <details ref={ref} className={className}>
        {children}
      </details>
    </CloseMenuContext.Provider>
  )
}
