import { describe, expect, it } from 'vitest'

import { readReorderForm, REORDER_FORM } from '@/app/(admin)/admin/menu/reorder-form'

/**
 * What a reorder submission may say — technical plan §8; phase 5E.
 *
 * The parser is the boundary between a browser and everything that follows it, so this
 * suite is written as an attacker would write it: not "does a good form parse", but
 * "which bad forms are refused, and is the refusal total". A `null` here is what stops a
 * hand-built POST from choosing a `sort_order`, naming a row to write, or reaching the
 * deletion vocabulary from the reorder one.
 */

const GOOD = {
  dishId: '22222222-2222-4222-8222-222222222221',
  baseline: '0123456789abcdef',
}

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(values)) data.append(name, value)
  return data
}

function submission(overrides: Record<string, string> = {}): FormData {
  return form({
    [REORDER_FORM.dishId]: GOOD.dishId,
    [REORDER_FORM.toIndex]: '2',
    [REORDER_FORM.baseline]: GOOD.baseline,
    [REORDER_FORM.section]: 'burgere',
    ...overrides,
  })
}

describe('a well-formed submission parses into exactly four values', () => {
  it('reads the dish, the destination, the fingerprint and the section', () => {
    expect(readReorderForm(submission())).toEqual({
      dishId: GOOD.dishId,
      toIndex: 2,
      baseline: GOOD.baseline,
      section: 'burgere',
    })
  })

  it('accepts position zero — the top of the list is a real destination', () => {
    expect(readReorderForm(submission({ [REORDER_FORM.toIndex]: '0' }))?.toIndex).toBe(0)
  })

  it('treats a missing section as no section rather than as an empty one', () => {
    const data = form({
      [REORDER_FORM.dishId]: GOOD.dishId,
      [REORDER_FORM.toIndex]: '1',
      [REORDER_FORM.baseline]: GOOD.baseline,
    })

    expect(readReorderForm(data)?.section).toBeNull()
  })

  it('ignores a field it does not know rather than carrying it forward', () => {
    // `FormData` can hold anything; the parser reads four names and builds its result
    // from those, so an extra key cannot reach a rule, a query or a draft.
    const data = submission()
    data.append('sort_order', '999')
    data.append('slettet', '1')

    expect(readReorderForm(data)).toEqual({
      dishId: GOOD.dishId,
      toIndex: 2,
      baseline: GOOD.baseline,
      section: 'burgere',
    })
  })
})

describe('anything malformed is refused outright', () => {
  it('refuses a missing dish', () => {
    expect(readReorderForm(submission({ [REORDER_FORM.dishId]: '' }))).toBeNull()
  })

  it('refuses a dish id that is not a uuid', () => {
    expect(readReorderForm(submission({ [REORDER_FORM.dishId]: 'odin' }))).toBeNull()
  })

  it.each(['', '-1', '1.5', ' 2', '01', '1e3', 'to', '0x2', '99999', 'Infinity', 'NaN'])(
    'refuses the destination %o',
    (value) => {
      expect(readReorderForm(submission({ [REORDER_FORM.toIndex]: value }))).toBeNull()
    },
  )

  it.each(['', 'not-a-fingerprint', '0123456789ABCDEF', '0123456789abcde', '0123456789abcdef0'])(
    'refuses the fingerprint %o',
    (value) => {
      expect(readReorderForm(submission({ [REORDER_FORM.baseline]: value }))).toBeNull()
    },
  )

  it('refuses an entirely empty submission', () => {
    expect(readReorderForm(new FormData())).toBeNull()
  })

  it('refuses a file where a value was expected', () => {
    const data = submission()
    data.set(REORDER_FORM.dishId, new File(['x'], 'x.txt'))

    expect(readReorderForm(data)).toBeNull()
  })

  it('takes the first value when a field is repeated, and refuses if that one is bad', () => {
    const data = form({
      [REORDER_FORM.dishId]: GOOD.dishId,
      [REORDER_FORM.baseline]: GOOD.baseline,
    })
    data.append(REORDER_FORM.toIndex, 'nope')
    data.append(REORDER_FORM.toIndex, '1')

    expect(readReorderForm(data)).toBeNull()
  })
})

describe('the reorder vocabulary cannot be confused with the other two', () => {
  it('has no field in common with the deletion or availability forms', () => {
    // `sektion` is shared deliberately — it is navigation, not a decision — so the test
    // names the fields that decide something and asserts those are the reorder's own.
    const deciding = [REORDER_FORM.dishId, REORDER_FORM.toIndex, REORDER_FORM.baseline]

    expect(deciding).toEqual(['ret', 'til', 'grundlag'])
    expect(deciding).not.toContain('slettet')
    expect(deciding).not.toContain('udsolgt')
    expect(deciding).not.toContain('version')
  })

  it('has no way to express a sort_order, a list of dishes, or a version token', () => {
    expect(Object.values(REORDER_FORM)).toEqual(['ret', 'til', 'grundlag', 'sektion'])
  })
})
