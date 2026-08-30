import { describe, expect, it } from 'vitest'

import {
  copyDestinationWeek,
  describeSaturdayState,
  describeWeeklyPending,
  hasCopyableWeeklyContent,
  isoWeekOptions,
  orderedDays,
  NO_SATURDAY_MENU,
  pendingParts,
  planWeekEdit,
  SATURDAY_EDITOR_FIELDS,
  WEEK_EDITOR_FIELDS,
  weeklyDraftDelta,
  weeklyDraftWrite,
  WEEKLY_COPY_FIELDS,
  weekOf,
  type WeeklySpecialValues,
} from '@/lib/menu/weekly'
import { formatIsoWeekToken, type IsoWeek } from '@/lib/time/iso-week'

/**
 * Ugens ret and Lørdagsmenu — the administration's rules; phase 6A, §4, §6, §7e item 5.
 *
 * The two properties this suite exists for are the two that would be invisible until a
 * restaurant lost work:
 *
 *   1. **Neither editor speaks for the other's fields.** They share one row and one
 *      `draft` column, so a save that named everything would silently discard a
 *      colleague's pending change. Both directions are asserted.
 *   2. **A copy cannot carry operational or attribution state forward**, and cannot
 *      produce anything published.
 */

const LIVE: WeeklySpecialValues = {
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

const WEEK_35: IsoWeek = { year: 2026, week: 35 }
const WEEK_36: IsoWeek = { year: 2026, week: 36 }

/** The submission shape 1ag's first card produces, defaulted to "nothing changed". */
function weekSubmission(overrides: Partial<Parameters<typeof planWeekEdit>[0]['submitted']> = {}) {
  return {
    week: WEEK_35,
    days: LIVE.days,
    name: LIVE.name,
    description: LIVE.description,
    price_small_ore: LIVE.price_small_ore,
    price_large_ore: LIVE.price_large_ore,
    ...overrides,
  }
}

describe('the two editors own disjoint fields', () => {
  it('shares no field between the cards', () => {
    const overlap = WEEK_EDITOR_FIELDS.filter((field) => SATURDAY_EDITOR_FIELDS.includes(field))

    expect(overlap).toEqual([])
  })

  it('leaves `image_id` to neither, so phase 10 cannot be wiped by a price save', () => {
    expect(WEEK_EDITOR_FIELDS).not.toContain('image_id')
    expect(SATURDAY_EDITOR_FIELDS).not.toContain('image_id')
  })

  it('leaves both sold-out columns out of every list — they are not draftable (§6)', () => {
    for (const field of [...WEEK_EDITOR_FIELDS, ...SATURDAY_EDITOR_FIELDS, ...WEEKLY_COPY_FIELDS]) {
      expect(field).not.toBe('sold_out_on')
      expect(field).not.toBe('sat_sold_out_on')
    }
  })
})

describe('weeklyDraftDelta', () => {
  it('holds only the changed fields (§4)', () => {
    const delta = weeklyDraftDelta(
      { name: 'Frikadeller', description: LIVE.description },
      LIVE,
      WEEK_EDITOR_FIELDS,
    )

    expect(delta).toEqual({ name: 'Frikadeller' })
  })

  it('treats `null` as a real change — clearing a value is an edit', () => {
    expect(weeklyDraftDelta({ description: null }, LIVE, WEEK_EDITOR_FIELDS)).toEqual({
      description: null,
    })
  })

  it('compares the serving days by content and order', () => {
    expect(weeklyDraftDelta({ days: ['wed', 'thu', 'fri'] }, LIVE, WEEK_EDITOR_FIELDS)).toEqual({})
    expect(weeklyDraftDelta({ days: ['thu', 'wed', 'fri'] }, LIVE, WEEK_EDITOR_FIELDS)).toEqual({
      days: ['thu', 'wed', 'fri'],
    })
    expect(weeklyDraftDelta({ days: ['wed', 'thu'] }, LIVE, WEEK_EDITOR_FIELDS)).toEqual({
      days: ['wed', 'thu'],
    })
  })

  it('ignores a field outside the list it was given', () => {
    expect(
      weeklyDraftDelta({ sat_name: 'Noget andet' }, LIVE, WEEK_EDITOR_FIELDS),
    ).toEqual({})
  })
})

describe('weeklyDraftWrite', () => {
  it('clears the fields of its own list that no longer differ', () => {
    const write = weeklyDraftWrite(
      { sat_enabled: true, sat_name: 'Ny ret', sat_description: LIVE.sat_description },
      LIVE,
      SATURDAY_EDITOR_FIELDS,
    )

    expect(write.values).toEqual({ sat_name: 'Ny ret' })
    // Everything else in the card leaves the draft, so nothing pending is announced that
    // the next publish would not make.
    expect([...write.clear].sort()).toEqual(
      ['sat_deadline', 'sat_description', 'sat_enabled', 'sat_price_ore'].sort(),
    )
  })

  it('never names a field outside its own list, in either direction', () => {
    const write = weeklyDraftWrite({ name: 'Ny ret' }, LIVE, WEEK_EDITOR_FIELDS)

    for (const field of [...Object.keys(write.values), ...write.clear]) {
      expect(SATURDAY_EDITOR_FIELDS).not.toContain(field)
    }
  })
})

describe('draft integrity between the two cards', () => {
  it('a Saturday save cannot touch a pending Ugens ret price', () => {
    const write = weeklyDraftWrite(
      { sat_enabled: false, sat_name: LIVE.sat_name, sat_description: LIVE.sat_description, sat_price_ore: LIVE.sat_price_ore, sat_deadline: LIVE.sat_deadline },
      LIVE,
      SATURDAY_EDITOR_FIELDS,
    )

    expect(write.values).toEqual({ sat_enabled: false })
    expect(write.clear).not.toContain('price_small_ore')
    expect(write.clear).not.toContain('price_large_ore')
    expect(write.clear).not.toContain('name')
  })

  it('an Ugens ret save cannot touch a pending Saturday menu', () => {
    const plan = planWeekEdit({
      submitted: weekSubmission({ price_small_ore: 9500 }),
      current: LIVE,
      live: LIVE,
    })

    expect(plan.values).toEqual({ price_small_ore: 9500 })
    for (const field of SATURDAY_EDITOR_FIELDS) {
      expect(plan.clear).not.toContain(field)
      expect(Object.hasOwn(plan.values, field)).toBe(false)
    }
  })
})

describe('planWeekEdit — the week rollover (§7e item 5)', () => {
  it('saves ordinary content without blanking anything', () => {
    const plan = planWeekEdit({
      submitted: weekSubmission({ name: 'Frikadeller' }),
      current: LIVE,
      live: LIVE,
    })

    expect(plan.blanked).toBe(false)
    expect(plan.restored).toBe(false)
    expect(plan.values).toEqual({ name: 'Frikadeller' })
  })

  it('blanks the dish when the week number moves, whatever was typed', () => {
    const plan = planWeekEdit({
      // Somebody typed a dish *and* changed the week. The frame is explicit: a new week
      // starts on a blank form.
      submitted: weekSubmission({ week: WEEK_36, name: 'Noget helt andet' }),
      current: LIVE,
      live: LIVE,
    })

    expect(plan.blanked).toBe(true)
    expect(plan.values).toEqual({
      iso_week: 36,
      name: null,
      description: null,
      price_small_ore: null,
      price_large_ore: null,
    })
    // The year did not move, so it is not a pending change.
    expect(Object.hasOwn(plan.values, 'iso_year')).toBe(false)
  })

  it('keeps the serving days and the whole Saturday card across a rollover', () => {
    const plan = planWeekEdit({
      submitted: weekSubmission({ week: WEEK_36, days: [] }),
      current: LIVE,
      live: LIVE,
    })

    // The submitted days are ignored along with the rest of the typed content, and the
    // *current* pattern is carried forward — so it is unchanged from live and therefore
    // not a pending change at all.
    expect(Object.hasOwn(plan.values, 'days')).toBe(false)
    expect(plan.clear).toContain('days')

    for (const field of SATURDAY_EDITOR_FIELDS) {
      expect(Object.hasOwn(plan.values, field)).toBe(false)
      expect(plan.clear).not.toContain(field)
    }
  })

  it('carries a pending day pattern into the new week rather than the published one', () => {
    const current: WeeklySpecialValues = { ...LIVE, days: ['wed', 'thu'] }

    const plan = planWeekEdit({
      submitted: weekSubmission({ week: WEEK_36 }),
      current,
      live: LIVE,
    })

    expect(plan.values.days).toEqual(['wed', 'thu'])
  })

  it('crosses a year boundary like any other week change', () => {
    const live: WeeklySpecialValues = { ...LIVE, iso_year: 2026, iso_week: 53 }

    const plan = planWeekEdit({
      submitted: weekSubmission({ week: { year: 2027, week: 1 } }),
      current: live,
      live,
    })

    expect(plan.blanked).toBe(true)
    expect(plan.values.iso_year).toBe(2027)
    expect(plan.values.iso_week).toBe(1)
  })

  it('returns to the published week and the published dish, clearing the card', () => {
    // A blank week 36 is pending; choosing week 35 again undoes the whole rollover
    // rather than proposing a blank version of what is already live.
    const current: WeeklySpecialValues = {
      ...LIVE,
      iso_week: 36,
      name: null,
      description: null,
      price_small_ore: null,
      price_large_ore: null,
    }

    const plan = planWeekEdit({
      submitted: weekSubmission({ week: WEEK_35 }),
      current,
      live: LIVE,
    })

    expect(plan.restored).toBe(true)
    expect(plan.blanked).toBe(false)
    expect(plan.values).toEqual({})
    expect([...plan.clear].sort()).toEqual([...WEEK_EDITOR_FIELDS].sort())
    // …and it still says nothing at all about the Saturday card.
    for (const field of SATURDAY_EDITOR_FIELDS) {
      expect(plan.clear).not.toContain(field)
    }
  })

  it('does not treat setting a week for the first time as a rollover', () => {
    const empty: WeeklySpecialValues = {
      ...LIVE,
      iso_year: null,
      iso_week: null,
    }

    const plan = planWeekEdit({
      submitted: weekSubmission({ week: WEEK_36, name: 'Frikadeller' }),
      current: empty,
      live: empty,
    })

    expect(plan.blanked).toBe(false)
    expect(plan.values.name).toBe('Frikadeller')
    expect(plan.values.iso_week).toBe(36)
  })
})

describe('the Saturday menu state', () => {
  it('quotes the public card word for word when it is off', () => {
    expect(describeSaturdayState(false)).toContain(NO_SATURDAY_MENU)
    expect(describeSaturdayState(false)).toContain('Teksten bevares')
    expect(describeSaturdayState(true)).not.toContain(NO_SATURDAY_MENU)
  })

  it('turning it off is a change to one field and nothing else', () => {
    const write = weeklyDraftWrite(
      {
        sat_enabled: false,
        sat_name: LIVE.sat_name,
        sat_description: LIVE.sat_description,
        sat_price_ore: LIVE.sat_price_ore,
        sat_deadline: LIVE.sat_deadline,
      },
      LIVE,
      SATURDAY_EDITOR_FIELDS,
    )

    // Nothing is blanked: the text is kept, exactly as 1ag promises.
    expect(write.values).toEqual({ sat_enabled: false })
  })
})

describe('hasCopyableWeeklyContent', () => {
  it('is true when the weekly dish has a name', () => {
    expect(hasCopyableWeeklyContent(LIVE)).toBe(true)
  })

  it('is true when only the Saturday menu is filled in and switched on', () => {
    expect(
      hasCopyableWeeklyContent({ ...LIVE, name: null, sat_enabled: true, sat_name: 'Gris' }),
    ).toBe(true)
  })

  it('is false for a row a guest reads nothing off', () => {
    expect(
      hasCopyableWeeklyContent({ ...LIVE, name: null, sat_enabled: false, sat_name: null }),
    ).toBe(false)

    // A named Saturday menu that is switched off shows nothing, so there is nothing to
    // copy forward from it either.
    expect(
      hasCopyableWeeklyContent({ ...LIVE, name: null, sat_enabled: false, sat_name: 'Gris' }),
    ).toBe(false)

    // A week number and a day pattern are not content.
    expect(
      hasCopyableWeeklyContent({
        ...LIVE,
        name: null,
        sat_enabled: false,
        sat_name: null,
        description: null,
      }),
    ).toBe(false)
  })
})

describe('copyDestinationWeek', () => {
  it('advances the live row’s own week', () => {
    expect(copyDestinationWeek(LIVE, { year: 2026, week: 40 })).toEqual(WEEK_36)
  })

  it('advances across a year boundary', () => {
    expect(
      copyDestinationWeek({ iso_year: 2026, iso_week: 53 }, { year: 2026, week: 53 }),
    ).toEqual({ year: 2027, week: 1 })

    expect(
      copyDestinationWeek({ iso_year: 2025, iso_week: 52 }, { year: 2025, week: 52 }),
    ).toEqual({ year: 2026, week: 1 })
  })

  it('advances into week 53 where the year has one', () => {
    expect(
      copyDestinationWeek({ iso_year: 2026, iso_week: 52 }, { year: 2026, week: 52 }),
    ).toEqual({ year: 2026, week: 53 })
  })

  it('falls back to this week when the live row has never had one', () => {
    expect(
      copyDestinationWeek({ iso_year: null, iso_week: null }, { year: 2026, week: 35 }),
    ).toEqual({ year: 2026, week: 35 })
  })

  it('does not depend on today — a row that is behind still advances by one', () => {
    // The kitchen forgot to publish for three weeks. The copy lands in the week after
    // the one that is live, not in whatever week it happens to be.
    expect(copyDestinationWeek(LIVE, { year: 2026, week: 38 })).toEqual(WEEK_36)
  })
})

describe('WEEKLY_COPY_FIELDS', () => {
  it('is the draft schema’s own field list', () => {
    // The copy is built in SQL from `weekly_special_content()`, which names the content
    // columns and nothing else. This is the same statement on this side of the wire.
    expect([...WEEKLY_COPY_FIELDS].sort()).toEqual(
      [
        'days',
        'description',
        'image_id',
        'iso_week',
        'iso_year',
        'name',
        'price_large_ore',
        'price_small_ore',
        'sat_deadline',
        'sat_description',
        'sat_enabled',
        'sat_name',
        'sat_price_ore',
      ].sort(),
    )
  })

  it('carries no operational, attribution or identity field', () => {
    for (const forbidden of [
      'sold_out_on',
      'sat_sold_out_on',
      'updated_at',
      'updated_by',
      'created_at',
      'id',
      'draft',
      'is_singleton',
    ]) {
      expect(WEEKLY_COPY_FIELDS).not.toContain(forbidden)
    }
  })
})

describe('pending state', () => {
  it('names the card a stored draft is about', () => {
    expect(pendingParts(['name'])).toEqual({ week: true, saturday: false })
    expect(pendingParts(['sat_enabled'])).toEqual({ week: false, saturday: true })
    expect(pendingParts(['iso_week', 'sat_name'])).toEqual({ week: true, saturday: true })
    expect(pendingParts([])).toEqual({ week: false, saturday: false })
  })

  it('counts an image draft as the weekly dish, since no editor owns it yet', () => {
    expect(pendingParts(['image_id'])).toEqual({ week: true, saturday: false })
  })

  it('says nothing when nothing is pending, which is what hides the band', () => {
    expect(describeWeeklyPending({ week: false, saturday: false })).toEqual([])
    expect(describeWeeklyPending({ week: true, saturday: true })).toHaveLength(2)
    expect(describeWeeklyPending({ week: true, saturday: false })[0]).toContain('Ugens ret')
    expect(describeWeeklyPending({ week: false, saturday: true })[0]).toContain('Lørdagsmenuen')
  })
})

describe('presentation helpers', () => {
  it('orders the serving days by the schedule, not by how they were stored', () => {
    expect(orderedDays(['fri', 'wed', 'thu'])).toEqual(['wed', 'thu', 'fri'])
    expect(orderedDays([])).toEqual([])
    expect(orderedDays(['nonsense'])).toEqual([])
  })

  it('reads the week off a row, or answers null', () => {
    expect(weekOf(LIVE)).toEqual(WEEK_35)
    expect(weekOf({ iso_year: 2026, iso_week: null })).toBeNull()
    expect(weekOf({ iso_year: null, iso_week: 35 })).toBeNull()
  })
})

describe('isoWeekOptions', () => {
  it('offers a window around this week, in order', () => {
    const options = isoWeekOptions(WEEK_35, WEEK_35)

    expect(options).toHaveLength(11)
    expect(options[0]).toEqual({ year: 2026, week: 33 })
    expect(options[options.length - 1]).toEqual({ year: 2026, week: 43 })
  })

  it('always contains the selected week, however far away it is', () => {
    const far: IsoWeek = { year: 2026, week: 3 }
    const options = isoWeekOptions(WEEK_35, far)

    expect(options.map(formatIsoWeekToken)).toContain(formatIsoWeekToken(far))
    // …and stays in chronological order once it is added.
    expect(options[0]).toEqual(far)
  })

  it('does not duplicate a selected week that is already in the window', () => {
    const tokens = isoWeekOptions(WEEK_35, WEEK_36).map(formatIsoWeekToken)

    expect(new Set(tokens).size).toBe(tokens.length)
  })

  it('crosses a year boundary correctly', () => {
    const tokens = isoWeekOptions({ year: 2026, week: 52 }, null).map(formatIsoWeekToken)

    // 2026 has 53 weeks, so the list runs 50, 51, 52, 53, then 2027's 1…
    expect(tokens).toContain('2026-W53')
    expect(tokens).toContain('2027-W01')
    expect(tokens).not.toContain('2026-W54')
  })
})
