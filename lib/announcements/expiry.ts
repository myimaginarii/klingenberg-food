/**
 * When a message stops being shown — design 1ac, 1ad; technical plan §7c.
 *
 * `SiteAnnouncement.expiresAt` is **an instant**, not a civil date. Every comparison in
 * this system is therefore between instants, and never between formatted strings or
 * between a date and a "today" derived from some other timezone. That is the whole of
 * {@link isAnnouncementExpired}, and it is why the public bar and the client guard
 * cannot disagree about whether a message is still current.
 *
 * THIS MODULE IMPORTS NOTHING, ON PURPOSE
 *
 * §7c's expiry guard is the only new client component the public site gets, and §7c
 * describes it as "roughly forty lines" that "reads one prop and calls `setTimeout`".
 * It also has to apply *the same rule the server applied*, which means sharing this
 * code rather than restating it. Those two requirements are only compatible if the
 * shared rule drags nothing behind it: no hours engine, no timezone conversion, no
 * schema, no formatting. So the instant rules live here with zero imports.
 *
 * The civil-time half lives at the other end of the pipeline instead, and never reaches
 * the browser: `announcement.json` stores a Copenhagen wall clock, and
 * `lib/content/load/announcement.ts` turns it into the instant this module is handed,
 * once, at build time, through `lib/time/copenhagen.ts`. Nothing here needs to know
 * that happened — which is the point of converting at the boundary.
 */

/**
 * Parse a loaded `expiresAt` into an instant, or `null`.
 *
 * `null` covers both "there is no expiry" and "the value is not a timestamp". The
 * second is unreachable through the application — the content check refuses a
 * malformed expiry and the loader produces this string with `toISOString()` — but a
 * function that answers "is this expired?" must not answer "no" to a value it could not
 * read. An invalid date compares false against everything, which is exactly the silent
 * wrong answer §7 warns about.
 */
export function parseExpiryInstant(expiresAt: string | null | undefined): Date | null {
  if (typeof expiresAt !== 'string') return null

  const parsed = new Date(expiresAt)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Has this expiry passed at `now`?
 *
 * Instants, compared as numbers. An announcement with **no** expiry counts as expired,
 * because a message that can live forever is the one thing 1ac rules out by name
 * ("Udløb er påkrævet") — so the safe reading of a missing expiry is "do not show it",
 * not "show it indefinitely".
 *
 * The boundary is inclusive of the expiry instant itself: at exactly `expiresAt` the
 * message is gone. That matches what the prerendered page decided, so the build and
 * the browser agree at the one instant it matters.
 */
export function isAnnouncementExpired(expiresAt: string | null | undefined, now: Date): boolean {
  const instant = parseExpiryInstant(expiresAt)
  if (instant === null) return true

  return instant.getTime() <= now.getTime()
}

/** Milliseconds until an expiry, floored at zero. */
export function millisecondsUntilExpiry(
  expiresAt: string | null | undefined,
  now: Date,
): number {
  const instant = parseExpiryInstant(expiresAt)
  if (instant === null) return 0

  return Math.max(0, instant.getTime() - now.getTime())
}

/**
 * `setTimeout` stores its delay in a signed 32-bit integer. A larger delay does not
 * wait longer — it overflows and fires **immediately**, which for this guard would mean
 * a bar that vanishes the moment the page loads.
 */
export const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * How long the client guard should wait before it looks again.
 *
 * The remaining time, clamped to the `setTimeout` ceiling of roughly 24.8 days. When the
 * clamp bites, the timer that fires early simply re-arms — which is why this returns a
 * delay rather than "the" delay, and why the guard's own check is written as a loop of
 * one step rather than as a single scheduled removal.
 *
 * It lives here, beside the rule it serves, so the arithmetic that decides when a bar
 * disappears is a pure function with a unit test rather than a line inside an effect.
 */
export function nextExpiryCheckDelayMs(
  expiresAt: string | null | undefined,
  now: Date,
): number {
  return Math.min(millisecondsUntilExpiry(expiresAt, now), MAX_TIMEOUT_MS)
}
