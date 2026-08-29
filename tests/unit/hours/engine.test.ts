import { describe, expect, it } from 'vitest'

import {
  MAX_OPENING_SEARCH_DAYS,
  findFirstOpeningFrom,
  findNextOpening,
  getDayOpening,
  getOpenState,
} from '@/lib/hours/engine'
import type { OpeningHoursOverride } from '@/lib/hours/types'
import { addDays } from '@/lib/time/calendar'
import {
  ALWAYS_CLOSED_SCHEDULE,
  CONFIRMED_SCHEDULE,
  closedOverride,
  customOverride,
} from '../fixtures/hours'

/**
 * `now` is always written as an absolute UTC instant, and the Copenhagen wall clock it
 * corresponds to is stated in the test name. Nothing here depends on the host
 * timezone; `tests/unit/time/host-timezone.test.ts` proves it.
 *
 * Reference week: 2026-08-24 (Mon) – 2026-08-30 (Sun), Danish summer time (UTC+2).
 */

const openState = (now: string, overrides: OpeningHoursOverride[] = []) =>
  getOpenState(new Date(now), CONFIRMED_SCHEDULE, overrides)

const nextOpening = (now: string, overrides: OpeningHoursOverride[] = []) =>
  findNextOpening(new Date(now), CONFIRMED_SCHEDULE, overrides)

describe('getDayOpening', () => {
  it("returns today's applicable hours for an open day", () => {
    expect(getDayOpening('2026-08-26', CONFIRMED_SCHEDULE, [])).toMatchObject({
      date: '2026-08-26',
      weekday: 'wed',
      isOpen: true,
      from: '15:00',
      to: '20:00',
      source: 'weekly',
    })
  })

  it('returns a closed day', () => {
    expect(getDayOpening('2026-08-24', CONFIRMED_SCHEDULE, [])).toMatchObject({
      isOpen: false,
      source: 'weekly',
    })
  })
})

describe('getOpenState — every weekday of the confirmed schedule', () => {
  // 18:00 Copenhagen (16:00Z in summer) falls inside both the Wed–Fri and the Sat–Sun
  // service, so one instant per day is enough to separate open days from closed ones.
  it.each([
    ['Monday', '2026-08-24T16:00:00Z', false],
    ['Tuesday', '2026-08-25T16:00:00Z', false],
    ['Wednesday', '2026-08-26T16:00:00Z', true],
    ['Thursday', '2026-08-27T16:00:00Z', true],
    ['Friday', '2026-08-28T16:00:00Z', true],
    ['Saturday', '2026-08-29T16:00:00Z', true],
    ['Sunday', '2026-08-30T16:00:00Z', true],
  ])('%s at 18:00 local', (_label, now, expected) => {
    expect(openState(now).isOpen).toBe(expected)
  })
})

describe('getOpenState — the boundaries of one Wednesday service', () => {
  // Wednesday 2026-08-26, 15:00–20:00 local = 13:00Z–18:00Z.
  it.each([
    ['a minute before opening (14:59)', '2026-08-26T12:59:00Z', false],
    ['one second before opening (14:59:59)', '2026-08-26T12:59:59Z', false],
    ['the exact opening instant (15:00)', '2026-08-26T13:00:00Z', true],
    ['a second after opening', '2026-08-26T13:00:01Z', true],
    ['during service (18:00)', '2026-08-26T16:00:00Z', true],
    ['one second before closing (19:59:59)', '2026-08-26T17:59:59Z', true],
    ['the exact closing instant (20:00)', '2026-08-26T18:00:00Z', false],
    ['a minute after closing (20:01)', '2026-08-26T18:01:00Z', false],
    ['just after local midnight', '2026-08-25T22:00:01Z', false],
  ])('%s', (_label, now, expected) => {
    expect(openState(now).isOpen).toBe(expected)
  })

  it('opening is inclusive and closing is exclusive', () => {
    // Stated as its own assertion because it is the rule the "til kl. 20:00" label
    // depends on: at 20:00 sharp the restaurant is shut, not open.
    expect(openState('2026-08-26T13:00:00Z').isOpen).toBe(true)
    expect(openState('2026-08-26T18:00:00Z').isOpen).toBe(false)
  })

  it('reports the closing instant while open, and none while closed', () => {
    const open = openState('2026-08-26T16:00:00Z')
    expect(open.isOpen && open.closesAt.toISOString()).toBe('2026-08-26T18:00:00.000Z')
    expect(openState('2026-08-26T18:00:00Z').closesAt).toBeNull()
  })

  it("always carries today's hours, open or closed", () => {
    expect(openState('2026-08-26T12:00:00Z').today).toMatchObject({ isOpen: true, from: '15:00' })
    expect(openState('2026-08-24T12:00:00Z').today).toMatchObject({ isOpen: false, weekday: 'mon' })
  })
})

describe('getOpenState — overrides', () => {
  it('a closure override shuts a normally open day', () => {
    const state = openState('2026-08-26T16:00:00Z', [closedOverride('2026-08-26')])
    expect(state.isOpen).toBe(false)
    expect(state.today).toMatchObject({ isOpen: false, source: 'override' })
  })

  it('a custom override replaces the hours of a normally open day', () => {
    const overrides = [customOverride('2026-08-26', '15:00', '18:00')]
    expect(openState('2026-08-26T15:00:00Z', overrides).isOpen).toBe(true) // 17:00 local
    expect(openState('2026-08-26T16:00:00Z', overrides).isOpen).toBe(false) // 18:00 local
  })

  it('a custom override opens a normally closed Monday', () => {
    const overrides = [customOverride('2026-08-24', '12:00', '16:00')]
    expect(openState('2026-08-24T09:59:00Z', overrides).isOpen).toBe(false) // 11:59 local
    expect(openState('2026-08-24T10:00:00Z', overrides).isOpen).toBe(true) // 12:00 local
    expect(openState('2026-08-24T13:59:00Z', overrides).isOpen).toBe(true) // 15:59 local
    expect(openState('2026-08-24T14:00:00Z', overrides).isOpen).toBe(false) // 16:00 local
  })

  it('ignores an unpublished override', () => {
    const draft: OpeningHoursOverride = { ...closedOverride('2026-08-26'), status: 'draft' }
    expect(openState('2026-08-26T16:00:00Z', [draft]).isOpen).toBe(true)
  })
})

describe('findNextOpening', () => {
  it('is later the same day when the doors have not opened yet', () => {
    const opening = nextOpening('2026-08-26T10:00:00Z') // Wednesday 12:00 local
    expect(opening?.date).toBe('2026-08-26')
    expect(opening?.opensAt.toISOString()).toBe('2026-08-26T13:00:00.000Z')
  })

  it('is the next day once today is already open', () => {
    const opening = nextOpening('2026-08-26T16:00:00Z') // Wednesday 18:00 local
    expect(opening?.date).toBe('2026-08-27')
  })

  it('is the next day once today has closed', () => {
    const opening = nextOpening('2026-08-26T18:00:00Z') // Wednesday 20:00 local sharp
    expect(opening?.date).toBe('2026-08-27')
    expect(opening?.opensAt.toISOString()).toBe('2026-08-27T13:00:00.000Z')
  })

  it('skips the two normally closed days', () => {
    const opening = nextOpening('2026-08-30T18:00:00Z') // Sunday 20:00 local, after closing
    expect(opening).toMatchObject({ date: '2026-09-02', weekday: 'wed', from: '15:00' })
  })

  it('skips a day closed by an override', () => {
    const opening = nextOpening('2026-08-28T18:00:00Z', [closedOverride('2026-08-29')])
    expect(opening?.date).toBe('2026-08-30')
  })

  it('lands on a normally closed day that an override opens', () => {
    const opening = nextOpening('2026-08-30T18:00:00Z', [customOverride('2026-08-31', '12:00', '16:00')])
    expect(opening).toMatchObject({ date: '2026-08-31', weekday: 'mon', source: 'override' })
    expect(opening?.opensAt.toISOString()).toBe('2026-08-31T10:00:00.000Z')
  })

  it('never returns an opening that has already begun', () => {
    const now = new Date('2026-08-26T13:00:00Z') // the exact opening instant
    const opening = findNextOpening(now, CONFIRMED_SCHEDULE, [])
    expect(opening?.opensAt.getTime()).toBeGreaterThan(now.getTime())
    expect(opening?.date).toBe('2026-08-27')
  })
})

describe('findFirstOpeningFrom', () => {
  it('includes the start date itself when it is an opening day', () => {
    const opening = findFirstOpeningFrom('2026-08-26', CONFIRMED_SCHEDULE, [])
    expect(opening?.date).toBe('2026-08-26')
  })

  it('resolves both instants of the opening it finds', () => {
    const opening = findFirstOpeningFrom('2026-08-29', CONFIRMED_SCHEDULE, [])
    expect(opening?.opensAt.toISOString()).toBe('2026-08-29T15:00:00.000Z') // 17:00 local
    expect(opening?.closesAt.toISOString()).toBe('2026-08-29T18:00:00.000Z') // 20:00 local
  })

  it('walks forward over closed days', () => {
    expect(findFirstOpeningFrom('2026-08-31', CONFIRMED_SCHEDULE, [])?.date).toBe('2026-09-02')
  })
})

describe('the 60-day search cap', () => {
  it('is 60 days', () => {
    expect(MAX_OPENING_SEARCH_DAYS).toBe(60)
  })

  it('returns null when no day in the window is open', () => {
    expect(findFirstOpeningFrom('2026-08-24', ALWAYS_CLOSED_SCHEDULE, [])).toBeNull()
    expect(findNextOpening(new Date('2026-08-24T10:00:00Z'), ALWAYS_CLOSED_SCHEDULE, [])).toBeNull()
  })

  it('finds an opening on the last day inside the window', () => {
    const last = addDays('2026-08-24', MAX_OPENING_SEARCH_DAYS - 1)
    const opening = findFirstOpeningFrom('2026-08-24', ALWAYS_CLOSED_SCHEDULE, [
      customOverride(last, '15:00', '20:00'),
    ])
    expect(opening?.date).toBe(last)
  })

  it('does not find an opening one day past the window', () => {
    const justOutside = addDays('2026-08-24', MAX_OPENING_SEARCH_DAYS)
    expect(
      findFirstOpeningFrom('2026-08-24', ALWAYS_CLOSED_SCHEDULE, [
        customOverride(justOutside, '15:00', '20:00'),
      ]),
    ).toBeNull()
  })

  it('rejects a nonsensical window', () => {
    expect(() => findFirstOpeningFrom('2026-08-24', CONFIRMED_SCHEDULE, [], 0)).toThrow(/at least/i)
  })
})

describe('daylight saving — into summer time', () => {
  // Clocks go forward on Sunday 2026-03-29 at 02:00 CET → 03:00 CEST.
  it('opens at 17:00 local on the 23-hour Sunday', () => {
    const opening = findFirstOpeningFrom('2026-03-29', CONFIRMED_SCHEDULE, [])
    expect(opening?.opensAt.toISOString()).toBe('2026-03-29T15:00:00.000Z')
    expect(opening?.closesAt.toISOString()).toBe('2026-03-29T18:00:00.000Z')
  })

  it('is closed at 16:59 local and open at 17:00 local that day', () => {
    expect(openState('2026-03-29T14:59:00Z').isOpen).toBe(false)
    expect(openState('2026-03-29T15:00:00Z').isOpen).toBe(true)
  })

  it('is still open at the same wall-clock time the day before the change', () => {
    // Saturday 2026-03-28 is still CET (+1), so the 17:00 local opening is 16:00Z —
    // an hour later in UTC than the same wall clock will be from Sunday onwards.
    expect(openState('2026-03-28T15:59:00Z').isOpen).toBe(false) // 16:59 local
    expect(openState('2026-03-28T16:00:00Z').isOpen).toBe(true) // 17:00 local, sharp
    expect(openState('2026-03-28T18:59:00Z').isOpen).toBe(true) // 19:59 local
    expect(openState('2026-03-28T19:00:00Z').isOpen).toBe(false) // 20:00 local, sharp
  })

  it('finds the next opening across the transition', () => {
    // Saturday 2026-03-28 21:00 CET, after closing → Sunday 17:00 CEST.
    const opening = nextOpening('2026-03-28T20:00:00Z')
    expect(opening?.date).toBe('2026-03-29')
    expect(opening?.opensAt.toISOString()).toBe('2026-03-29T15:00:00.000Z')
  })

  it('crosses the skipped hour when scanning forward', () => {
    const opening = findFirstOpeningFrom('2026-03-30', CONFIRMED_SCHEDULE, [])
    expect(opening).toMatchObject({ date: '2026-04-01', weekday: 'wed' })
    expect(opening?.opensAt.toISOString()).toBe('2026-04-01T13:00:00.000Z') // 15:00 CEST
  })
})

describe('daylight saving — back into winter time', () => {
  // Clocks go back on Sunday 2026-10-25 at 03:00 CEST → 02:00 CET.
  it('opens at 17:00 local on the 25-hour Sunday', () => {
    const opening = findFirstOpeningFrom('2026-10-25', CONFIRMED_SCHEDULE, [])
    expect(opening?.opensAt.toISOString()).toBe('2026-10-25T16:00:00.000Z')
    expect(opening?.closesAt.toISOString()).toBe('2026-10-25T19:00:00.000Z')
  })

  it('is closed at 16:59 local and open at 17:00 local that day', () => {
    expect(openState('2026-10-25T15:59:00Z').isOpen).toBe(false)
    expect(openState('2026-10-25T16:00:00Z').isOpen).toBe(true)
  })

  it('is not fooled by the repeated hour', () => {
    // 02:30 local happens twice; the restaurant is shut through both of them.
    expect(openState('2026-10-25T00:30:00Z').isOpen).toBe(false)
    expect(openState('2026-10-25T01:30:00Z').isOpen).toBe(false)
  })

  it('finds the next opening across the transition', () => {
    // Sunday 2026-10-25 20:00 CET = 19:00Z, after closing → Wednesday 15:00 CET.
    const opening = nextOpening('2026-10-25T19:00:00Z')
    expect(opening).toMatchObject({ date: '2026-10-28', weekday: 'wed' })
    expect(opening?.opensAt.toISOString()).toBe('2026-10-28T14:00:00.000Z')
  })

  it('keeps the same wall-clock opening either side of the change', () => {
    const before = findFirstOpeningFrom('2026-10-24', CONFIRMED_SCHEDULE, [])
    const after = findFirstOpeningFrom('2026-10-28', CONFIRMED_SCHEDULE, [])
    expect(before?.from).toBe('17:00')
    expect(after?.from).toBe('15:00')
    // Saturday opens at 17:00 CEST = 15:00Z; Wednesday at 15:00 CET = 14:00Z. The
    // wall clock is what the schedule promises, not a fixed UTC hour.
    expect(before?.opensAt.toISOString()).toBe('2026-10-24T15:00:00.000Z')
    expect(after?.opensAt.toISOString()).toBe('2026-10-28T14:00:00.000Z')
  })
})

describe('engine purity and input validation', () => {
  it('does not mutate the schedule or overrides', () => {
    const schedule = structuredClone(CONFIRMED_SCHEDULE)
    const overrides = [closedOverride('2026-08-26'), customOverride('2026-08-24', '12:00', '16:00')]
    const scheduleBefore = structuredClone(schedule)
    const overridesBefore = structuredClone(overrides)

    getOpenState(new Date('2026-08-26T16:00:00Z'), schedule, overrides)
    findNextOpening(new Date('2026-08-26T16:00:00Z'), schedule, overrides)
    findFirstOpeningFrom('2026-08-24', schedule, overrides)

    expect(schedule).toEqual(scheduleBefore)
    expect(overrides).toEqual(overridesBefore)
  })

  it('returns a fresh Date each call, so a caller cannot corrupt the next answer', () => {
    const first = findFirstOpeningFrom('2026-08-26', CONFIRMED_SCHEDULE, [])
    first?.opensAt.setUTCFullYear(1999)
    expect(findFirstOpeningFrom('2026-08-26', CONFIRMED_SCHEDULE, [])?.opensAt.toISOString()).toBe(
      '2026-08-26T13:00:00.000Z',
    )
  })

  it('rejects an invalid instant', () => {
    expect(() => getOpenState(new Date('nonsense'), CONFIRMED_SCHEDULE, [])).toThrow(/instant/i)
  })

  it('rejects a malformed start date', () => {
    expect(() => findFirstOpeningFrom('2026-02-30', CONFIRMED_SCHEDULE, [])).toThrow(/date/i)
  })
})
