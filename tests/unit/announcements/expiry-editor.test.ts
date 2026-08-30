import { describe, expect, it } from 'vitest'

import {
  ANNOUNCEMENT_EXPIRY_CHOICES,
  type AnnouncementExpirySuggestion,
  announcementExpiryFields,
  announcementExpiryInstant,
  announcementExpirySuggestions,
  instantForChoice,
  isAnnouncementExpiryChoice,
  isExpiryDate,
  isExpiryTime,
  matchingExpiryChoice,
} from '@/lib/announcements/expiry-editor'
import { copenhagenInstantOf } from '@/lib/time/copenhagen'

import {
  ALWAYS_CLOSED_SCHEDULE,
  CONFIRMED_SCHEDULE,
  closedOverride,
  customOverride,
} from '../fixtures/hours'

/**
 * The editor's half of the expiry — design 1ad.
 *
 * Two questions, and they are different:
 *
 *   * **The civil round trip.** 1ad's two fields hold a Copenhagen wall clock. Typing
 *     "20:00" on a given date must produce the instant that reads 20:00 in Copenhagen,
 *     and reading that instant back must give "20:00" again — on both sides of a
 *     daylight-saving change, and on the two Sundays where a wall clock is ambiguous or
 *     does not exist. The conventions themselves belong to `lib/time/copenhagen.ts` and
 *     are pinned by the phase-2 suite; what is asserted here is that this module uses
 *     them rather than doing arithmetic of its own.
 *   * **The suggestions.** They are values, computed from the published hours and one
 *     instant, and a chip that cannot be computed is absent rather than invented.
 */

/** The restaurant's confirmed hours, with no one-off changes. */
const HOURS = { schedule: CONFIRMED_SCHEDULE, overrides: [] as const }

/**
 * The first suggestion, asserted to exist before it is read.
 *
 * `noUncheckedIndexedAccess` is on, and rightly: an index into an array is a value that
 * may not be there. Every caller below has just asserted that a chip *should* be on
 * offer, so the check belongs here once rather than as a `!` at eleven call sites.
 */
function firstSuggestion(
  suggestions: readonly AnnouncementExpirySuggestion[],
): AnnouncementExpirySuggestion {
  const first = suggestions[0]
  if (first === undefined) throw new Error('expected at least one suggestion')
  return first
}

function suggestion(
  suggestions: readonly AnnouncementExpirySuggestion[],
  choice: AnnouncementExpirySuggestion['choice'],
): AnnouncementExpirySuggestion {
  const found = suggestions.find((candidate) => candidate.choice === choice)
  if (found === undefined) throw new Error(`expected a ${choice} suggestion`)
  return found
}

describe('the civil round trip', () => {
  it('turns a Copenhagen date and time into the instant it names', () => {
    // Summer: Copenhagen is UTC+2, so 20:00 local is 18:00Z.
    expect(announcementExpiryInstant('2026-09-14', '20:00').toISOString()).toBe(
      '2026-09-14T18:00:00.000Z',
    )

    // Winter: UTC+1, so the same wall clock is a different instant.
    expect(announcementExpiryInstant('2026-12-14', '20:00').toISOString()).toBe(
      '2026-12-14T19:00:00.000Z',
    )
  })

  it('reads an instant back as the wall clock it was typed as', () => {
    for (const [date, time] of [
      ['2026-09-14', '20:00'],
      ['2026-12-14', '20:00'],
      ['2027-03-28', '01:30'],
      ['2026-10-25', '04:00'],
    ] as const) {
      const instant = announcementExpiryInstant(date, time)
      expect(announcementExpiryFields(instant)).toEqual({ date, time })
    }
  })

  it('resolves a wall clock inside the March gap rather than failing', () => {
    // 2027-03-28 02:30 never happens in Copenhagen; the "compatible" convention moves it
    // forward by the length of the gap. The value matters less than that it is a real
    // instant an expiry can be stored as.
    const instant = announcementExpiryInstant('2027-03-28', '02:30')

    expect(Number.isNaN(instant.getTime())).toBe(false)
    expect(instant.toISOString()).toBe(copenhagenInstantOf('2027-03-28', '02:30').toISOString())
  })

  it('resolves a wall clock inside the October repeat to its first occurrence', () => {
    const instant = announcementExpiryInstant('2026-10-25', '02:30')

    expect(instant.toISOString()).toBe(copenhagenInstantOf('2026-10-25', '02:30').toISOString())
    // The earlier of the two 02:30s is the one at UTC+2, i.e. 00:30Z.
    expect(instant.toISOString()).toBe('2026-10-25T00:30:00.000Z')
  })
})

describe('the shapes the two fields submit', () => {
  it.each(['2026-09-14', '2027-01-01', '2028-02-29'])('accepts the date %s', (value) => {
    expect(isExpiryDate(value)).toBe(true)
  })

  // "2026-02-29" is the shape of a date and not a day: 2026 is not a leap year, and a
  // parser that accepted it would hand the expiry a March instant nobody chose.
  it.each(['14-09-2026', '2026/09/14', '2026-9-4', '2026-02-29', '2026-13-01', 'i morgen', ''])(
    'refuses the date %s',
    (value) => {
      expect(isExpiryDate(value)).toBe(false)
    },
  )

  it.each(['00:00', '09:05', '20:00', '23:59'])('accepts the time %s', (value) => {
    expect(isExpiryTime(value)).toBe(true)
  })

  it.each(['24:00', '20:60', '8:00', '20:00:00', '20.00', 'kl. 20', ''])(
    'refuses the time %s',
    (value) => {
      expect(isExpiryTime(value)).toBe(false)
    },
  )
})

describe('which chip a submission names', () => {
  it('accepts the three choices and nothing else', () => {
    expect([...ANNOUNCEMENT_EXPIRY_CHOICES]).toEqual(['closing', 'week', 'custom'])

    for (const choice of ANNOUNCEMENT_EXPIRY_CHOICES) {
      expect(isAnnouncementExpiryChoice(choice)).toBe(true)
    }

    for (const value of ['lukketid', 'CLOSING', '', null, undefined, 0, {}]) {
      expect(isAnnouncementExpiryChoice(value)).toBe(false)
    }
  })
})

describe('1ad’s suggestions', () => {
  it('names today’s closing time while the doors are open', () => {
    // Wednesday 2026-09-16, 18:00 Copenhagen. Wed–fre 15:00–20:00, so they shut at 20:00.
    const now = copenhagenInstantOf('2026-09-16', '18:00')
    const closing = firstSuggestion(
      announcementExpirySuggestions(now, HOURS.schedule, HOURS.overrides),
    )

    expect(closing.choice).toBe('closing')
    expect(closing.label).toBe('Når vi lukker i dag kl. 20:00')
    expect(closing.instant.toISOString()).toBe(
      copenhagenInstantOf('2026-09-16', '20:00').toISOString(),
    )
  })

  it('still names today’s closing before the doors open', () => {
    // 11:00 on a Wednesday: shut, but today's own opening is still ahead.
    const now = copenhagenInstantOf('2026-09-16', '11:00')
    const closing = firstSuggestion(
      announcementExpirySuggestions(now, HOURS.schedule, HOURS.overrides),
    )

    expect(closing.label).toBe('Når vi lukker i dag kl. 20:00')
  })

  it('names the next opening day’s closing once today’s service is over', () => {
    // Sunday 2026-09-13 at 21:00: closed for the night, and Monday and Tuesday are
    // closed days — so the next closing is Wednesday's.
    const now = copenhagenInstantOf('2026-09-13', '21:00')
    const closing = firstSuggestion(
      announcementExpirySuggestions(now, HOURS.schedule, HOURS.overrides),
    )

    expect(closing.label).toBe('Når vi lukker onsdag kl. 20:00')
    expect(closing.instant.toISOString()).toBe(
      copenhagenInstantOf('2026-09-16', '20:00').toISOString(),
    )
  })

  it('honours a published one-off closure when finding the next closing', () => {
    const now = copenhagenInstantOf('2026-09-13', '21:00')
    const suggestions = announcementExpirySuggestions(now, CONFIRMED_SCHEDULE, [
      closedOverride('2026-09-16'),
    ])

    expect(firstSuggestion(suggestions).label).toBe('Når vi lukker torsdag kl. 20:00')
  })

  it('honours a published override that opens a normally closed day', () => {
    const now = copenhagenInstantOf('2026-09-13', '21:00')
    const suggestions = announcementExpirySuggestions(now, CONFIRMED_SCHEDULE, [
      customOverride('2026-09-14', '12:00', '16:00'),
    ])

    expect(firstSuggestion(suggestions).label).toBe('Når vi lukker mandag kl. 16:00')
  })

  it('offers no closing chip at all when there is no opening day to find', () => {
    const now = copenhagenInstantOf('2026-09-16', '18:00')
    const suggestions = announcementExpirySuggestions(now, ALWAYS_CLOSED_SCHEDULE, [])

    // A schedule with nothing open produces no closing instant, so the chip is absent
    // rather than a made-up date.
    expect(suggestions.map((suggestion) => suggestion.choice)).toEqual(['week'])
  })

  it('offers "Om en uge" as the same wall clock seven Copenhagen days later', () => {
    const now = copenhagenInstantOf('2026-09-16', '18:20')
    const suggestions = announcementExpirySuggestions(now, HOURS.schedule, HOURS.overrides)
    const week = suggestion(suggestions, 'week')

    expect(week.label).toBe('Om en uge')
    expect(announcementExpiryFields(week.instant)).toEqual({
      date: '2026-09-23',
      time: '18:20',
    })
  })

  it('keeps the same wall clock across the autumn change rather than 7 × 24 hours', () => {
    // 2026-10-25 is the autumn transition. A week from the 21st is the 28th, and the
    // clocks have gone back in between — so a fixed 604 800 000 ms would land an hour out.
    const now = copenhagenInstantOf('2026-10-21', '18:00')
    const suggestions = announcementExpirySuggestions(now, HOURS.schedule, HOURS.overrides)
    const week = suggestion(suggestions, 'week')

    expect(announcementExpiryFields(week.instant)).toEqual({
      date: '2026-10-28',
      time: '18:00',
    })
    expect(week.instant.getTime() - now.getTime()).toBe(7 * 86_400_000 + 3_600_000)
  })
})

describe('reading a chip back off a stored expiry', () => {
  const now = copenhagenInstantOf('2026-09-16', '18:00')
  const suggestions = announcementExpirySuggestions(now, HOURS.schedule, HOURS.overrides)

  it('shows the chip whose instant the stored expiry still is', () => {
    const closing = firstSuggestion(suggestions)

    expect(matchingExpiryChoice(closing.instant.toISOString(), suggestions)).toBe('closing')
  })

  it('matches on the instant, not on how it is written', () => {
    // PostgREST returns `+00:00`; this application writes `Z`. The chip must survive the
    // round trip through the database.
    const closing = firstSuggestion(suggestions)
    const postgrest = closing.instant.toISOString().replace('.000Z', '+00:00')

    expect(matchingExpiryChoice(postgrest, suggestions)).toBe('closing')
  })

  it('falls back to "Vælg selv" for a date somebody typed', () => {
    const typed = copenhagenInstantOf('2026-09-20', '13:37').toISOString()

    expect(matchingExpiryChoice(typed, suggestions)).toBe('custom')
  })

  it('falls back to "Vælg selv" when there is no expiry at all', () => {
    expect(matchingExpiryChoice(null, suggestions)).toBe('custom')
  })

  it('resolves a chip to its instant, and "Vælg selv" to nothing', () => {
    expect(instantForChoice('closing', suggestions)?.toISOString()).toBe(
      firstSuggestion(suggestions).instant.toISOString(),
    )
    expect(instantForChoice('custom', suggestions)).toBeNull()
  })

  it('resolves a chip that is not on offer to nothing', () => {
    // The closing chip is absent when nothing is ever open. A submission naming it must
    // find no value rather than borrow another chip's.
    const closedSuggestions = announcementExpirySuggestions(now, ALWAYS_CLOSED_SCHEDULE, [])

    expect(instantForChoice('closing', closedSuggestions)).toBeNull()
  })
})
