import { describe, expect, it } from 'vitest'

import {
  encodeOpeningHoursEcho,
  OPENING_HOURS_ERROR_FIELD,
  readOpeningHoursForm,
  weekdayFieldNames,
} from '@/app/(admin)/admin/aabningstider/forms'
import type { WeeklySchedule } from '@/lib/hours/types'
import {
  changedWeekdays,
  decodeWeeklyHoursErrors,
  describeWeeklyHoursPending,
  isClockTime,
  quarterHourChoices,
  SCHEDULE_ERROR_CODE,
  schedulesEqual,
  timeChoicesFor,
  toWeeklySchedule,
  weeklyFormValues,
  weeklyHoursDraftWrite,
  weeklyHoursErrorDay,
  weeklyHoursErrorField,
  WEEKLY_HOURS_ERROR_MESSAGES,
  type WeeklyFormValues,
} from '@/lib/hours/weekly-form'
import { openingHoursDraft, weeklyScheduleSchema } from '@/lib/schemas/opening-hours'
import { WEEKDAY_KEYS } from '@/lib/time/calendar'

import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * The weekly opening-hours editor's domain — phase 8A; §4, §5, §6, §7.
 *
 * The parsing and delta layer, asserted on its own: seven rows become a schedule document,
 * or become day-specific Danish messages, and never become a guess.
 *
 * **This is deliberately not a second copy of the phase-2 time matrix.** Whether the
 * restaurant is open at a given instant, what the next opening is, how Copenhagen's two
 * daylight-saving transitions behave and every row of §7b are asserted in
 * `tests/unit/hours/engine.test.ts` and `tests/unit/menu/sold-out.test.ts`, against the same
 * `CONFIRMED_SCHEDULE` fixture this file imports. Nothing here re-tests any of it. What is
 * asserted here is only what phase 8A added: the mapping between a form and a document, the
 * refusals, and what a save should write.
 */

const ALL_OPEN_ROW = { open: true, from: '15:00', to: '20:00' } as const
const CLOSED_ROW = { open: false, from: '', to: '' } as const

/** The seeded week as the editor's seven rows. */
function confirmedForm(): WeeklyFormValues {
  return weeklyFormValues(CONFIRMED_SCHEDULE)
}

function withDay(
  form: WeeklyFormValues,
  weekday: keyof WeeklyFormValues,
  row: Partial<WeeklyFormValues[keyof WeeklyFormValues]>,
): WeeklyFormValues {
  return { ...form, [weekday]: { ...form[weekday], ...row } }
}

// ---------------------------------------------------------------------------
// The seven days, and the current schedule
// ---------------------------------------------------------------------------

describe('weeklyFormValues', () => {
  it('renders exactly the seven weekdays, Monday first', () => {
    expect(Object.keys(confirmedForm())).toEqual([...WEEKDAY_KEYS])
  })

  it('reads an open weekday as its two stored times', () => {
    expect(confirmedForm().wed).toEqual({ open: true, from: '15:00', to: '20:00' })
    expect(confirmedForm().sat).toEqual({ open: true, from: '17:00', to: '20:00' })
  })

  it('reads a closed weekday as closed with no times, because the document stores none', () => {
    // §4: a closed day is the exact document `{"closed": true}` — the CHECK is an equality
    // test — so there is nowhere for a remembered time to live, and none is invented.
    expect(confirmedForm().mon).toEqual({ open: false, from: '', to: '' })
    expect(confirmedForm().tue).toEqual({ open: false, from: '', to: '' })
  })
})

describe('the current seeded schedule', () => {
  it('round-trips through the form and back without changing a value', () => {
    const parsed = toWeeklySchedule(confirmedForm())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.schedule).toEqual(CONFIRMED_SCHEDULE)
    expect(schedulesEqual(parsed.schedule, CONFIRMED_SCHEDULE)).toBe(true)
  })

  it('produces no draft at all, because nothing was changed', () => {
    const parsed = toWeeklySchedule(confirmedForm())
    if (!parsed.ok) throw new Error('the seeded week must parse')

    expect(weeklyHoursDraftWrite(parsed.schedule, CONFIRMED_SCHEDULE)).toEqual({
      values: {},
      clear: ['schedule'],
    })
  })
})

// ---------------------------------------------------------------------------
// Parsing seven rows into a document
// ---------------------------------------------------------------------------

describe('toWeeklySchedule', () => {
  it('writes a closed day as `{closed: true}` and nothing else', () => {
    const parsed = toWeeklySchedule(withDay(confirmedForm(), 'wed', CLOSED_ROW))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.schedule.wed).toEqual({ closed: true })
  })

  it('drops the times of a day that is switched off, even when they were submitted', () => {
    // A closed row's selects are hidden by CSS, not removed, so they still submit. The
    // document must not carry them: `{"closed": true, "from": …}` is refused by the CHECK.
    const parsed = toWeeklySchedule(
      withDay(confirmedForm(), 'wed', { open: false, from: '15:00', to: '20:00' }),
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.schedule.wed).toEqual({ closed: true })
  })

  it('opens a normally closed day when both times are given', () => {
    const parsed = toWeeklySchedule(
      withDay(confirmedForm(), 'mon', { open: true, from: '12:00', to: '14:30' }),
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.schedule.mon).toEqual({ from: '12:00', to: '14:30' })
  })

  it('refuses an open day with no opening time, naming the day', () => {
    const parsed = toWeeklySchedule(withDay(confirmedForm(), 'wed', { from: '' }))

    expect(parsed).toEqual({ ok: false, errors: ['wed:fra_mangler'] })
    expect(WEEKLY_HOURS_ERROR_MESSAGES['wed:fra_mangler']).toBe(
      'Vælg, hvornår I åbner om onsdagen.',
    )
  })

  it('refuses an open day with no closing time, naming the day', () => {
    const parsed = toWeeklySchedule(withDay(confirmedForm(), 'sat', { to: '' }))

    expect(parsed).toEqual({ ok: false, errors: ['sat:til_mangler'] })
    expect(WEEKLY_HOURS_ERROR_MESSAGES['sat:til_mangler']).toBe(
      'Vælg, hvornår I lukker om lørdagen.',
    )
  })

  it('refuses a day newly switched on with neither time, reporting both', () => {
    const parsed = toWeeklySchedule(withDay(confirmedForm(), 'mon', { open: true }))

    expect(parsed).toEqual({ ok: false, errors: ['mon:fra_mangler', 'mon:til_mangler'] })
  })

  it.each([
    ['1500', 'fra'],
    ['15.00', 'fra'],
    ['24:00', 'fra'],
    ['15:60', 'fra'],
    ['15:00:00', 'fra'],
    ['kl. 15', 'fra'],
  ])('refuses a malformed opening time (%s)', (value) => {
    const parsed = toWeeklySchedule(withDay(confirmedForm(), 'wed', { from: value }))

    expect(parsed).toEqual({ ok: false, errors: ['wed:fra_ugyldig'] })
  })

  it('refuses a malformed closing time on the closing field', () => {
    const parsed = toWeeklySchedule(withDay(confirmedForm(), 'wed', { to: '20-00' }))

    expect(parsed).toEqual({ ok: false, errors: ['wed:til_ugyldig'] })
  })

  it('refuses closing before opening', () => {
    const parsed = toWeeklySchedule(
      withDay(confirmedForm(), 'wed', { from: '20:00', to: '15:00' }),
    )

    expect(parsed).toEqual({ ok: false, errors: ['wed:ikke_efter'] })
  })

  it('refuses closing at the same minute it opens', () => {
    const parsed = toWeeklySchedule(
      withDay(confirmedForm(), 'wed', { from: '15:00', to: '15:00' }),
    )

    expect(parsed).toEqual({ ok: false, errors: ['wed:ikke_efter'] })
  })

  it('refuses an overnight opening, which is the same rule the engine relies on', () => {
    // `openDay()` in lib/hours/schedule.ts states it outright: "Opening hours never cross
    // midnight." An editor that accepted 22:00–02:00 would write a document the phase-2
    // engine throws on, so it is refused here with a sentence instead.
    const parsed = toWeeklySchedule(
      withDay(confirmedForm(), 'fri', { from: '22:00', to: '02:00' }),
    )

    expect(parsed).toEqual({ ok: false, errors: ['fri:ikke_efter'] })
    expect(WEEKLY_HOURS_ERROR_MESSAGES['fri:ikke_efter']).toContain('kan ikke gå over midnat')
  })

  it('reports every bad day at once rather than only the first', () => {
    let form = withDay(confirmedForm(), 'wed', { from: '' })
    form = withDay(form, 'thu', { to: 'nonsens' })
    form = withDay(form, 'fri', { from: '20:00', to: '19:00' })

    const parsed = toWeeklySchedule(form)

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return

    expect([...parsed.errors].sort()).toEqual([
      'fri:ikke_efter',
      'thu:til_ugyldig',
      'wed:fra_mangler',
    ])
  })

  it('says nothing about a day that is only reported once', () => {
    // A time nobody can parse gets one message, not an ordering complaint as well.
    const parsed = toWeeklySchedule(withDay(confirmedForm(), 'wed', { from: 'x', to: 'y' }))

    expect(parsed).toEqual({ ok: false, errors: ['wed:fra_ugyldig', 'wed:til_ugyldig'] })
  })

  it('builds exactly the seven allowed keys, whatever else the caller holds', () => {
    const contaminated = {
      ...confirmedForm(),
      holiday: ALL_OPEN_ROW,
      '2026-09-14': ALL_OPEN_ROW,
    } as unknown as WeeklyFormValues

    const parsed = toWeeklySchedule(contaminated)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(Object.keys(parsed.schedule).sort()).toEqual([...WEEKDAY_KEYS].sort())
  })
})

// ---------------------------------------------------------------------------
// The schema is still the authority
// ---------------------------------------------------------------------------

describe('the schema the parser answers to', () => {
  it('accepts every document the parser calls valid', () => {
    const parsed = toWeeklySchedule(confirmedForm())
    if (!parsed.ok) throw new Error('the seeded week must parse')

    expect(weeklyScheduleSchema.safeParse(parsed.schedule).success).toBe(true)
  })

  it('refuses an unknown weekday key', () => {
    const withExtra = { ...CONFIRMED_SCHEDULE, holiday: { closed: true } }

    expect(weeklyScheduleSchema.safeParse(withExtra).success).toBe(false)
  })

  it('refuses a missing weekday key', () => {
    const withoutSunday: Record<string, unknown> = { ...CONFIRMED_SCHEDULE }
    delete withoutSunday.sun

    expect(weeklyScheduleSchema.safeParse(withoutSunday).success).toBe(false)
  })

  it('refuses extra keys inside one day', () => {
    const withExtra = { ...CONFIRMED_SCHEDULE, wed: { from: '15:00', to: '20:00', note: 'ekstra' } }

    expect(weeklyScheduleSchema.safeParse(withExtra).success).toBe(false)
  })

  it('refuses a closed day carrying times', () => {
    const withTimes = { ...CONFIRMED_SCHEDULE, mon: { closed: true, from: '15:00', to: '20:00' } }

    expect(weeklyScheduleSchema.safeParse(withTimes).success).toBe(false)
  })

  it('refuses an unknown field on the draft itself, on the way in', () => {
    // The strict input parser is what `saveEntityDraft` runs, so a request carrying
    // `sold_out_on`, `updated_by` or an override cannot reach the column.
    expect(
      openingHoursDraft.input.safeParse({ schedule: CONFIRMED_SCHEDULE, updated_by: 'x' }).success,
    ).toBe(false)
    expect(
      openingHoursDraft.input.safeParse({ schedule: CONFIRMED_SCHEDULE, date: '2026-09-14' })
        .success,
    ).toBe(false)
  })

  it('accepts a draft that is exactly a schedule', () => {
    expect(openingHoursDraft.input.safeParse({ schedule: CONFIRMED_SCHEDULE }).success).toBe(true)
    expect(openingHoursDraft.fields).toEqual(['schedule'])
  })
})

// ---------------------------------------------------------------------------
// Refusal codes
// ---------------------------------------------------------------------------

describe('refusal codes', () => {
  it('has a sentence for every weekday and every problem', () => {
    for (const weekday of WEEKDAY_KEYS) {
      for (const problem of ['fra_mangler', 'til_mangler', 'fra_ugyldig', 'til_ugyldig', 'ikke_efter']) {
        const code = `${weekday}:${problem}` as keyof typeof WEEKLY_HOURS_ERROR_MESSAGES

        expect(WEEKLY_HOURS_ERROR_MESSAGES[code], code).toBeTruthy()
      }
    }
  })

  it('names the weekday a code belongs to', () => {
    expect(weeklyHoursErrorDay('wed:fra_mangler')).toBe('wed')
    expect(weeklyHoursErrorDay('sun:ikke_efter')).toBe('sun')
    expect(weeklyHoursErrorDay(SCHEDULE_ERROR_CODE)).toBeNull()
  })

  it('binds each code to the field a person moves to fix it', () => {
    expect(weeklyHoursErrorField('wed:fra_mangler')).toBe('fra')
    expect(weeklyHoursErrorField('wed:fra_ugyldig')).toBe('fra')
    expect(weeklyHoursErrorField('wed:til_mangler')).toBe('til')
    expect(weeklyHoursErrorField('wed:til_ugyldig')).toBe('til')
    // The ordering complaint belongs on the closing time.
    expect(weeklyHoursErrorField('wed:ikke_efter')).toBe('til')
    expect(weeklyHoursErrorField(SCHEDULE_ERROR_CODE)).toBeNull()
  })

  it('keeps only codes this module defined', () => {
    expect(
      decodeWeeklyHoursErrors([
        'wed:fra_mangler',
        'xyz:fra_mangler',
        'wed:eksploder',
        '<script>',
        SCHEDULE_ERROR_CODE,
      ]),
    ).toEqual(['wed:fra_mangler', SCHEDULE_ERROR_CODE])
  })
})

// ---------------------------------------------------------------------------
// The two dropdowns
// ---------------------------------------------------------------------------

describe('the time choices', () => {
  it('offers the whole day in quarter-hour steps', () => {
    const choices = quarterHourChoices()

    expect(choices).toHaveLength(96)
    expect(choices[0]).toBe('00:00')
    expect(choices[1]).toBe('00:15')
    expect(choices.at(-1)).toBe('23:45')
    expect(choices).toContain('15:00')
    expect(choices).toContain('17:00')
    expect(choices).toContain('20:00')
  })

  it('offers only valid wall-clock times', () => {
    expect(quarterHourChoices().every(isClockTime)).toBe(true)
  })

  it('adds a stored time that is not on the quarter grid, in its place in the day', () => {
    const choices = timeChoicesFor('15:20')

    expect(choices).toHaveLength(97)
    expect(choices).toContain('15:20')
    expect(choices.indexOf('15:20')).toBe(choices.indexOf('15:15') + 1)
  })

  it('adds nothing for a blank or malformed value', () => {
    expect(timeChoicesFor('')).toHaveLength(96)
    expect(timeChoicesFor('kl. 15')).toHaveLength(96)
    expect(timeChoicesFor('15:00')).toHaveLength(96)
  })

  it('accepts an off-grid time through the parser, because the schema does', () => {
    // The grid is a control, not a rule. A server that refused 15:20 would invent a
    // restriction the column, the CHECK, the schema and the engine do not have.
    const parsed = toWeeklySchedule(withDay(confirmedForm(), 'wed', { from: '15:20' }))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.schedule.wed).toEqual({ from: '15:20', to: '20:00' })
  })
})

// ---------------------------------------------------------------------------
// What a save writes
// ---------------------------------------------------------------------------

describe('weeklyHoursDraftWrite', () => {
  const changed: WeeklySchedule = { ...CONFIRMED_SCHEDULE, wed: { from: '16:00', to: '20:00' } }

  it('writes the whole schedule when the week differs from what is published', () => {
    expect(weeklyHoursDraftWrite(changed, CONFIRMED_SCHEDULE)).toEqual({
      values: { schedule: changed },
      clear: [],
    })
  })

  it('clears the draft when an edit is reverted to what is published', () => {
    // §4: a draft holds only the changed fields. A week edited back has no changed field,
    // so the draft has to leave — otherwise the Kladde badge and the dashboard count would
    // both claim a change that is not there.
    expect(weeklyHoursDraftWrite(CONFIRMED_SCHEDULE, CONFIRMED_SCHEDULE)).toEqual({
      values: {},
      clear: ['schedule'],
    })
  })

  it('clears the draft when a day is closed and reopened at the published times', () => {
    let form = withDay(confirmedForm(), 'wed', CLOSED_ROW)
    form = withDay(form, 'wed', ALL_OPEN_ROW)

    const parsed = toWeeklySchedule(form)
    if (!parsed.ok) throw new Error('the week must parse')

    expect(weeklyHoursDraftWrite(parsed.schedule, CONFIRMED_SCHEDULE).clear).toEqual(['schedule'])
  })

  it("names only `schedule`, which is the entity's one editable field", () => {
    const write = weeklyHoursDraftWrite(changed, CONFIRMED_SCHEDULE)

    expect(Object.keys(write.values)).toEqual(['schedule'])
    expect(openingHoursDraft.input.safeParse(write.values).success).toBe(true)
  })
})

describe('changedWeekdays', () => {
  it('is empty for two identical schedules', () => {
    expect(changedWeekdays(CONFIRMED_SCHEDULE, CONFIRMED_SCHEDULE)).toEqual([])
  })

  it('names a day whose times moved', () => {
    const changed: WeeklySchedule = { ...CONFIRMED_SCHEDULE, wed: { from: '16:00', to: '20:00' } }

    expect(changedWeekdays(changed, CONFIRMED_SCHEDULE)).toEqual(['wed'])
  })

  it('names a day that opened and a day that closed, Monday first', () => {
    const changed: WeeklySchedule = {
      ...CONFIRMED_SCHEDULE,
      mon: { from: '12:00', to: '14:00' },
      sun: { closed: true },
    }

    expect(changedWeekdays(changed, CONFIRMED_SCHEDULE)).toEqual(['mon', 'sun'])
  })
})

// ---------------------------------------------------------------------------
// What the pending band says
// ---------------------------------------------------------------------------

describe('describeWeeklyHoursPending', () => {
  it('says nothing when there is no draft', () => {
    expect(describeWeeklyHoursPending(null, CONFIRMED_SCHEDULE)).toBeNull()
  })

  it('names one waiting day', () => {
    const draft: WeeklySchedule = { ...CONFIRMED_SCHEDULE, wed: { from: '16:00', to: '20:00' } }

    expect(describeWeeklyHoursPending(draft, CONFIRMED_SCHEDULE)).toEqual({
      badge: 'Kladde — onsdag',
      sentence: 'Onsdag venter på at blive offentliggjort.',
    })
  })

  it('joins two waiting days with "og"', () => {
    const draft: WeeklySchedule = {
      ...CONFIRMED_SCHEDULE,
      wed: { from: '16:00', to: '20:00' },
      thu: { closed: true },
    }

    expect(describeWeeklyHoursPending(draft, CONFIRMED_SCHEDULE)).toEqual({
      badge: 'Kladde — onsdag og torsdag',
      sentence: 'Onsdag og torsdag venter på at blive offentliggjort.',
    })
  })

  it('joins three or more with commas and a final "og"', () => {
    const draft: WeeklySchedule = {
      ...CONFIRMED_SCHEDULE,
      wed: { closed: true },
      thu: { closed: true },
      fri: { closed: true },
    }

    expect(describeWeeklyHoursPending(draft, CONFIRMED_SCHEDULE)?.sentence).toBe(
      'Onsdag, torsdag og fredag venter på at blive offentliggjort.',
    )
  })

  it('still reports a draft that happens to match what is published', () => {
    expect(describeWeeklyHoursPending(CONFIRMED_SCHEDULE, CONFIRMED_SCHEDULE)).toEqual({
      badge: 'Kladde',
      sentence:
        'En kladde venter på at blive offentliggjort. Den er magen til de tider, der allerede står på hjemmesiden.',
    })
  })
})

// ---------------------------------------------------------------------------
// The screen's own form vocabulary
// ---------------------------------------------------------------------------

describe('the submitted form', () => {
  it('names one weekday under three field names built from its key', () => {
    expect(weekdayFieldNames('wed')).toEqual({ open: 'aaben-wed', from: 'fra-wed', to: 'til-wed' })
  })

  it('reads a checkbox that is absent as a closed day', () => {
    const source = new URLSearchParams()
    source.set('fra-wed', '15:00')
    source.set('til-wed', '20:00')

    expect(readOpeningHoursForm(source).wed).toEqual({ open: false, from: '15:00', to: '20:00' })
  })

  it('reads exactly seven rows however many names were submitted', () => {
    const source = new URLSearchParams()
    source.set('aaben-holiday', '1')
    source.set('fra-2026-09-14', '17:00')
    source.set('schedule', '{}')
    source.set('entity', 'announcement')

    const form = readOpeningHoursForm(source)

    expect(Object.keys(form)).toEqual([...WEEKDAY_KEYS])
    // And nothing the submission smuggled in reached a day.
    expect(Object.values(form).every((row) => !row.open && row.from === '' && row.to === '')).toBe(
      true,
    )
  })

  it('round-trips a refused save through the query string', () => {
    const form = withDay(confirmedForm(), 'wed', { from: '' })
    const echo = encodeOpeningHoursEcho(form, ['wed:fra_mangler'])

    expect(echo.getAll(OPENING_HOURS_ERROR_FIELD)).toEqual(['wed:fra_mangler'])
    expect(readOpeningHoursForm(echo)).toEqual(form)
  })
})
