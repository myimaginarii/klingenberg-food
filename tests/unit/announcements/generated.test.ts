import { describe, expect, it } from 'vitest'

import {
  GENERATED_HOURS_LINK_LABEL,
  GENERATED_HOURS_LINK_PAGE,
  generateOpeningHoursAnnouncement,
  type GeneratedAnnouncement,
  type GeneratedAnnouncementRequest,
  type GeneratedAnnouncementResult,
} from '@/lib/announcements/generated'
import type { AnnouncementReplacement } from '@/lib/announcements/replacement'
import { parseAnnouncementReplacement } from '@/lib/announcements/replacement'
import { ANNOUNCEMENT_MESSAGE_MAX_LENGTH } from '@/lib/announcements/lifecycle'
import { ANNOUNCEMENT_LINK_PAGES } from '@/lib/schemas/announcement'
import type { OverrideContent } from '@/lib/hours/override-form'
import type { WeeklySchedule } from '@/lib/hours/types'
import { WEEKDAY_KEYS } from '@/lib/time/calendar'

import { ALWAYS_CLOSED_SCHEDULE, CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * The generated opening-hours announcement — phase 8C-2; design 1t, 1ac, 1ae.
 *
 * The generator is pure, so everything it promises is checkable here and nothing needs
 * a database, a browser or a clock. Four things are worth asserting and are asserted:
 *
 *   1. **the corrected expiry rule** — the later of the normal closing and the special
 *      closing, in all four of its cases. The obvious `expires_at = override.closes_at`
 *      would pass the first design example's *message* and fail its *expiry* by an
 *      hour, which is exactly the mistake the suite exists to prevent;
 *   2. **the two generated strings**, against the approved frames' own text — and the
 *      absence of a reason nobody supplied;
 *   3. **Copenhagen**, in both offsets and on both daylight-saving Sundays, as exact
 *      UTC instants rather than as formatted output;
 *   4. **the refusals** — an override that changes nothing, and an expiry already past.
 *
 * The phase-2 hours engine is not re-tested here. `tests/unit/hours/engine.test.ts` and
 * `tests/unit/hours/schedule.test.ts` own that matrix; this suite asks only what the
 * generator does with the engine's answers.
 */

/** The date the frames draw. 14.09.2026 is a *Monday*, so the Sunday beside it is used. */
const DESIGN_SUNDAY = '2026-09-13'

/** 1ac's closed example is a real Monday — but the confirmed week already closes it. */
const DESIGN_MONDAY = '2026-09-21'

/** The confirmed week with Monday opened, so 1ac's closed example is reachable. */
const MONDAY_OPEN_SCHEDULE: WeeklySchedule = {
  ...CONFIRMED_SCHEDULE,
  mon: { from: '15:00', to: '20:00' },
}

/** Open every day, so a closure on any weekday is a real change. */
const ALWAYS_OPEN_SCHEDULE: WeeklySchedule = Object.fromEntries(
  WEEKDAY_KEYS.map((weekday) => [weekday, { from: '00:00', to: '23:59' }]),
) as WeeklySchedule

/** Long before every date in this suite, so only the `expired` cases are expired. */
const BEFORE_EVERYTHING = new Date('2026-01-01T00:00:00.000Z')

function custom(opensAt: string, closesAt: string): OverrideContent {
  return { kind: 'custom', opens_at: opensAt, closes_at: closesAt }
}

const CLOSED: OverrideContent = { kind: 'closed', opens_at: null, closes_at: null }

function generate(
  request: Partial<GeneratedAnnouncementRequest> & Pick<GeneratedAnnouncementRequest, 'date' | 'override'>,
): GeneratedAnnouncementResult {
  return generateOpeningHoursAnnouncement({
    schedule: CONFIRMED_SCHEDULE,
    now: BEFORE_EVERYTHING,
    ...request,
  })
}

/** The suggestion, or a failure naming the refusal that came back instead. */
function suggestion(result: GeneratedAnnouncementResult): GeneratedAnnouncement {
  if (!result.ok) throw new Error(`Expected a suggestion; got "${result.reason}".`)
  return result.announcement
}

// ---------------------------------------------------------------------------
// 1. Changed hours
// ---------------------------------------------------------------------------

describe('a one-off change of hours', () => {
  it('is 1t’s own worked example, message and expiry', () => {
    // Normal Sunday 17:00–20:00; specially 17:00–19:00. 1t and 1ae both print the
    // expiry as 20:00 — the *normal* closing, not the special one.
    const announcement = suggestion(generate({ date: DESIGN_SUNDAY, override: custom('17:00', '19:00') }))

    expect(announcement.message).toBe('Ændrede åbningstider søndag · 17:00–19:00')
    expect(announcement.expires_at).toBe('2026-09-13T18:00:00.000Z') // 20:00 CEST
  })

  it('does not expire when the special hours end — the old assumption, refuted', () => {
    const announcement = suggestion(generate({ date: DESIGN_SUNDAY, override: custom('17:00', '19:00') }))

    // 19:00 CEST would be 17:00Z. A guest who expected the usual 20:00 would lose the
    // message an hour before the hours they remember run out.
    expect(announcement.expires_at).not.toBe('2026-09-13T17:00:00.000Z')
  })

  it('follows the special closing when it is the later of the two', () => {
    const announcement = suggestion(generate({ date: DESIGN_SUNDAY, override: custom('17:00', '22:00') }))

    expect(announcement.message).toBe('Ændrede åbningstider søndag · 17:00–22:00')
    expect(announcement.expires_at).toBe('2026-09-13T20:00:00.000Z') // 22:00 CEST
  })

  it('opens a normally closed day, and expires when the special hours end', () => {
    // Monday is closed in the confirmed week, so the override's own closing is the
    // only closing there is.
    const announcement = suggestion(generate({ date: DESIGN_MONDAY, override: custom('13:00', '18:00') }))

    expect(announcement.message).toBe('Ændrede åbningstider mandag · 13:00–18:00')
    expect(announcement.expires_at).toBe('2026-09-21T16:00:00.000Z') // 18:00 CEST
  })

  it('takes the later closing when only the opening moved', () => {
    // Same closing on both sides: the tie resolves to that closing rather than to
    // whichever side was asked first.
    const announcement = suggestion(generate({ date: DESIGN_SUNDAY, override: custom('18:00', '20:00') }))

    expect(announcement.message).toBe('Ændrede åbningstider søndag · 18:00–20:00')
    expect(announcement.expires_at).toBe('2026-09-13T18:00:00.000Z')
  })

  it('reads the times back exactly as stored, including a Postgres time’s seconds', () => {
    const announcement = suggestion(generate({ date: DESIGN_SUNDAY, override: custom('17:00:00', '19:00:00') }))

    expect(announcement.message).toBe('Ændrede åbningstider søndag · 17:00–19:00')
  })

  it('names the weekday the date falls on, never one it was handed', () => {
    // Every weekday of one confirmed-schedule week, so no single weekday is baked in.
    const week = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']
    const names = week.map(
      (date) => suggestion(generate({ date, override: custom('12:00', '14:00') })).message,
    )

    expect(names).toEqual([
      'Ændrede åbningstider mandag · 12:00–14:00',
      'Ændrede åbningstider tirsdag · 12:00–14:00',
      'Ændrede åbningstider onsdag · 12:00–14:00',
      'Ændrede åbningstider torsdag · 12:00–14:00',
      'Ændrede åbningstider fredag · 12:00–14:00',
      'Ændrede åbningstider lørdag · 12:00–14:00',
      'Ændrede åbningstider søndag · 12:00–14:00',
    ])
  })
})

// ---------------------------------------------------------------------------
// 2. A closed day
// ---------------------------------------------------------------------------

describe('a one-off closure', () => {
  it('is neutral, and expires when the day would normally have closed', () => {
    const announcement = suggestion(
      generate({ date: DESIGN_MONDAY, override: CLOSED, schedule: MONDAY_OPEN_SCHEDULE }),
    )

    expect(announcement.message).toBe('Lukket mandag 21.09')
    expect(announcement.expires_at).toBe('2026-09-21T18:00:00.000Z') // 20:00 CEST
  })

  it('invents no reason — the override model has no field for one', () => {
    const announcement = suggestion(
      generate({ date: DESIGN_MONDAY, override: CLOSED, schedule: MONDAY_OPEN_SCHEDULE }),
    )

    // 1ac's older shorthand reads "Lukket mandag 21.09 — privat arrangement". The
    // second half is a claim nobody made.
    for (const invented of ['—', 'privat arrangement', 'sygdom', 'ferie', 'vedligeholdelse']) {
      expect(announcement.message).not.toContain(invented)
    }
  })

  it('changes nothing on a day the week already closes', () => {
    // Monday is closed in the confirmed week. An override row exists; a change does not.
    expect(generate({ date: DESIGN_MONDAY, override: CLOSED })).toEqual({
      ok: false,
      reason: 'no_effect',
    })
  })

  it('changes nothing on any day of a week that is closed throughout', () => {
    for (const date of ['2026-09-14', '2026-09-16', '2026-09-19', DESIGN_SUNDAY]) {
      expect(generate({ date, override: CLOSED, schedule: ALWAYS_CLOSED_SCHEDULE })).toEqual({
        ok: false,
        reason: 'no_effect',
      })
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Nothing to announce
// ---------------------------------------------------------------------------

describe('an override that restates the week', () => {
  it('is not a change, and gets no message', () => {
    // Sunday is already 17:00–20:00. Saying so again tells a guest nothing.
    expect(generate({ date: DESIGN_SUNDAY, override: custom('17:00', '20:00') })).toEqual({
      ok: false,
      reason: 'no_effect',
    })
  })

  it('is refused whichever way the stored times are written', () => {
    expect(generate({ date: DESIGN_SUNDAY, override: custom('17:00:00', '20:00:00') })).toEqual({
      ok: false,
      reason: 'no_effect',
    })
  })

  it('is a change again as soon as either end moves by a minute', () => {
    expect(generate({ date: DESIGN_SUNDAY, override: custom('17:00', '20:01') }).ok).toBe(true)
    expect(generate({ date: DESIGN_SUNDAY, override: custom('16:59', '20:00') }).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. Copenhagen, in both offsets and across both transitions
// ---------------------------------------------------------------------------

describe('the expiry is an instant, resolved in Europe/Copenhagen', () => {
  it.each([
    ['normal CET', '2026-01-11', '2026-01-11T19:00:00.000Z'],
    ['normal CEST', '2026-07-12', '2026-07-12T18:00:00.000Z'],
    ['the spring transition day', '2026-03-29', '2026-03-29T18:00:00.000Z'],
    ['the autumn transition day', '2026-10-25', '2026-10-25T19:00:00.000Z'],
  ])('closes at 20:00 Copenhagen on %s', (_case, date, expected) => {
    // Every one of these is a Sunday: 17:00–20:00 in the confirmed week, shortened to
    // 17:00–19:00, so the expiry is the normal 20:00 in each case.
    const announcement = suggestion(generate({ date, override: custom('17:00', '19:00') }))

    expect(announcement.expires_at).toBe(expected)
  })

  it.each([
    ['the Saturday before the spring change is still CET', '2026-03-28', '2026-03-28T19:00:00.000Z'],
    ['the Saturday before the autumn change is still CEST', '2026-10-24', '2026-10-24T18:00:00.000Z'],
  ])('%s', (_case, date, expected) => {
    // The same wall clock, one day earlier, is a different instant — which is what
    // `YYYY-MM-DD + HH:MM + "Z"` would silently get wrong.
    const announcement = suggestion(generate({ date, override: custom('17:00', '19:00') }))

    expect(announcement.expires_at).toBe(expected)
  })

  it('refuses an unreadable clock rather than answering "not expired"', () => {
    expect(() =>
      generate({ date: DESIGN_SUNDAY, override: custom('17:00', '19:00'), now: new Date('nonsense') }),
    ).toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// 5. Already past
// ---------------------------------------------------------------------------

describe('an expiry that has already passed', () => {
  const request = { date: DESIGN_SUNDAY, override: custom('17:00', '19:00') }

  it('is refused rather than moved forward', () => {
    expect(generate({ ...request, now: new Date('2026-09-13T18:00:01.000Z') })).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('is refused at exactly the expiry instant — the boundary is inclusive', () => {
    // The same boundary the anonymous RLS policy keeps: `expires_at > now()`.
    expect(generate({ ...request, now: new Date('2026-09-13T18:00:00.000Z') })).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('is a suggestion one millisecond earlier', () => {
    const result = generate({ ...request, now: new Date('2026-09-13T17:59:59.999Z') })

    expect(result.ok).toBe(true)
  })

  it('is refused for a date in the past, without a second date rule', () => {
    expect(generate({ ...request, now: new Date('2026-12-01T12:00:00.000Z') })).toEqual({
      ok: false,
      reason: 'expired',
    })
  })
})

// ---------------------------------------------------------------------------
// 6. The output itself
// ---------------------------------------------------------------------------

describe('what the suggestion carries', () => {
  const changed = suggestion(generate({ date: DESIGN_SUNDAY, override: custom('17:00', '19:00') }))
  const closed = suggestion(
    generate({ date: DESIGN_MONDAY, override: CLOSED, schedule: MONDAY_OPEN_SCHEDULE }),
  )

  it('always calls itself a generated opening-hours announcement', () => {
    expect(changed.source).toBe('opening_hours')
    expect(closed.source).toBe('opening_hours')
  })

  it('sends a changed-hours message to the hours table, labelled as 1ac draws it', () => {
    expect(changed.link_type).toBe('page')
    expect(changed.link_page).toBe('/find-os')
    expect(changed.link_label).toBe('Se tider')
    expect(changed.link_url).toBeNull()

    expect(GENERATED_HOURS_LINK_PAGE).toBe('/find-os')
    expect(GENERATED_HOURS_LINK_LABEL).toBe('Se tider')
  })

  it('points only at a route the closed set already allows', () => {
    expect(ANNOUNCEMENT_LINK_PAGES).toContain(GENERATED_HOURS_LINK_PAGE)
  })

  it('gives a closed message no link at all — 1ac: “ingen tom knap, ingen pil”', () => {
    expect(closed.link_type).toBe('none')
    expect(closed.link_page).toBeNull()
    expect(closed.link_url).toBeNull()
    expect(closed.link_label).toBeNull()
  })

  it('is a payload `replaceAnnouncement()` would accept', () => {
    // The 8C-3 caller passes this straight through, so the shape is asserted against
    // the parser that guards it rather than against a copy of its rules.
    for (const announcement of [changed, closed]) {
      const replacement: AnnouncementReplacement = announcement
      expect(parseAnnouncementReplacement(replacement)).not.toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// 7. The 90-character ceiling
// ---------------------------------------------------------------------------

describe('1ac’s 90-character rule', () => {
  it('holds for the longest generated string either form can produce', () => {
    // Every weekday, the widest clock faces the model allows, and a December date —
    // the combination with the most characters in it.
    const dates = ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20']

    expect(dates).toHaveLength(WEEKDAY_KEYS.length)

    const messages = dates.flatMap((date) => [
      suggestion(generate({ date, override: custom('00:00', '23:59'), schedule: ALWAYS_CLOSED_SCHEDULE }))
        .message,
      suggestion(generate({ date, override: CLOSED, schedule: ALWAYS_OPEN_SCHEDULE })).message,
    ])

    for (const message of messages) {
      expect(message.length, message).toBeLessThanOrEqual(ANNOUNCEMENT_MESSAGE_MAX_LENGTH)
    }

    // Comfortably, rather than narrowly: the widest is 42 characters of the 90.
    expect(Math.max(...messages.map((message) => message.length))).toBeLessThanOrEqual(45)
  })

  it('never truncates — no generated message ends in an ellipsis', () => {
    const announcement = suggestion(generate({ date: DESIGN_SUNDAY, override: custom('17:00', '19:00') }))

    expect(announcement.message).not.toContain('…')
    expect(announcement.message.trim()).toBe(announcement.message)
  })
})

// ---------------------------------------------------------------------------
// 8. Pure
// ---------------------------------------------------------------------------

describe('the generator is pure', () => {
  const request: GeneratedAnnouncementRequest = {
    date: DESIGN_SUNDAY,
    override: custom('17:00', '19:00'),
    schedule: CONFIRMED_SCHEDULE,
    now: BEFORE_EVERYTHING,
  }

  it('gives the same answer to the same question', () => {
    expect(generateOpeningHoursAnnouncement(request)).toEqual(
      generateOpeningHoursAnnouncement(request),
    )
  })

  it('returns a fresh object each time, so a caller cannot edit a shared default', () => {
    const first = suggestion(generateOpeningHoursAnnouncement(request))
    const second = suggestion(generateOpeningHoursAnnouncement(request))

    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })

  it('mutates nothing it is given', () => {
    const override = custom('17:00', '19:00')
    const schedule: WeeklySchedule = { ...CONFIRMED_SCHEDULE }
    const now = new Date(BEFORE_EVERYTHING)

    const before = JSON.stringify({ override, schedule, now })

    generateOpeningHoursAnnouncement({ date: DESIGN_SUNDAY, override, schedule, now })

    expect(JSON.stringify({ override, schedule, now })).toBe(before)
  })

  it('works on frozen input', () => {
    const frozen: GeneratedAnnouncementRequest = Object.freeze({
      date: DESIGN_SUNDAY,
      override: Object.freeze(custom('17:00', '19:00')),
      schedule: Object.freeze({ ...CONFIRMED_SCHEDULE }),
      now: BEFORE_EVERYTHING,
    })

    expect(suggestion(generateOpeningHoursAnnouncement(frozen)).message).toBe(
      'Ændrede åbningstider søndag · 17:00–19:00',
    )
  })
})
