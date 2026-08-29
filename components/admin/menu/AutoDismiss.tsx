'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A message that takes itself away — design 1aa: *"Beskeder forsvinder efter 5 sek. —
 * dog 10 sek., når de indeholder Fortryd. De stjæler aldrig tastaturfokus."*
 *
 * The only client component in the menu administration, and it is deliberately as
 * small as that sentence. It renders whatever it is given, starts one timer, and
 * removes the message when the timer fires. It fetches nothing, stores nothing, and
 * knows nothing about dishes, availability or undo.
 *
 * **It is an enhancement, not the mechanism.** Its children are server-rendered — the
 * strip, its wording and the Fortryd form all come from the server, so the message and
 * its undo work with JavaScript switched off. Without JS the strip simply stays until
 * the next navigation, which is the degradation §7e (item 11) allows for the admin.
 *
 * **The timeout is not a security boundary.** Nothing about the undo depends on it:
 * pressing Fortryd is a fresh, authorized, concurrency-checked server write whether it
 * happens at second one or after the strip is gone from a stale tab (`availability-
 * actions.ts`). This component decides how long a *message* is on screen and nothing
 * else.
 *
 * THREE THINGS IT IS CAREFUL ABOUT
 *
 *   * **It never moves focus.** Nothing here calls `focus()`. The strip is announced by
 *     its own `role="status"`, which is polite by definition and does not interrupt.
 *   * **It will not pull the rug out from under the keyboard.** If focus is inside the
 *     message when the timer fires — somebody has tabbed to Fortryd and is reading —
 *     the message stays. Removing the element the user is standing on would drop focus
 *     to the top of the document, which is precisely the "stealing focus" 1aa forbids,
 *     in its most disorienting form.
 *   * **Motion.** The fade is a CSS transition, and `app/globals.css` neutralises every
 *     transition under `prefers-reduced-motion: reduce`, so the message simply goes.
 */

/** 1aa: ten seconds, because this message carries Fortryd. */
export const UNDO_VISIBLE_MS = 10_000

export function AutoDismiss({
  children,
  afterMs = UNDO_VISIBLE_MS,
}: {
  children: React.ReactNode
  afterMs?: number
}) {
  const [visible, setVisible] = useState(true)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Each new message is a new mount — the strip's key is the version token the write
    // returned — so the timer never has to be reset for a second one.
    const timer = window.setTimeout(() => {
      const node = container.current
      if (node !== null && node.contains(document.activeElement)) return

      setVisible(false)
    }, afterMs)

    return () => window.clearTimeout(timer)
  }, [afterMs])

  if (!visible) return null

  return (
    <div className="transition-opacity duration-200" ref={container}>
      {children}
    </div>
  )
}
