import { describe, expect, it } from 'vitest'

import {
  decodeWeeklyErrors,
  encodeSaturdayEcho,
  encodeWeekEcho,
  readSaturdayForm,
  readWeekForm,
  readWeeklyAvailabilityForm,
  readCopyForm,
  saturdayFormValues,
  toSaturdaySubmission,
  toWeekSubmission,
  weekFormValues,
  weeklyErrorField,
  WEEK_FORM,
  SATURDAY_FORM,
  WEEKLY_AVAILABILITY_FORM,
  COPY_FORM,
  type WeekFormValues,
  type SaturdayFormValues,
} from '@/app/(admin)/admin/menu/ugens-ret/forms'
import type { WeeklySpecialValues } from '@/lib/menu/weekly'

/**
 * The Ugens ret screen's four submitted vocabularies — phase 6A, §8.
 *
 * Two questions run through this suite:
 *
 *   * **What arrives is turned into values, or into refusals with their own sentence.**
 *     Every field is checked rather than only the first that fails, so a person
 *     correcting a form sees everything wrong with it at once.
 *   * **Nothing arrives that should not.** The availability form has no date, the copy
 *     form has no source, and none of the four can be made to speak another's language.
 */

const VALUES: WeeklySpecialValues = {
  iso_year: 2026,
  iso_week: 35,
  days: ['wed', 'thu', 'fri'],
  name: 'Stegt flæsk',
  description: 'Med persillesovs.',
  price_small_ore: 8900,
  price_large_ore: 11900,
  image_id: null,
  sat_enabled: true,
  sat_name: 'Helstegt pattegris',
  sat_description: 'Til deling.',
  sat_price_ore: 19900,
  sat_deadline: 'Bestilling senest fredag kl. 12:00',
}

function weekForm(overrides: Partial<WeekFormValues> = {}): WeekFormValues {
  return {
    week: '2026-W35',
    days: ['wed', 'thu', 'fri'],
    name: 'Stegt flæsk',
    description: 'Med persillesovs.',
    priceSmall: '89',
    priceLarge: '119',
    ...overrides,
  }
}

function saturdayForm(overrides: Partial<SaturdayFormValues> = {}): SaturdayFormValues {
  return {
    enabled: true,
    name: 'Helstegt pattegris',
    description: 'Til deling.',
    price: '199',
    deadline: 'Bestilling senest fredag kl. 12:00',
    ...overrides,
  }
}

function formDataOf(entries: Record<string, string | string[]>): FormData {
  const data = new FormData()

  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }

  return data
}

describe('the round trip between a row and its two forms', () => {
  it('shows a stored row and reads it back unchanged', () => {
    const week = toWeekSubmission(weekFormValues(VALUES))
    expect(week.ok).toBe(true)
    if (week.ok) {
      expect(week.values).toEqual({
        week: { year: 2026, week: 35 },
        days: ['wed', 'thu', 'fri'],
        name: VALUES.name,
        description: VALUES.description,
        price_small_ore: VALUES.price_small_ore,
        price_large_ore: VALUES.price_large_ore,
      })
    }

    const saturday = toSaturdaySubmission(saturdayFormValues(VALUES))
    expect(saturday.ok).toBe(true)
    if (saturday.ok) {
      expect(saturday.values).toEqual({
        sat_enabled: VALUES.sat_enabled,
        sat_name: VALUES.sat_name,
        sat_description: VALUES.sat_description,
        sat_price_ore: VALUES.sat_price_ore,
        sat_deadline: VALUES.sat_deadline,
      })
    }
  })

  it('shows an empty row as empty fields rather than as the word null', () => {
    const empty: WeeklySpecialValues = {
      ...VALUES,
      iso_year: null,
      iso_week: null,
      days: [],
      name: null,
      description: null,
      price_small_ore: null,
      price_large_ore: null,
      sat_enabled: false,
      sat_name: null,
      sat_description: null,
      sat_price_ore: null,
      sat_deadline: null,
    }

    expect(weekFormValues(empty)).toEqual({
      week: '',
      days: [],
      name: '',
      description: '',
      priceSmall: '',
      priceLarge: '',
    })

    expect(saturdayFormValues(empty)).toEqual({
      enabled: false,
      name: '',
      description: '',
      price: '',
      deadline: '',
    })
  })
})

describe('toWeekSubmission', () => {
  it('turns blank text into null, the way every schema here does', () => {
    const result = toWeekSubmission(weekForm({ name: '   ', description: '', priceSmall: '' }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values.name).toBeNull()
      expect(result.values.description).toBeNull()
      expect(result.values.price_small_ore).toBeNull()
    }
  })

  it('reads Danish prices into øre', () => {
    const result = toWeekSubmission(weekForm({ priceSmall: '89,50', priceLarge: '1.500' }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values.price_small_ore).toBe(8950)
      expect(result.values.price_large_ore).toBe(150000)
    }
  })

  it('orders the serving days by the schedule and drops anything unknown', () => {
    const result = toWeekSubmission(weekForm({ days: ['fri', 'nonsense', 'wed'] }))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values.days).toEqual(['wed', 'fri'])
  })

  it('refuses a week that is missing, malformed, or does not exist', () => {
    for (const [week, code] of [
      ['', 'uge:required'],
      ['   ', 'uge:required'],
      ['2026-36', 'uge:invalid'],
      // 2027 has 52 weeks.
      ['2027-W53', 'uge:invalid'],
      ['uge 36', 'uge:invalid'],
    ] as const) {
      const result = toWeekSubmission(weekForm({ week }))

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors).toContain(code)
    }
  })

  it('reports everything wrong at once', () => {
    const result = toWeekSubmission(
      weekForm({ week: '', name: 'x'.repeat(201), priceSmall: 'ni', priceLarge: '89,555' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect([...result.errors].sort()).toEqual(
        ['navn:too_long', 'pris_lille:not_a_number', 'pris_stor:too_many_decimals', 'uge:required'].sort(),
      )
    }
  })
})

describe('toSaturdaySubmission', () => {
  it('requires a name when the menu is switched on', () => {
    const result = toSaturdaySubmission(saturdayForm({ enabled: true, name: '  ' }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('loerdag_navn:required')
  })

  it('does not require a name when it is switched off', () => {
    const result = toSaturdaySubmission(
      saturdayForm({ enabled: false, name: '', description: '', price: '', deadline: '' }),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values).toEqual({
        sat_enabled: false,
        sat_name: null,
        sat_description: null,
        sat_price_ore: null,
        sat_deadline: null,
      })
    }
  })

  it('keeps the text when the menu is switched off — 1ag’s own promise', () => {
    const result = toSaturdaySubmission(saturdayForm({ enabled: false }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values.sat_enabled).toBe(false)
      expect(result.values.sat_name).toBe('Helstegt pattegris')
      expect(result.values.sat_price_ore).toBe(19900)
      expect(result.values.sat_deadline).toBe('Bestilling senest fredag kl. 12:00')
    }
  })

  it('refuses a deadline longer than the column allows', () => {
    const result = toSaturdaySubmission(saturdayForm({ deadline: 'x'.repeat(121) }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('loerdag_frist:too_long')
  })
})

describe('the refusal round trip', () => {
  it('carries the codes and the typed values through a query string', () => {
    const form = weekForm({ name: 'Frikadeller', priceSmall: 'ni' })
    const encoded = encodeWeekEcho(form, ['pris_lille:not_a_number'])

    expect(decodeWeeklyErrors(encoded.getAll('fejl'))).toEqual(['pris_lille:not_a_number'])
    expect(readWeekForm(encoded)).toEqual(form)
  })

  it('does the same for the Saturday card, including its off state', () => {
    const form = saturdayForm({ enabled: false, price: 'ni' })
    const encoded = encodeSaturdayEcho(form, ['loerdag_pris:not_a_number'])

    expect(readSaturdayForm(encoded)).toEqual(form)
  })

  it('drops a code this application never defined', () => {
    expect(decodeWeeklyErrors(['navn:too_long', 'navn:hacked', '', 'noget'])).toEqual([
      'navn:too_long',
    ])
  })

  it('binds every code to a field the form actually renders', () => {
    expect(weeklyErrorField('loerdag_pris:out_of_range')).toBe('loerdag_pris')
    expect(weeklyErrorField('uge:required')).toBe('uge')
  })
})

describe('readWeeklyAvailabilityForm', () => {
  it('reads the two literals and the version token', () => {
    const request = readWeeklyAvailabilityForm(
      formDataOf({
        [WEEKLY_AVAILABILITY_FORM.target]: 'saturday',
        [WEEKLY_AVAILABILITY_FORM.soldOut]: '1',
        [WEEKLY_AVAILABILITY_FORM.version]: '2026-08-30T10:00:00.000+02:00',
      }),
    )

    expect(request).toEqual({
      target: 'saturday',
      soldOut: true,
      expectedUpdatedAt: '2026-08-30T10:00:00.000+02:00',
    })
  })

  it('refuses a target outside the closed set', () => {
    expect(
      readWeeklyAvailabilityForm(
        formDataOf({
          [WEEKLY_AVAILABILITY_FORM.target]: 'sold_out_on',
          [WEEKLY_AVAILABILITY_FORM.soldOut]: '1',
          [WEEKLY_AVAILABILITY_FORM.version]: '2026-08-30T10:00:00.000+02:00',
        }),
      ),
    ).toBeNull()
  })

  it('refuses a malformed version, a malformed state, and a missing field', () => {
    const base = {
      [WEEKLY_AVAILABILITY_FORM.target]: 'week',
      [WEEKLY_AVAILABILITY_FORM.soldOut]: '1',
      [WEEKLY_AVAILABILITY_FORM.version]: '2026-08-30T10:00:00.000+02:00',
    }

    expect(
      readWeeklyAvailabilityForm(
        formDataOf({ ...base, [WEEKLY_AVAILABILITY_FORM.version]: 'i går' }),
      ),
    ).toBeNull()
    expect(
      readWeeklyAvailabilityForm(formDataOf({ ...base, [WEEKLY_AVAILABILITY_FORM.soldOut]: 'ja' })),
    ).toBeNull()
    expect(readWeeklyAvailabilityForm(formDataOf({}))).toBeNull()
  })

  it('ignores a forged date, because the shape has no field for one (§7b)', () => {
    const request = readWeeklyAvailabilityForm(
      formDataOf({
        [WEEKLY_AVAILABILITY_FORM.target]: 'week',
        [WEEKLY_AVAILABILITY_FORM.soldOut]: '1',
        [WEEKLY_AVAILABILITY_FORM.version]: '2026-08-30T10:00:00.000+02:00',
        sold_out_on: '2020-01-01',
        udsolgt_dato: '2020-01-01',
      }),
    )

    expect(request).not.toBeNull()
    expect(Object.keys(request ?? {})).toEqual(['target', 'soldOut', 'expectedUpdatedAt'])
  })
})

describe('readCopyForm', () => {
  it('reads a version and defaults the confirmation to off', () => {
    expect(
      readCopyForm(formDataOf({ [COPY_FORM.version]: '2026-08-30T10:00:00.000+02:00' })),
    ).toEqual({
      expectedUpdatedAt: '2026-08-30T10:00:00.000+02:00',
      confirmOverwrite: false,
    })
  })

  it('takes the confirmation only from the exact literal', () => {
    const withConfirm = (value: string) =>
      readCopyForm(
        formDataOf({
          [COPY_FORM.version]: '2026-08-30T10:00:00.000+02:00',
          [COPY_FORM.confirm]: value,
        }),
      )?.confirmOverwrite

    expect(withConfirm('1')).toBe(true)
    expect(withConfirm('true')).toBe(false)
    expect(withConfirm('ja')).toBe(false)
  })

  it('has no field for a source document, so one cannot be submitted', () => {
    const request = readCopyForm(
      formDataOf({
        [COPY_FORM.version]: '2026-08-30T10:00:00.000+02:00',
        navn: 'Noget jeg selv fandt på',
        iso_week: '52',
        sold_out_on: '2020-01-01',
      }),
    )

    expect(Object.keys(request ?? {})).toEqual(['expectedUpdatedAt', 'confirmOverwrite'])
  })

  it('refuses a missing or malformed version', () => {
    expect(readCopyForm(formDataOf({}))).toBeNull()
    expect(readCopyForm(formDataOf({ [COPY_FORM.version]: 'i går' }))).toBeNull()
  })
})

describe('the four vocabularies are disjoint', () => {
  it('shares no field name between an editor and an operation', () => {
    const editors = new Set<string>([
      ...Object.values(WEEK_FORM),
      ...Object.values(SATURDAY_FORM),
    ])
    const operations: string[] = [
      ...Object.values(WEEKLY_AVAILABILITY_FORM),
      ...Object.values(COPY_FORM),
    ]

    // `version` is the one name every form carries, by design: it is the concurrency
    // token, and it means the same thing everywhere.
    for (const name of operations) {
      if (name === 'version') continue
      expect(editors.has(name)).toBe(false)
    }
  })

  it('gives the two operations no name in common beyond the version', () => {
    const copyNames: string[] = Object.values(COPY_FORM)
    const shared = (Object.values(WEEKLY_AVAILABILITY_FORM) as string[]).filter((name) =>
      copyNames.includes(name),
    )

    expect(shared).toEqual(['version'])
  })
})
