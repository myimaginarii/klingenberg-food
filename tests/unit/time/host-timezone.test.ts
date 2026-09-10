import { afterAll, describe, expect, it } from 'vitest'

import { announcementFrom } from '@/lib/content/load/announcement'
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
 * The site is built wherever CI runs, which is UTC, and a developer may be anywhere.
 *
 * So this file re-runs a cross-section of the engines under host timezones chosen to
 * break a machine-local implementation in every direction: UTC, the two extremes of the
 * offset range (UTC+14 and UTC−11), a zone with a half-hour offset, and a southern
 * hemisphere zone whose daylight saving runs opposite to Denmark's. Every expected
 * value below is the same one asserted in the dedicated suites.
 *
 * The announcement expiry joined this file in phase 4F, and it is the case with the
 * sharpest teeth. `announcement.json` stores a Copenhagen wall clock with no offset in
 * it, and `new Date('2026-09-11T12:00')` — the obvious way to read one, and the way
 * this loader deliberately does **not** — is defined to mean local time. On a UTC
 * builder that is 12:00Z; on a New York laptop it is 16:00Z. The bar would then vanish
 * at a different moment depending on where the site was last built, and nothing about
 * the file would have changed. So the loader is run here under every host zone and the
 * answer is asserted to be one instant.
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

  it('resolves an announcement expiry to the same instant', () => {
    const expiry = (expiresAt: string) =>
      inZone(
        () =>
          announcementFrom(
            { active: true, message: 'Hej', expiresAt },
            'content/site/announcement.json',
          )?.expiresAt,
      )

    // Summer and winter, the two readings of the same written noon.
    expect(expiry('2026-09-11T12:00')).toBe('2026-09-11T10:00:00.000Z')
    expect(expiry('2026-12-11T12:00')).toBe('2026-12-11T11:00:00.000Z')

    // Midnight is where a host-local reading goes wrong by a whole calendar day rather
    // than by hours, so it is worth one assertion of its own.
    expect(expiry('2026-01-01T00:00')).toBe('2025-12-31T23:00:00.000Z')

    // And the two wall clocks Denmark's own transitions make awkward, held to the same
    // deterministic answers `copenhagenInstantOf` gives in the business timezone.
    expect(expiry('2026-03-29T02:30')).toBe('2026-03-29T01:30:00.000Z')
    expect(expiry('2026-10-25T02:30')).toBe('2026-10-25T00:30:00.000Z')
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
