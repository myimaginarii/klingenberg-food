import { describe, expect, it } from 'vitest'

import {
  decodeMonthlyErrors,
  encodeMonthlyEcho,
  monthlyErrorField,
  monthlyFormValues,
  MONTHLY_ERROR_FIELD,
  MONTHLY_ERROR_MESSAGES,
  readMonthlyForm,
  toMonthlySubmission,
  type MonthlyErrorCode,
  type MonthlyFormValues,
} from '@/app/(admin)/admin/menu/maanedens-burger/forms'
import type { MonthlyBurgerValues } from '@/lib/menu/monthly'
import type { IsoDate } from '@/lib/time/calendar'

/**
 * Reading 1ah's card — phase 6B, §4, §7d.
 *
 * The parsing layer, asserted on its own: what a person typed becomes values, or becomes
 * messages, and never becomes a guess. The properties worth naming:
 *
 *   * blank is absent, everywhere, so an empty singleton round-trips unchanged;
 *   * a date is a **calendar** date, not merely something shaped like one;
 *   * `starts_on <= ends_on` is stated here as well as by the column CHECK, so a person
 *      is told rather than meeting a constraint violation at publish;
 *   * there is no calendar-month rule, and no field that is required.
 */

function form(overrides: Partial<MonthlyFormValues> = {}): MonthlyFormValues {
  return {
    name: 'Efterårsburgeren',
    description: 'Bøf, bacon og rygeostcreme.',
    price: '129',
    startsOn: '2026-09-01',
    endsOn: '2026-09-30',
    showOnHomepage: true,
    ...overrides,
  }
}

function errorsOf(values: Partial<MonthlyFormValues>): readonly MonthlyErrorCode[] {
  const result = toMonthlySubmission(form(values))
  return result.ok ? [] : result.errors
}

describe('toMonthlySubmission', () => {
  it('maps a filled card to values in database casing', () => {
    const result = toMonthlySubmission(form())

    expect(result).toEqual({
      ok: true,
      values: {
        name: 'Efterårsburgeren',
        description: 'Bøf, bacon og rygeostcreme.',
        price_ore: 12900,
        starts_on: '2026-09-01',
        ends_on: '2026-09-30',
        show_on_homepage: true,
      },
    })
  })

  it('requires nothing: the empty singleton is a legitimate submission', () => {
    const result = toMonthlySubmission(
      form({ name: '', description: '', price: '', startsOn: '', endsOn: '', showOnHomepage: false }),
    )

    expect(result).toEqual({
      ok: true,
      values: {
        name: null,
        description: null,
        price_ore: null,
        starts_on: null,
        ends_on: null,
        show_on_homepage: false,
      },
    })
  })

  it('treats blank and whitespace as absent, not as an empty string', () => {
    const result = toMonthlySubmission(form({ name: '   ', description: '\n ' }))

    expect(result.ok && result.values.name).toBeNull()
    expect(result.ok && result.values.description).toBeNull()
  })

  it('parses a Danish price through the phase-5 rules', () => {
    expect(errorsOf({ price: '129,50' })).toEqual([])
    expect(toMonthlySubmission(form({ price: '129,50' }))).toMatchObject({
      values: { price_ore: 12950 },
    })
  })

  it('refuses a price that is not a number, rather than guessing at one', () => {
    expect(errorsOf({ price: '129 kr' })).toEqual(['pris:not_a_number'])
  })

  it('refuses a date that is shaped right but is not in the calendar', () => {
    expect(errorsOf({ startsOn: '2026-02-31' })).toEqual(['start:invalid'])
    expect(errorsOf({ endsOn: '2026-13-01' })).toEqual(['slut:invalid'])
  })

  it('accepts 29 February in a leap year and refuses it in an ordinary one', () => {
    expect(errorsOf({ startsOn: '2028-02-29', endsOn: '2028-03-31' })).toEqual([])
    expect(errorsOf({ startsOn: '2027-02-29', endsOn: '2027-03-31' })).toEqual([
      'start:invalid',
    ])
  })

  it('refuses an end date before the start date, on the end field', () => {
    const errors = errorsOf({ startsOn: '2026-09-30', endsOn: '2026-09-01' })

    expect(errors).toEqual(['slut:before_start'])
    expect(monthlyErrorField(errors[0] as MonthlyErrorCode)).toBe('slut')
  })

  it('accepts a one-day window', () => {
    expect(errorsOf({ startsOn: '2026-09-01', endsOn: '2026-09-01' })).toEqual([])
  })

  it('accepts a window that crosses a month boundary — there is no month rule', () => {
    expect(errorsOf({ startsOn: '2026-09-15', endsOn: '2026-10-14' })).toEqual([])
  })

  it('accepts each end on its own', () => {
    expect(errorsOf({ startsOn: '2026-09-01', endsOn: '' })).toEqual([])
    expect(errorsOf({ startsOn: '', endsOn: '2026-09-30' })).toEqual([])
  })

  it('does not add an ordering message when a date could not be read at all', () => {
    // One mistake, one message. "The end is before the start" about a date nobody could
    // parse would be a second sentence about the same typo.
    expect(errorsOf({ startsOn: '2026-02-31', endsOn: '2026-01-01' })).toEqual([
      'start:invalid',
    ])
  })

  it('reports every problem at once, so a correction is one pass', () => {
    expect(
      errorsOf({ name: 'x'.repeat(201), description: 'y'.repeat(601), price: 'nej' }),
    ).toEqual(['navn:too_long', 'beskrivelse:too_long', 'pris:not_a_number'])
  })

  it('has a sentence for every code it can produce', () => {
    for (const code of Object.keys(MONTHLY_ERROR_MESSAGES) as MonthlyErrorCode[]) {
      expect(MONTHLY_ERROR_MESSAGES[code].length).toBeGreaterThan(0)
    }
  })
})

describe('readMonthlyForm', () => {
  it('reads an absent checkbox as off, the way a checkbox works', () => {
    expect(readMonthlyForm(new URLSearchParams()).showOnHomepage).toBe(false)
    expect(readMonthlyForm(new URLSearchParams('forside=1')).showOnHomepage).toBe(true)
  })

  it('reads a checkbox value that is not the one we render as off', () => {
    expect(readMonthlyForm(new URLSearchParams('forside=ja')).showOnHomepage).toBe(false)
  })

  it('reads a missing field as empty rather than undefined', () => {
    expect(readMonthlyForm(new URLSearchParams())).toEqual({
      name: '',
      description: '',
      price: '',
      startsOn: '',
      endsOn: '',
      showOnHomepage: false,
    })
  })
})

describe('the refusal round-trip', () => {
  it('carries the codes and what was typed, and reads back identically', () => {
    const typed = form({ price: '129 kr' })
    const encoded = encodeMonthlyEcho(typed, ['pris:not_a_number'])

    expect(decodeMonthlyErrors(encoded.getAll(MONTHLY_ERROR_FIELD))).toEqual([
      'pris:not_a_number',
    ])
    expect(readMonthlyForm(encoded)).toEqual(typed)
  })

  it('round-trips an unchecked toggle as unchecked', () => {
    const typed = form({ showOnHomepage: false, price: 'nej' })
    const encoded = encodeMonthlyEcho(typed, ['pris:not_a_number'])

    expect(readMonthlyForm(encoded).showOnHomepage).toBe(false)
  })

  it('ignores a code this application did not define', () => {
    expect(decodeMonthlyErrors(['navn:too_long', 'pris:hack', ''])).toEqual(['navn:too_long'])
  })
})

describe('monthlyFormValues', () => {
  const stored: MonthlyBurgerValues = {
    name: 'Efterårsburgeren',
    description: null,
    price_ore: 12950,
    image_id: null,
    starts_on: '2026-09-01' as IsoDate,
    ends_on: null,
    show_on_homepage: false,
  }

  it('shows stored øre the way the field is typed into', () => {
    expect(monthlyFormValues(stored).price).toBe('129,50')
  })

  it('puts the dates in unchanged — the wire format is the field format', () => {
    expect(monthlyFormValues(stored).startsOn).toBe('2026-09-01')
    expect(monthlyFormValues(stored).endsOn).toBe('')
  })

  it('round-trips a stored row through the form and back without moving it', () => {
    const result = toMonthlySubmission(monthlyFormValues(stored))

    expect(result).toEqual({
      ok: true,
      values: {
        name: 'Efterårsburgeren',
        description: null,
        price_ore: 12950,
        starts_on: '2026-09-01',
        ends_on: null,
        show_on_homepage: false,
      },
    })
  })
})
