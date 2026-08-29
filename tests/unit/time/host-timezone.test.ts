import { afterAll, describe, expect, it } from 'vitest'

import { findNextOpening, getOpenState } from '@/lib/hours/engine'
import { describeOpenState, formatWeekdayTime } from '@/lib/hours/format'
import { resolveSoldOut } from '@/lib/menu/availability'
import { copenhagenDateOf, copenhagenInstantOf } from '@/lib/time/copenhagen'
import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * The engines must be correct on any machine — technical plan §7.
 *
 * `vitest.config.mts` sets `TZ=Europe/Copenhagen`, which is convenient and completely
 * untrustworthy as a guarantee: a suite that only ever runs in the business timezone
 * cannot tell a correct implementation from one that quietly uses `Date#getHours()`.
 * Production runs on Vercel in UTC, and a developer may be anywhere.
 *
 * So this file re-runs a cross-section of the engines under host timezones chosen to
 * break a machine-local implementation in every direction: UTC, the two extremes of the
 * offset range (UTC+14 and UTC−11), a zone with a half-hour offset, and a southern
 * hemisphere zone whose daylight saving runs opposite to Denmark's. Every expected
 * value below is the same one asserted in the dedicated suites.
 *
 * Node re-reads `process.env.TZ` for subsequent `Date` operations, and the guard in
 * `runInHostTimezone` fails the test if a platform ever stops honouring that — a silent
 * no-op here would turn this file into decoration.
 */

const ORIGINAL_TZ = process.env.TZ

const HOST_TIMEZONES = [
  'UTC',
  'Europe/Copenhagen',
  'Pacific/Kiritimati', // UTC+14, the furthest ahead of Denmark
  'Pacific/Midway', // UTC−11, the furthest behind
  'Asia/Kolkata', // UTC+05:30, a half-hour offset
  'Australia/Sydney', // daylight saving in the opposite half of the year
  'America/New_York',
]

function runInHostTimezone<T>(timeZone: string, body: () => T): T {
  process.env.TZ = timeZone
  try {
    return body()
  } finally {
    process.env.TZ = ORIGINAL_TZ
  }
}

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

describe('the host timezone is genuinely changing', () => {
  it('moves the machine-local reading of a fixed instant', () => {
    // If this stops being true the rest of the file proves nothing, so it is asserted
    // rather than assumed.
    const instant = new Date('2026-08-26T13:00:00Z')
    const hours = HOST_TIMEZONES.map((timeZone) =>
      runInHostTimezone(timeZone, () => instant.getHours()),
    )
    expect(new Set(hours).size).toBeGreaterThan(1)
  })

  it('restores the original timezone after each run', () => {
    runInHostTimezone('Pacific/Kiritimati', () => undefined)
    expect(process.env.TZ).toBe(ORIGINAL_TZ)
  })
})

describe.each(HOST_TIMEZONES)('with the host machine in %s', (timeZone) => {
  const inZone = <T,>(body: () => T): T => runInHostTimezone(timeZone, body)

  it('reads the Copenhagen date of an instant', () => {
    // 22:30Z on 14 July is already 15 July in Copenhagen, and is still 14 July in
    // New York — a machine-local implementation disagrees here.
    expect(inZone(() => copenhagenDateOf(new Date('2026-07-14T22:30:00Z')))).toBe('2026-07-15')
  })

  it('converts a Copenhagen wall clock to the same instant', () => {
    expect(inZone(() => copenhagenInstantOf('2026-08-26', '15:00').toISOString())).toBe(
      '2026-08-26T13:00:00.000Z',
    )
    expect(inZone(() => copenhagenInstantOf('2026-01-14', '15:00').toISOString())).toBe(
      '2026-01-14T14:00:00.000Z',
    )
  })

  it('decides open and closed at the same instants', () => {
    const isOpen = (now: string) =>
      inZone(() => getOpenState(new Date(now), CONFIRMED_SCHEDULE, []).isOpen)

    expect(isOpen('2026-08-26T12:59:59Z')).toBe(false) // 14:59:59 local
    expect(isOpen('2026-08-26T13:00:00Z')).toBe(true) // 15:00 sharp
    expect(isOpen('2026-08-26T17:59:59Z')).toBe(true) // 19:59:59 local
    expect(isOpen('2026-08-26T18:00:00Z')).toBe(false) // 20:00 sharp
  })

  it('finds the same next opening across both DST transitions', () => {
    const next = (now: string) =>
      inZone(() => findNextOpening(new Date(now), CONFIRMED_SCHEDULE, [])?.opensAt.toISOString())

    expect(next('2026-03-28T20:00:00Z')).toBe('2026-03-29T15:00:00.000Z')
    expect(next('2026-10-25T19:00:00Z')).toBe('2026-10-28T14:00:00.000Z')
  })

  it('resolves the sold-out reset to the same instant', () => {
    const clearsAt = (soldOutOn: string, now: string) =>
      inZone(() =>
        resolveSoldOut(soldOutOn, CONFIRMED_SCHEDULE, [], new Date(now)).clearsAt?.toISOString(),
      )

    // Every worked example from §7b that crosses a day boundary.
    expect(clearsAt('2026-08-26', '2026-08-26T16:00:00Z')).toBe('2026-08-27T13:00:00.000Z')
    expect(clearsAt('2026-08-30', '2026-08-30T18:00:00Z')).toBe('2026-09-02T13:00:00.000Z')
    expect(clearsAt('2026-03-29', '2026-03-29T18:00:00Z')).toBe('2026-04-01T13:00:00.000Z')
    expect(clearsAt('2026-10-25', '2026-10-25T19:00:00Z')).toBe('2026-10-28T14:00:00.000Z')
  })

  it('is sold out or not at the same instants', () => {
    const soldOut = (now: string) =>
      inZone(() => resolveSoldOut('2026-08-26', CONFIRMED_SCHEDULE, [], new Date(now)).soldOut)

    expect(soldOut('2026-08-27T12:59:59.999Z')).toBe(true)
    expect(soldOut('2026-08-27T13:00:00.000Z')).toBe(false)
  })

  it('formats the same Danish strings', () => {
    expect(inZone(() => formatWeekdayTime(new Date('2026-09-02T13:00:00Z')))).toBe(
      'onsdag kl. 15:00',
    )

    const status = inZone(() =>
      describeOpenState(getOpenState(new Date('2026-08-26T16:00:00Z'), CONFIRMED_SCHEDULE, [])),
    )
    expect(status.label).toBe('Åbent nu')
    expect(status.detail).toBe('til kl. 20:00')
  })
})
