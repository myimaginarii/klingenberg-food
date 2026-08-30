import { describe, expect, it } from 'vitest'

import {
  MAX_TIMEOUT_MS,
  isAnnouncementExpired,
  millisecondsUntilExpiry,
  nextExpiryCheckDelayMs,
  parseExpiryInstant,
} from '@/lib/announcements/expiry'

/**
 * The expiry rule the server and the browser share — technical plan §7c.
 *
 * `expires_at` is a `timestamptz`, so every assertion here is about **instants**. The
 * three writings of one moment — `Z`, `+00:00` and `+02:00` — must be the same answer,
 * because PostgREST, this application and a person's own typing each produce a different
 * one of them.
 */

const MOMENT = '2026-09-14T18:00:00.000Z'

describe('reading a stored expiry', () => {
  it('parses the three spellings of one instant to the same value', () => {
    const values = [
      '2026-09-14T18:00:00.000Z',
      '2026-09-14T18:00:00+00:00',
      '2026-09-14T20:00:00+02:00',
    ]

    const instants = values.map((value) => parseExpiryInstant(value)?.getTime())

    expect(new Set(instants).size).toBe(1)
    expect(instants[0]).toBe(Date.parse(MOMENT))
  })

  it.each([null, undefined, '', 'i morgen', '2026-13-45T99:99:99Z'])(
    'answers null for %s rather than a plausible wrong instant',
    (value) => {
      expect(parseExpiryInstant(value)).toBeNull()
    },
  )
})

describe('whether an announcement has expired', () => {
  it('is not expired a millisecond before', () => {
    expect(isAnnouncementExpired(MOMENT, new Date(Date.parse(MOMENT) - 1))).toBe(false)
  })

  it('is expired at exactly the expiry instant', () => {
    // The RLS policy is `expires_at > now()`, so the instant itself is already past. All
    // three layers have to agree here or the bar flickers at the boundary.
    expect(isAnnouncementExpired(MOMENT, new Date(Date.parse(MOMENT)))).toBe(true)
  })

  it('is expired a millisecond after', () => {
    expect(isAnnouncementExpired(MOMENT, new Date(Date.parse(MOMENT) + 1))).toBe(true)
  })

  it('treats a missing expiry as expired, never as "forever"', () => {
    // 1ac: "Udløb er påkrævet". A message with nothing to take it down must not be shown
    // indefinitely by a rule that could not read its expiry.
    expect(isAnnouncementExpired(null, new Date())).toBe(true)
    expect(isAnnouncementExpired(undefined, new Date())).toBe(true)
    expect(isAnnouncementExpired('ikke et tidspunkt', new Date())).toBe(true)
  })

  it('compares instants, not the strings they are written as', () => {
    // "20:00+02:00" sorts before "18:00Z" as text and is the same moment as it. A string
    // comparison would answer this one wrongly in both directions.
    const now = new Date(Date.parse(MOMENT) - 60_000)

    expect(isAnnouncementExpired('2026-09-14T20:00:00+02:00', now)).toBe(false)
    expect(isAnnouncementExpired('2026-09-14T19:59:00+02:00', now)).toBe(true)
  })
})

describe('how long the client guard waits', () => {
  it('is the remaining time for an ordinary expiry', () => {
    const now = new Date(Date.parse(MOMENT) - 30_000)

    expect(millisecondsUntilExpiry(MOMENT, now)).toBe(30_000)
    expect(nextExpiryCheckDelayMs(MOMENT, now)).toBe(30_000)
  })

  it('is zero once the expiry has passed', () => {
    expect(millisecondsUntilExpiry(MOMENT, new Date(Date.parse(MOMENT) + 5_000))).toBe(0)
    expect(nextExpiryCheckDelayMs(MOMENT, new Date(Date.parse(MOMENT) + 5_000))).toBe(0)
  })

  it('clamps a far-future expiry to the setTimeout ceiling instead of overflowing', () => {
    // A delay past 2^31 − 1 does not wait longer: it wraps and fires immediately, which
    // would hide a bar the moment the page loaded. The clamped timer fires early and the
    // guard re-arms.
    const now = new Date(Date.parse(MOMENT))
    const farFuture = new Date(Date.parse(MOMENT) + MAX_TIMEOUT_MS * 3).toISOString()

    expect(millisecondsUntilExpiry(farFuture, now)).toBeGreaterThan(MAX_TIMEOUT_MS)
    expect(nextExpiryCheckDelayMs(farFuture, now)).toBe(MAX_TIMEOUT_MS)
  })

  it('is zero for an unreadable expiry, so the guard resolves it immediately', () => {
    expect(nextExpiryCheckDelayMs(null, new Date())).toBe(0)
  })
})
