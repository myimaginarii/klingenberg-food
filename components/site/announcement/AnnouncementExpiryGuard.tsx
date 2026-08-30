'use client'

import { useEffect, useRef, useState } from 'react'

import { isAnnouncementExpired, nextExpiryCheckDelayMs } from '@/lib/announcements/expiry'

/**
 * The announcement's expiry, corrected in the browser — technical plan §7c
 * (correction C1), §7a, §12.
 *
 * §7c states the problem exactly: the public site may serve HTML up to five minutes old,
 * and for a menu that is invisible while for "Vi lukker kl. 18 i dag" it is not. This
 * component closes that one gap and does nothing else.
 *
 * **The server remains the primary filter.** The bar is rendered only for an
 * announcement the anonymous RLS policy returned *and* whose expiry had not passed at
 * render time (`AnnouncementRegion`). This guard is the third layer, and it is the only
 * one that can act while a page is already on screen.
 *
 * WHAT IT DOES
 *
 *   * On mount it compares `Date.parse(expiresAt)` to `Date.now()`. Already past → the
 *     content is removed at once, before the visitor reads a stale message.
 *   * Otherwise it sets **one** `setTimeout` for the remaining milliseconds, clamped to
 *     the ~24-day `setTimeout` ceiling. A longer expiry re-arms rather than overflowing
 *     to "fire immediately", which is what an unclamped `setTimeout` does past 2^31 ms.
 *   * It re-checks on `visibilitychange` and on `pageshow`, because a phone restored
 *     from bfcache after several hours will not fire a pending timer reliably. On mobile
 *     that is the case that actually matters.
 *   * It clears its timer and both listeners on unmount.
 *
 * WHAT IT EXPLICITLY DOES NOT DO — §7c, and asserted by the security suite
 *
 * No `fetch`, no Supabase client, no realtime subscription, no polling, no cookie, no
 * `localStorage`, no analytics and no state library. It reads one prop and a clock. It
 * also holds no *dismiss* state: a guest cannot close this bar (1ac), so there is
 * nothing per-visitor to remember and nothing to store.
 *
 * HYDRATION, AND WHY THE FIRST RENDER IS ALWAYS THE SERVER'S
 *
 * `expired` starts `false` — the server's own answer — so the first client render is
 * byte-identical to the HTML and there is no mismatch and no flash. The check then runs
 * in the effect, which commits immediately after hydration. This is the same arrangement
 * `components/site/OpenStatus.tsx` uses for the open/closed badge, for the same reason.
 *
 * FOCUS, AT THE ONE INSTANT IT CAN MATTER
 *
 * If the expiry passes while the keyboard is on the announcement's link, removing the
 * link would leave focus on a detached node — and browsers disagree about where focus
 * lands afterwards. So the guard blurs it first, deterministically, which returns focus
 * to the document body: the next Tab continues from the top of the page, which is where
 * the bar was. It never *moves* focus to another control, because the bar appearing or
 * disappearing must not steal it (1ac, 1aa).
 *
 * The `aria-live` region around this component stays mounted (§7c). Only its content is
 * removed, so a screen reader is not interrupted by a disappearance.
 */

export function AnnouncementExpiryGuard({
  expiresAt,
  children,
}: {
  /** The absolute expiry instant, ISO 8601. The only thing this component is told. */
  expiresAt: string
  children: React.ReactNode
}) {
  const [expired, setExpired] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: number | undefined

    const check = () => {
      // Cleared first, every time. `check` is also the two listeners' handler, so a
      // backgrounded tab that fires `visibilitychange` twice would otherwise leave a
      // timer behind on each pass — a leak that grows for as long as the page is open.
      if (timer !== undefined) window.clearTimeout(timer)

      if (!isAnnouncementExpired(expiresAt, new Date())) {
        // Re-arm rather than trust one long timer: `nextExpiryCheckDelayMs` clamps to
        // the 32-bit `setTimeout` ceiling, so a far-future expiry produces a timer that
        // fires early and schedules the next one instead of overflowing to zero.
        timer = window.setTimeout(check, nextExpiryCheckDelayMs(expiresAt, new Date()))
        return
      }

      const active = document.activeElement
      if (active instanceof HTMLElement && container.current?.contains(active)) {
        active.blur()
      }

      setExpired(true)
    }

    check()

    document.addEventListener('visibilitychange', check)
    window.addEventListener('pageshow', check)

    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('pageshow', check)
    }
  }, [expiresAt])

  // The wrapper stays even when the content goes, so the ref survives the removal and
  // the live region above it is never itself unmounted. It carries no styles, so an
  // emptied bar reserves no vertical space — 1ac: "den findes ikke i siden".
  return <div ref={container}>{expired ? null : children}</div>
}
