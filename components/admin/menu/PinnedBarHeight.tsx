'use client'

import { useEffect, useRef } from 'react'

/** The custom property the pinned bar publishes on `<html>` — read by `app/globals.css` and the news editor's toolbar. */
export const PINNED_BAR_HEIGHT_PROPERTY = '--admin-bar-height'

/**
 * The pinned bar's height, as a CSS custom property on `<html>` (phase 12B).
 *
 * Two things on the phone sit *under* the pinned section bar and must never be
 * covered by it: the news editor's sticky B/Link toolbar (`NewsBodyField`) and any
 * fragment target the address scrolls to (`scroll-padding-top` in `globals.css`).
 * Both need one number — how tall the bar is right now — and the bar's height is
 * not a constant: an autosave conflict puts three or four lines of wording into
 * its status row, and the wording must stay whole (phase brief §10).
 *
 * CSS cannot read one element's rendered height into another element's `top`
 * (sticky offsets are lengths against the scrollport; anchor positioning is for
 * absolutely-positioned boxes only), so the bar measures itself and writes the
 * result to `--admin-bar-height`; everything downstream is plain CSS with a
 * `6.25rem` fallback — the bar's two normal rows — for the paint before the first
 * measurement. A `ResizeObserver` rather than a measurement on each status
 * change, because the height also moves when the width does (a rotated phone
 * re-wraps the alert) and when a web font lands.
 *
 * It renders nothing, and it is the only script the bar carries. The toolbar it
 * serves exists only once scripting runs, so there is no no-JavaScript layout
 * that depends on the property being set.
 */
export function PinnedBarHeight() {
  const markerRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const bar = markerRef.current?.closest('header')
    if (!(bar instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return

    const root = document.documentElement
    const publish = () => {
      // The exact height, fractions included: rounding it up opens a hairline
      // between the bar and what sticks under it, and rounding it down closes the
      // hairline over it.
      root.style.setProperty(PINNED_BAR_HEIGHT_PROPERTY, `${bar.getBoundingClientRect().height}px`)
    }

    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(bar)

    return () => {
      observer.disconnect()
      root.style.removeProperty(PINNED_BAR_HEIGHT_PROPERTY)
    }
  }, [])

  return <span hidden ref={markerRef} />
}
