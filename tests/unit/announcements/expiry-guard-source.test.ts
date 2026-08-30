import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The promises the announcement's client guard makes about itself — technical plan §7c,
 * §7a, §12; design 1ac.
 *
 * §7c describes `AnnouncementExpiryGuard` in terms of what it *does not* do, and every
 * one of those is a property of the file rather than of a rendered output: "no `fetch`,
 * no Supabase client, no realtime subscription, no polling, no cookie, no state library.
 * It reads one prop and calls `setTimeout`."
 *
 * WHY THIS IS A SOURCE ASSERTION AND NOT A jsdom TEST
 *
 * §9 sketches this suite as "jsdom with fake timers". A DOM environment is a dependency
 * this repository does not have and §1 (adjustment 4) tells it not to acquire — and the
 * behaviour it would simulate is asserted for real, in a real browser, by
 * `tests/e2e/announcement.spec.ts`: a published bar removes itself as its expiry passes,
 * with no reload, and with the network log asserted empty. Simulating that in jsdom as
 * well would test a fake timer against a fake DOM to prove something a real browser
 * already proves.
 *
 * What jsdom *could* have added is the arithmetic — the clamp, the boundary, the
 * "already expired at mount" case — and that is why the arithmetic does not live in the
 * component at all. It is `nextExpiryCheckDelayMs` and `isAnnouncementExpired` in
 * `lib/announcements/expiry.ts`, both pure, both covered by `./expiry.test.ts`, and both
 * shared with the server so the two sides cannot disagree.
 *
 * What is left is the wiring, and the wiring is what this file reads.
 */

const GUARD = 'components/site/announcement/AnnouncementExpiryGuard.tsx'
const source = readFileSync(join(process.cwd(), GUARD), 'utf8')

/**
 * The file with its prose removed.
 *
 * The negative assertions below are about what the component *does*, and this component
 * is documented by explaining what it deliberately does not do — so the words
 * "localStorage" and "aria-live" appear in its comments precisely because they appear
 * nowhere in its code. Asserting against the raw file would make writing the explanation
 * fail the test that the explanation is true.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('the announcement expiry guard', () => {
  it('is a client component', () => {
    expect(source.startsWith("'use client'")).toBe(true)
  })

  it('makes no network request of any kind', () => {
    // §7c: "no `fetch`, no Supabase client, no realtime subscription, no polling". The
    // public-JavaScript policy suite asserts the same thing across every client
    // component; this repeats it at the file the promise was made about.
    expect(code).not.toMatch(/\bfetch\s*\(/)
    expect(code).not.toMatch(/XMLHttpRequest|EventSource|new WebSocket|sendBeacon/)
    expect(code).not.toContain('@supabase/')
    expect(code).not.toMatch(/setInterval|requestAnimationFrame/)
  })

  it('stores nothing on the visitor’s device', () => {
    // §12: a public visitor receives zero cookies and nothing is written about them. A
    // guest cannot dismiss this bar (1ac), so there is no per-visitor state to keep.
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
  })

  it('is told the expiry and nothing else', () => {
    // One prop, plus the children it wraps. No announcement object, no row, no id.
    expect(code).toMatch(/expiresAt: string/)
    expect(code).not.toMatch(/is_visible|link_url|message:/)
  })

  it('starts from the server’s answer, so hydration cannot mismatch', () => {
    expect(code).toContain('useState(false)')
  })

  it('schedules with the shared, tested delay rather than arithmetic of its own', () => {
    expect(code).toContain('nextExpiryCheckDelayMs(expiresAt, new Date())')
    // No clamping, and no millisecond constant, inside the component.
    expect(code).not.toMatch(/Math\.(min|max)\(/)
    expect(code).not.toMatch(/\d{4,}/)
  })

  it('re-checks on the two events a phone actually produces', () => {
    // §7c: a device restored from bfcache after several hours will not fire a pending
    // timer reliably, and on mobile that is the case that matters.
    expect(code).toContain("document.addEventListener('visibilitychange', check)")
    expect(code).toContain("window.addEventListener('pageshow', check)")
  })

  it('clears its timer and both listeners when it unmounts', () => {
    const cleanup = code.slice(code.indexOf('return () => {'))

    expect(cleanup).toContain('window.clearTimeout(timer)')
    expect(cleanup).toContain("document.removeEventListener('visibilitychange', check)")
    expect(cleanup).toContain("window.removeEventListener('pageshow', check)")
  })

  it('clears the previous timer before arming a new one', () => {
    // `check` is both the timer's callback and the two listeners' handler, so without
    // this a backgrounded tab would leave one timer behind per wake-up.
    const check = code.slice(code.indexOf('const check = ()'))
    const clearAt = check.indexOf('window.clearTimeout(timer)')
    const setAt = check.indexOf('window.setTimeout(')

    expect(clearAt).toBeGreaterThan(-1)
    expect(setAt).toBeGreaterThan(clearAt)
  })

  it('blurs a focused control inside itself before removing it, and moves focus nowhere', () => {
    // Removing the focused node leaves focus where browsers disagree; blurring first
    // makes it the document body deterministically. It never calls `.focus()` on
    // anything — the bar appearing or disappearing must not steal focus (1ac, 1aa).
    expect(code).toContain('container.current?.contains(active)')
    expect(code).toContain('active.blur()')
    expect(code).not.toMatch(/\.focus\(\)/)
  })

  it('keeps its wrapper mounted so the live region is never removed', () => {
    // §7c: "The `aria-live='polite'` region stays mounted; only its content is removed."
    expect(code).toContain('<div ref={container}>{expired ? null : children}</div>')
    expect(code).not.toContain('aria-live')
  })
})
