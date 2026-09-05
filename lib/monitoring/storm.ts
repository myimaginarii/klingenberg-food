/**
 * The storm boundary — technical plan §0aj; phase 13C.
 *
 * One outage produces one operational signal per key per window, per process —
 * not one event per request. The limiter answering `unavailable` two hundred times
 * a minute during a database incident is one fact, and the fingerprint already
 * folds every event of one operation into one issue; this stops the events being
 * *sent* at all. A small in-memory table with an injectable clock, so the rule can
 * be proved without waiting. It is not a limiter and holds no subject: the key is
 * the operation name and, at most, the limiter scope.
 */

export const DEFAULT_STORM_WINDOW_MS = 60_000

/** Keep the table small however many distinct keys an incident produces. */
const MAX_KEYS = 256

export type StormBoundary = {
  /** True when an event for `key` may be sent now; false when one was sent inside the window. */
  allow(key: string, now?: number): boolean
  /** Forget everything — the tests' between-cases reset. */
  reset(): void
}

export function createStormBoundary(windowMs = DEFAULT_STORM_WINDOW_MS): StormBoundary {
  const lastSent = new Map<string, number>()

  return {
    allow(key, now = Date.now()) {
      const previous = lastSent.get(key)
      if (previous !== undefined && now - previous < windowMs) return false

      if (lastSent.size >= MAX_KEYS) {
        for (const [candidate, sentAt] of lastSent) {
          if (now - sentAt >= windowMs) lastSent.delete(candidate)
        }
        if (lastSent.size >= MAX_KEYS) {
          const oldest = lastSent.keys().next().value
          if (oldest !== undefined) lastSent.delete(oldest)
        }
      }

      lastSent.set(key, now)
      return true
    },
    reset() {
      lastSent.clear()
    },
  }
}
