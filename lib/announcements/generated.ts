import { getDayOpening } from '@/lib/hours/engine'
import { formatTimeRange, formatWeekdayDate, formatWeekdayName } from '@/lib/hours/format'
import type { OverrideContent } from '@/lib/hours/override-form'
import type { DayOpening, OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { type IsoDate, type IsoTime, minutesOfDay, parseIsoTime } from '@/lib/time/calendar'
import { assertValidInstant } from '@/lib/time/copenhagen'

import { isAnnouncementExpired } from './expiry'
import { announcementExpiryInstant } from './expiry-editor'
import { ANNOUNCEMENT_MESSAGE_MAX_LENGTH } from './lifecycle'
import type { AnnouncementPageRoute } from './link'
import type { AnnouncementSource } from './ownership'

/**
 * The generated opening-hours announcement — design 1t, 1ac, 1ae; technical plan §4,
 * §7c, §7e item 8.
 *
 * 1t's promise, in the frame's own words: *"Én indtastning, to steder. Datoen og
 * tiderne herfra skriver både beskeden og dens udløb — personalet skriver aldrig
 * 'søndag 17:00–19:00' to gange og skal ikke selv huske at fjerne beskeden bagefter."*
 * This module is that sentence as a pure function, and it is **only** that sentence.
 *
 * WHAT IT IS, AND WHAT IT IS NOT (phase 8C-2)
 *
 * It is the **domain logic** that turns a one-off opening-hours change into the
 * announcement 8C-3 suggests. It performs no database access, reads no clock, expires
 * no cache tag, imports no React and no Server Action, and writes nothing at all.
 *
 * It does not replace an announcement either, and it does not know which override owns
 * one. `replaceAnnouncement()` in `./replacement.ts` is the mechanism 8C-1 built and
 * `./generated-operation.ts` is the 8C-3A coordinator that calls it; what this returns
 * is a value **shaped to be** its payload, minus the ownership the coordinator adds —
 * see {@link GeneratedAnnouncement} — and nothing here calls either of them. That is
 * why this module imports `./expiry`, `./expiry-editor`, `./lifecycle` and two types,
 * and not the server modules that carry `server-only`.
 *
 * THE EXPIRY RULE, AND WHY IT IS NOT THE OVERRIDE'S CLOSING TIME
 *
 * The obvious reading — *the message expires when the special hours end* — is
 * **wrong**, and the approved design says so with a number. 1t draws a Sunday whose
 * recurring hours are 17:00–20:00, a one-off change to **17:00–19:00**, and the
 * generated expiry **20:00**; 1ae draws the same message and repeats *"Udløber
 * 14.09.2026 kl. 20:00"*. (1t's helper sentence glosses that as *"når I lukker den
 * dag"*, which reads like 19:00 — the two frames' number is the authority and the
 * gloss is the loose half. §0m records this.)
 *
 * The rule the number states, generalised:
 *
 *     the closing time the expiry uses is the LATER of the normal closing and the
 *     special closing.
 *
 * The reason is what the message is for. A guest is misled for as long as **either**
 * picture could still be in their head: the one the recurring hours table gave them,
 * or the one the override gives them. So the bar has to outlive both.
 *
 *   * normally 17:00–20:00, specially 17:00–19:00 → **20:00** (they might still turn
 *     up at 19:30 expecting the usual);
 *   * normally 17:00–20:00, specially 17:00–22:00 → **22:00** (the extra hours are
 *     the news, and they are news until they end);
 *   * normally closed, specially 13:00–18:00 → **18:00**;
 *   * normally 15:00–20:00, specially **closed** → **20:00** — the announcement
 *     stands through the time guests would otherwise expect to be served.
 *
 * NOTHING IS MANUFACTURED
 *
 * An override row is not by itself a change. A closed override on a day the recurring
 * schedule already closes changes nothing a guest could notice, and so does a custom
 * override that restates the hours the week already has. Both return
 * `{ ok: false, reason: 'no_effect' }` rather than a message about nothing. Neither
 * gets an invented midnight expiry.
 *
 * DETERMINISTIC, AND CLOCK-FREE
 *
 * `now` is a parameter. The generator needs it for exactly one decision — whether the
 * expiry it computed has already passed, in which case there is no announcement to
 * suggest (`'expired'`) — and it never moves the expiry forward to avoid saying so.
 * Nothing here calls `Date.now()`, and the Copenhagen conversion is one call to
 * {@link announcementExpiryInstant}, which is the same conversion 1ad's own expiry
 * fields use and which owns both daylight-saving conventions.
 */

// ---------------------------------------------------------------------------
// The defaults the approved frames draw
// ---------------------------------------------------------------------------

/** Every announcement this module produces is a generated one (1t, §4). */
export const GENERATED_ANNOUNCEMENT_SOURCE: Extract<AnnouncementSource, 'opening_hours'> =
  'opening_hours'

/**
 * Where "Se tider" goes — Find os, which is the page carrying the seven-day hours
 * table (`formatDailyHours`, 1ab).
 *
 * Typed as an {@link AnnouncementPageRoute}, so it is a member of the same closed set
 * `ANNOUNCEMENT_LINK_PAGES` and the `announcement_link_page_check` constraint carry
 * (§8). A route this system does not serve would not compile.
 */
export const GENERATED_HOURS_LINK_PAGE: AnnouncementPageRoute = '/find-os'

/** 1ac's own label on the linked bar: "Ændrede åbningstider … · Se tider". */
export const GENERATED_HOURS_LINK_LABEL = 'Se tider'

/**
 * A **changed-hours** message links to the hours table; a **closed** message does not.
 *
 * 1ac draws both: "DESKTOP · MED LINK" carries *"Ændrede åbningstider søndag ·
 * 17:00–19:00"* with "Se tider", and "DESKTOP · UDEN LINK" carries the closed message
 * as plain text with the frame's own note — *"Link er valgfrit. Uden link er hele
 * bjælken ren tekst — ingen tom knap, ingen pil."* A closed day has no times to go and
 * look at, so no CTA is invented for it.
 */
const CHANGED_HOURS_LINK = {
  link_type: 'page',
  link_page: GENERATED_HOURS_LINK_PAGE,
  link_url: null,
  link_label: GENERATED_HOURS_LINK_LABEL,
} as const

const CLOSED_DAY_LINK = {
  link_type: 'none',
  link_page: null,
  link_url: null,
  link_label: null,
} as const

// ---------------------------------------------------------------------------
// What goes in, and what comes out
// ---------------------------------------------------------------------------

/**
 * Everything the generator needs, and nothing it could look up for itself.
 *
 * The **schedule is an argument**: this module performs no query, so a caller that
 * loaded the wrong week cannot be rescued here and a caller that loaded none cannot
 * silently get a default. `override` is the content of one date — 8B's own
 * {@link OverrideContent}, the three columns and not the row — and it may be a draft's
 * content as easily as a published row's: the question this answers is *what would
 * this change say*, which is asked before anything is published.
 */
export type GeneratedAnnouncementRequest = {
  /** The Copenhagen calendar date the override applies to. */
  readonly date: IsoDate
  /** What the override says about that date. */
  readonly override: OverrideContent
  /** The recurring weekly schedule the override departs from. */
  readonly schedule: WeeklySchedule
  /** The instant the decision is made at — the caller's clock, never this module's. */
  readonly now: Date
}

/**
 * The suggestion, in the shape `replace_announcement()` takes.
 *
 * Deliberately **assignable to** `AnnouncementReplacement` (`./replacement.ts`) minus
 * its ownership field, rather than imported from it: that module carries
 * `server-only`, and a pure generator that dragged the Supabase client behind it would
 * stop being one. The narrowing is real — a generated announcement never has an
 * external URL and always calls itself `'opening_hours'` — and the unit suite asserts
 * both that it type-checks as a replacement once an owner is added and that
 * `parseAnnouncementReplacement()` accepts the result.
 *
 * `is_visible` is absent for the reason it is absent from the replacement payload:
 * 1ae says *"Den nye besked går live"*, so it is not a choice anybody makes.
 *
 * `source_override_id` is absent because **this module does not know it, and must not
 * need to** (8C-3A). The generator is given an {@link OverrideContent} — the three
 * content columns of one date — which may equally be a *draft's* content, asked before
 * anything is published and therefore possibly belonging to no row at all. Ownership
 * is a fact about the published override row, so the coordinator supplies it, from the
 * row it read. A generator that demanded an id would stop being able to answer 1t's
 * question *"what would this change say?"* while somebody is still typing it.
 */
export type GeneratedAnnouncement = {
  readonly message: string
  readonly link_type: 'none' | 'page'
  readonly link_page: AnnouncementPageRoute | null
  readonly link_url: null
  readonly link_label: string | null
  /** An **instant**, ISO 8601 with an offset — never a civil date (§7c). */
  readonly expires_at: string
  readonly source: Extract<AnnouncementSource, 'opening_hours'>
}

/**
 * Why there is no suggestion. Each one is a rule rather than a failure.
 *
 *   * `no_effect` — the override changes nothing a guest could notice: it closes a day
 *     the week already closes, or it restates the hours the week already has. An
 *     announcement about it would be an announcement about nothing.
 *   * `expired`   — the expiry this rule computes is already in the past at `now`, so
 *     the announcement could never be published (§7c: the expiry must be in the
 *     future). **Nothing is moved forward** to make it publishable.
 *   * `too_long`  — the generated default would break 1ac's 90-character rule. It is
 *     refused rather than truncated. Unreachable for every weekday and every clock
 *     time the model allows — the longest generated string is 42 characters — and
 *     stated all the same, because a limit that is only checked when somebody
 *     remembers is not a limit.
 */
export type GeneratedAnnouncementRefusal = 'no_effect' | 'expired' | 'too_long'

export type GeneratedAnnouncementResult =
  | { readonly ok: true; readonly announcement: GeneratedAnnouncement }
  | { readonly ok: false; readonly reason: GeneratedAnnouncementRefusal }

function refuse(reason: GeneratedAnnouncementRefusal): GeneratedAnnouncementResult {
  return { ok: false, reason }
}

// ---------------------------------------------------------------------------
// What actually changed
// ---------------------------------------------------------------------------

/** The later of two closing times. Compared as minutes, never as strings. */
function laterClosing(a: IsoTime, b: IsoTime): IsoTime {
  return minutesOfDay(parseIsoTime(a)) >= minutesOfDay(parseIsoTime(b)) ? a : b
}

/**
 * The closing time the expiry must reach, or `null` when nothing changed.
 *
 * Both days come from the phase-2 engine, so their times are already normalised to
 * `HH:MM` and validated as `from < to` — which is what makes the equality test below a
 * string comparison rather than a third opinion about what a time is.
 */
function generatedClosing(normal: DayOpening, special: DayOpening): IsoTime | null {
  if (!special.isOpen) return normal.isOpen ? normal.to : null
  if (!normal.isOpen) return special.to

  // Open both ways: an override that restates the week is not a change either.
  if (normal.from === special.from && normal.to === special.to) return null

  return laterClosing(normal.to, special.to)
}

/**
 * The message, worded from the date and the hours that now apply to it.
 *
 * Keyed on whether the day ends up **open**, which is exactly `kind === 'custom'` — the
 * override always wins the resolution — and gives the narrowing for free.
 *
 *   * open   → 1t's and 1ac's *"Ændrede åbningstider søndag · 17:00–19:00"*.
 *   * closed → *"Lukket mandag 21.09"*. 1ac's older shorthand adds an em dash and a
 *     reason — *"Lukket mandag 21.09 — privat arrangement"* — and the override model
 *     **has no reason field**, so none is invented. 8C-3 may let staff edit the
 *     suggestion before it is used; a generator that guessed "privat arrangement"
 *     would be publishing a claim nobody made.
 *
 * The weekday is derived from the date (`DayOpening.weekday`), never accepted as a
 * preformatted string, and the Danish words and the "·" are `lib/hours/format.ts`'s —
 * the same separator `describeOverrideDay` already prints on the override list.
 */
function generatedMessage(date: IsoDate, special: DayOpening): string {
  if (!special.isOpen) return `Lukket ${formatWeekdayDate(date)}`

  const weekday = formatWeekdayName(special.weekday, 'long')

  return `Ændrede åbningstider ${weekday} · ${formatTimeRange(special.from, special.to)}`
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * The announcement a one-off opening-hours change suggests, or the reason there is none.
 *
 * Pure: no query, no clock, no cache, no write, and the arguments are read and never
 * mutated. The same request always produces the same result.
 */
export function generateOpeningHoursAnnouncement(
  request: GeneratedAnnouncementRequest,
): GeneratedAnnouncementResult {
  // An `Invalid Date` compares false against everything, so an unguarded one would
  // quietly report a long-past announcement as still current (§7).
  assertValidInstant(request.now)

  const { date, schedule } = request

  // Treated as published in order to ask what it *would* do — the row's own status is
  // 8C-3's business, and a draft's content answers this question just as well.
  const applied: OpeningHoursOverride = {
    date,
    kind: request.override.kind,
    opensAt: request.override.opens_at,
    closesAt: request.override.closes_at,
    status: 'published',
  }

  // One engine, asked twice: the week without the override, and the week with it.
  const normal = getDayOpening(date, schedule, [])
  const special = getDayOpening(date, schedule, [applied])

  const closing = generatedClosing(normal, special)
  if (closing === null) return refuse('no_effect')

  const expiresAt = announcementExpiryInstant(date, closing).toISOString()

  // §7c's rule, asked with the caller's clock. Nothing extends the expiry to pass it.
  if (isAnnouncementExpired(expiresAt, request.now)) return refuse('expired')

  const message = generatedMessage(date, special)
  if (message.length > ANNOUNCEMENT_MESSAGE_MAX_LENGTH) return refuse('too_long')

  return {
    ok: true,
    announcement: {
      message,
      ...(special.isOpen ? CHANGED_HOURS_LINK : CLOSED_DAY_LINK),
      expires_at: expiresAt,
      source: GENERATED_ANNOUNCEMENT_SOURCE,
    },
  }
}

// ---------------------------------------------------------------------------
// The one field a person may change
// ---------------------------------------------------------------------------

/**
 * The same suggestion, with a staff member's own wording — design 1t, 1ae; §7 of the
 * 8C-3A brief.
 *
 * 1t offers the generated message as an **editable** field: the override model has no
 * reason column, so *"Lukket mandag 21.09"* is deliberately neutral and somebody may
 * want to say why (§0m). This is the whole of what that permission amounts to, stated
 * as a function so that "the message may be edited and nothing else may" is a property
 * of the type rather than of a reviewer's attention.
 *
 * Everything else is returned unchanged, and cannot be otherwise: the link, the
 * expiry and the source are read off {@link GeneratedAnnouncement} and never off an
 * argument. There is no parameter here through which a browser could move an expiry,
 * point the bar at another page, drop the link, or call a hand-written message
 * generated.
 *
 * `null` for a message this system would not accept — blank, whitespace, or past
 * 1ac's 90 characters. The caller reports it; nothing is truncated to fit.
 */
export function withEditedMessage(
  announcement: GeneratedAnnouncement,
  message: string,
): GeneratedAnnouncement | null {
  const trimmed = message.trim()

  if (trimmed.length === 0) return null
  if (trimmed.length > ANNOUNCEMENT_MESSAGE_MAX_LENGTH) return null

  return { ...announcement, message: trimmed }
}
