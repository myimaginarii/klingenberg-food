import { describe, expect, it } from 'vitest'

import { readOpenStatus } from '@/lib/hours/status'
import { copenhagenInstantOf } from '@/lib/time/copenhagen'
import { CONFIRMED_SCHEDULE, closedOverride, customOverride } from '../fixtures/hours'

/**
 * The badge snapshot is what both halves of the open/closed status read: the server
 * renders it and the client recomputes it every minute. These tests pin the exact
 * strings the approved design prints, and that the value stays serialisable — no `Date`
 * may appear in it, or the server could not hand it to the client as a prop.
 */
describe('readOpenStatus', () => {
  it('words an open Wednesday exactly as design 1g does', () => {
    const status = readOpenStatus(
      copenhagenInstantOf('2026-09-02', '18:00'),
      CONFIRMED_SCHEDULE,
      [],
    )

    expect(status).toEqual({
      isOpen: true,
      label: 'Åbent nu',
      detail: 'til kl. 20:00',
      todayLabel: 'Onsdag',
      todayWeekday: 'wed',
    })
  })

  it('gives a closed day a label and no second line', () => {
    const status = readOpenStatus(
      copenhagenInstantOf('2026-08-31', '18:00'),
      CONFIRMED_SCHEDULE,
      [],
    )

    expect(status.isOpen).toBe(false)
    expect(status.label).toBe('Lukket')
    expect(status.detail).toBeNull()
    expect(status.todayLabel).toBe('Mandag')
  })

  it('is closed at the closing instant and open at the opening instant', () => {
    const open = readOpenStatus(copenhagenInstantOf('2026-09-02', '15:00'), CONFIRMED_SCHEDULE, [])
    const shut = readOpenStatus(copenhagenInstantOf('2026-09-02', '20:00'), CONFIRMED_SCHEDULE, [])

    expect(open.isOpen).toBe(true)
    expect(shut.isOpen).toBe(false)
  })

  it('honours a published override that closes an ordinary opening day', () => {
    const status = readOpenStatus(
      copenhagenInstantOf('2026-09-02', '18:00'),
      CONFIRMED_SCHEDULE,
      [closedOverride('2026-09-02')],
    )

    expect(status.isOpen).toBe(false)
    expect(status.label).toBe('Lukket')
  })

  it('honours a published override that opens a normally closed Monday', () => {
    const status = readOpenStatus(
      copenhagenInstantOf('2026-08-31', '18:00'),
      CONFIRMED_SCHEDULE,
      [customOverride('2026-08-31', '17:00', '21:00')],
    )

    expect(status.isOpen).toBe(true)
    expect(status.detail).toBe('til kl. 21:00')
  })

  it('carries no Date, so it survives the server-to-client boundary unchanged', () => {
    const status = readOpenStatus(
      copenhagenInstantOf('2026-09-02', '18:00'),
      CONFIRMED_SCHEDULE,
      [],
    )

    expect(JSON.parse(JSON.stringify(status))).toEqual(status)
  })
})
