import { ANNOUNCEMENT_LINK_PAGES, isConsistentAnnouncementLink } from '@/lib/announcements/link'
import { isIsoDate, isIsoTime, type IsoDate, type IsoTime } from '@/lib/time/calendar'

import { flag, httpsUrl, isBlank, object, oneOf, text } from './fields'
import { add, at, shown, type Problem } from './problems'

/**
 * What a usable announcement is — `announcement.json`.
 *
 * THE TIME RULE, STATED FIRST BECAUSE IT IS THE EASY ONE TO GET WRONG.
 *
 * An expiry is written **as the restaurant reads it off the wall clock** —
 * `2026-09-11T12:00` means noon in Copenhagen, on whatever offset Copenhagen happens to
 * be on that day. It carries no `Z` and no `+02:00`, and one is refused here rather
 * than accepted and hoped about. The reason is the editor: the Pages CMS date-and-time
 * control shows the person a local reading and writes what the *browser* thought that
 * meant, so an offset in the file records the offset of whoever last opened the form,
 * which is not a fact about the restaurant. A wall clock is. Turning it into a real
 * instant is one conversion, at one place — `lib/content/load/announcement.ts`, through
 * `copenhagenInstantOf` — and everything downstream of that loader goes on comparing
 * instants exactly as it did before.
 *
 * An expiry is checked for being *a readable wall clock*, never for being *in the
 * future*. A notice that was correct when it was written must not start failing the
 * build tomorrow simply because the clock moved: a build is run on a schedule and on
 * every push, and content that decays into a build failure is content that breaks a
 * deployment nobody touched. Whether an announcement is still shown is already
 * decided, at render time and again in the browser, by `isAnnouncementExpired` — an
 * expired notice is *hidden*, which is the correct outcome and not an error. Keeping
 * an editor from choosing a date that has already passed is a job for the Pages CMS
 * form, at the moment of writing, where it can be a helpful hint instead of a build
 * failure.
 *
 * THE REST. An inactive file is valid whatever else it holds — that is the state the
 * site has been in since launch, and the message fields sit unread on disk. An active
 * one needs the two things the bar is made of, a message and an expiry, and its link
 * has to be one the resolver will actually render: `resolveAnnouncementLink` answers
 * `null` for a link it cannot trust, which is the right thing at render time (plain
 * text rather than a bad anchor) and exactly the wrong thing to discover later. So the
 * link is held here to the same rules the resolver applies — the site's own six
 * routes, an `https:` address, and the two of them not both filled in.
 */

const LINK_TYPES = ['none', 'page', 'url'] as const

const LINK_TYPE_NOTE =
  '"none" er intet link, "page" er en side her på sitet, "url" er en adresse et andet sted.'

export function validateAnnouncement(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  const active = flag(problems, at(where, 'active'), document.active, { required: true }) === true

  text(problems, at(where, 'message'), document.message, { required: active })
  validateExpiry(problems, at(where, 'expiresAt'), document.expiresAt, active)
  validateLink(problems, at(where, 'link'), document.link)

  return problems
}

/**
 * The written form of an expiry: a date, a `T`, and a time of day. Nothing after it.
 *
 * The trailing anchor is the whole point. `2026-09-11T12:00:00Z` and
 * `2026-09-11T12:00+02:00` both start with a perfectly good wall clock and then say
 * something about an offset, and an offset is exactly what this contract does not
 * store — so they are refused rather than quietly truncated to their first sixteen
 * characters.
 */
const WALL_CLOCK_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/

/** The example every message about an expiry shows. */
const WALL_CLOCK_EXAMPLE = '2026-09-11T12:00'

/** A Copenhagen wall clock, split into the two civil values `copenhagenInstantOf` takes. */
export type AnnouncementExpiryWallClock = {
  date: IsoDate
  time: IsoTime
}

/**
 * Read a raw `expiresAt` as a Copenhagen wall clock, or answer `null`.
 *
 * Exported because the loader needs the *same* reading rather than a second one of its
 * own: `lib/content/load/announcement.ts` splits the value here and hands the two
 * halves to `copenhagenInstantOf`. One function decides what the shape is, so the check
 * and the conversion cannot drift apart.
 *
 * `new Date(value)` is deliberately not used. It accepts far more than this contract
 * does — including every offset-bearing form — and reads an offset-free value against
 * the *host machine's* timezone, which is the one thing this whole change exists to
 * remove.
 */
export function announcementExpiryWallClock(value: unknown): AnnouncementExpiryWallClock | null {
  if (typeof value !== 'string') return null

  const match = WALL_CLOCK_PATTERN.exec(value)
  if (!match) return null

  const [, date, time] = match
  // The calendar's own parsers decide what a real date and a real time are: 2026-02-31
  // matches the pattern above and is not a day, and 25:00 matches and is not a time.
  if (!isIsoDate(date) || !isIsoTime(time)) return null

  return { date, time }
}

function validateExpiry(
  problems: Problem[],
  where: string,
  value: unknown,
  active: boolean,
): void {
  if (isBlank(value)) {
    if (active) {
      add(
        problems,
        where,
        `En aktiv besked skal have et udløbstidspunkt — f.eks. "${WALL_CLOCK_EXAMPLE}". ` +
          'En besked der aldrig udløber, bliver stående for evigt.',
      )
    }
    return
  }

  // Asked whether the value is a readable wall clock — never whether it has passed;
  // see the note at the top of this file.
  if (announcementExpiryWallClock(value) === null) {
    add(
      problems,
      where,
      `Skal være en dato med klokkeslæt skrevet som "${WALL_CLOCK_EXAMPLE}" — dansk tid, ` +
        'uden "Z" og uden "+02:00" til sidst. ' +
        `Fik: ${shown(value)}.`,
    )
  }
}

function validateLink(problems: Problem[], where: string, value: unknown): void {
  if (isBlank(value)) return

  const link = object(
    problems,
    where,
    value,
    '{ "type": "none" }, { "type": "page", "page": "/menu" } eller { "type": "url", "url": ' +
      '"https://www.facebook.com/carlnielsencafeen", "label": "Læs mere" }',
  )
  if (link === null) return

  const type = oneOf(problems, at(where, 'type'), link.type, LINK_TYPES, LINK_TYPE_NOTE)
  if (type === null) return

  const page = isBlank(link.page) ? null : (link.page as string)
  const url = isBlank(link.url) ? null : (link.url as string)

  // The rule *between* the three fields is the resolver's own, so it is asked rather
  // than restated: a half-filled link is what makes the bar silently drop its anchor.
  const consistent = isConsistentAnnouncementLink({
    link_type: type,
    link_page: page,
    link_url: url,
    link_label: null,
  })

  if (!consistent) {
    const wanted = {
      none: 'hverken "page" eller "url"',
      page: '"page" og ikke "url"',
      url: '"url" og ikke "page"',
    }[type]
    add(problems, where, `Linket passer ikke sammen. "type": "${type}" udfyldes med ${wanted}.`)
    return
  }

  if (type === 'page') {
    oneOf(
      problems,
      at(where, 'page'),
      page,
      ANNOUNCEMENT_LINK_PAGES,
      'Det skal være en af sitets egne sider.',
    )
  }

  if (type === 'url') {
    httpsUrl(problems, at(where, 'url'), url)
  }

  // An internal page falls back to the route's own Danish name; an outside address has
  // no such name, so the resolver renders no link at all without a label.
  text(problems, at(where, 'label'), link.label, { required: type === 'url' })
}
