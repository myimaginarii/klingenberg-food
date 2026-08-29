import { describe, expect, it } from 'vitest'

import {
  buildDishLabels,
  isStandardDishLabel,
  MAX_CUSTOM_LABEL_LENGTH,
  MAX_DISH_LABELS,
  splitDishLabels,
  STANDARD_DISH_LABELS,
} from '@/lib/menu/labels'
import { dishDraft } from '@/lib/schemas/menu'

/**
 * Dish labels — design 1r / 1aa / 1h, and the confirmed phase-5B decision.
 *
 * The rule that matters most is the last one in this file: **an edit that does not
 * touch the labels must not change them.** The phase brief states it with the example
 * it came from, so that is the example the test uses.
 */

const [POPULAR, NEW, HOT, VEGETARIAN] = STANDARD_DISH_LABELS

describe('the four standard labels', () => {
  it('are the ones frame 1r draws, in the order it draws them', () => {
    expect(STANDARD_DISH_LABELS).toEqual(['Populær', 'Ny', 'Stærk', 'Vegetar'])
  })

  it('are recognised whatever their casing', () => {
    expect(isStandardDishLabel('Populær')).toBe(true)
    expect(isStandardDishLabel('populær')).toBe(true)
    expect(isStandardDishLabel('Pulled pork')).toBe(false)
  })

  it('are selectable, and produce exactly what was selected', () => {
    expect(buildDishLabels({ standard: [POPULAR, HOT], custom: [] })).toEqual({
      ok: true,
      labels: ['Populær', 'Stærk'],
    })
  })

  it('refuses a checkbox value that is not one of the four', () => {
    const result = buildDishLabels({ standard: ['Bedst'], custom: [] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('unknown_standard')
  })
})

describe('custom labels', () => {
  it('accepts the short descriptive labels the approved frames already print', () => {
    expect(
      buildDishLabels({ standard: [], custom: ['Pulled pork', 'Kylling', 'Størst'] }),
    ).toEqual({ ok: true, labels: ['Pulled pork', 'Kylling', 'Størst'] })
  })

  it('trims whitespace', () => {
    expect(buildDishLabels({ standard: [], custom: ['  Pulled pork  '] })).toEqual({
      ok: true,
      labels: ['Pulled pork'],
    })
  })

  it('drops an empty slot rather than storing a blank label', () => {
    expect(buildDishLabels({ standard: [], custom: ['Kylling', '', '   '] })).toEqual({
      ok: true,
      labels: ['Kylling'],
    })
  })

  it(`accepts exactly ${String(MAX_CUSTOM_LABEL_LENGTH)} characters and refuses one more`, () => {
    const exact = 'x'.repeat(MAX_CUSTOM_LABEL_LENGTH)
    const tooLong = 'x'.repeat(MAX_CUSTOM_LABEL_LENGTH + 1)

    expect(buildDishLabels({ standard: [], custom: [exact] })).toEqual({
      ok: true,
      labels: [exact],
    })

    const refused = buildDishLabels({ standard: [], custom: [tooLong] })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.errors).toContain('too_long')
  })

  it('refuses a custom label that restates a standard one', () => {
    const result = buildDishLabels({ standard: [], custom: ['populær'] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('reserved')
  })
})

describe('duplicates', () => {
  it('refuses the same custom label twice', () => {
    const result = buildDishLabels({ standard: [], custom: ['Kylling', 'Kylling'] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('duplicate')
  })

  it('compares case-insensitively', () => {
    const result = buildDishLabels({ standard: [], custom: ['Kylling', 'kylling'] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('duplicate')
  })

  it('compares across the two controls, not only within one', () => {
    // "Ny" as a toggle and "ny" typed by hand is the same label twice. The custom one
    // is refused as reserved before it can even become a duplicate, which is the more
    // useful sentence of the two.
    const result = buildDishLabels({ standard: [NEW], custom: ['ny'] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('reserved')
  })
})

describe('the total', () => {
  it(`allows ${String(MAX_DISH_LABELS)} labels of any mixture`, () => {
    expect(
      buildDishLabels({ standard: [POPULAR, NEW], custom: ['Pulled pork', 'Størst'] }),
    ).toEqual({ ok: true, labels: ['Populær', 'Ny', 'Pulled pork', 'Størst'] })
  })

  it('refuses a fifth, because the column itself caps at four', () => {
    const result = buildDishLabels({
      standard: [POPULAR, NEW, HOT, VEGETARIAN],
      custom: ['Pulled pork'],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('too_many')
  })

  it('reports every problem at once rather than one per attempt', () => {
    const result = buildDishLabels({
      standard: ['Bedst'],
      custom: ['x'.repeat(MAX_CUSTOM_LABEL_LENGTH + 1), 'Kylling', 'kylling'],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect([...result.errors].sort()).toEqual(['duplicate', 'too_long', 'unknown_standard'])
    }
  })
})

describe('splitting stored labels back into the two controls', () => {
  it('separates the standard from the descriptive', () => {
    expect(splitDishLabels(['Pulled pork', 'Populær'])).toEqual({
      standard: ['Populær'],
      custom: ['Pulled pork'],
    })
  })

  it('keeps the design order for the toggles and the stored order for the rest', () => {
    expect(splitDishLabels(['Vegetar', 'Størst', 'Populær', 'Kylling'])).toEqual({
      standard: ['Populær', 'Vegetar'],
      custom: ['Størst', 'Kylling'],
    })
  })

  it('round-trips through buildDishLabels unchanged', () => {
    const stored = ['Pulled pork', 'Populær']
    const split = splitDishLabels(stored)

    expect(
      buildDishLabels({ standard: split.standard, custom: split.custom, existing: stored }),
    ).toEqual({ ok: true, labels: stored })
  })
})

describe('existing labels survive an unrelated edit', () => {
  /**
   * The phase brief's own example. Glade Gris carries "Pulled pork" in the seed; a
   * price change re-submits the form the editor rendered, which carries the label back.
   */
  it('keeps "Pulled pork" on Glade Gris when only the price changed', () => {
    const existing = ['Pulled pork']
    const rendered = splitDishLabels(existing)

    const result = buildDishLabels({
      standard: rendered.standard,
      custom: rendered.custom,
      existing,
    })

    expect(result).toEqual({ ok: true, labels: ['Pulled pork'] })
  })

  it('produces a byte-identical array, so a no-op edit is not a change', () => {
    const existing = ['Populær', 'Pulled pork', 'Størst']
    const rendered = splitDishLabels(existing)

    const result = buildDishLabels({
      standard: rendered.standard,
      custom: rendered.custom,
      existing,
    })

    expect(result.ok && result.labels).toEqual(existing)
  })

  it('adds a new label after the ones the dish already had', () => {
    const result = buildDishLabels({
      standard: [POPULAR],
      custom: ['Pulled pork', 'Størst'],
      existing: ['Pulled pork', 'Populær'],
    })

    expect(result).toEqual({ ok: true, labels: ['Pulled pork', 'Populær', 'Størst'] })
  })

  it('lets a label be removed on purpose', () => {
    const result = buildDishLabels({
      standard: [],
      custom: [''],
      existing: ['Pulled pork'],
    })

    expect(result).toEqual({ ok: true, labels: [] })
  })

  it('takes the submitted spelling, so a correction is not reverted', () => {
    const result = buildDishLabels({
      standard: [],
      custom: ['Pulled Pork'],
      existing: ['Pulled pork'],
    })

    expect(result).toEqual({ ok: true, labels: ['Pulled Pork'] })
  })
})

describe('the draft schema agrees with the editor', () => {
  const parse = (labels: string[]) => dishDraft.input.safeParse({ labels })

  it('accepts the four standard labels and short custom ones', () => {
    expect(parse(['Populær', 'Pulled pork']).success).toBe(true)
  })

  it(`refuses a label longer than ${String(MAX_CUSTOM_LABEL_LENGTH)} characters`, () => {
    expect(parse(['x'.repeat(MAX_CUSTOM_LABEL_LENGTH + 1)]).success).toBe(false)
  })

  it('refuses a case-insensitive duplicate, which the database CHECK would allow', () => {
    expect(parse(['Kylling', 'kylling']).success).toBe(false)
  })

  it(`refuses more than ${String(MAX_DISH_LABELS)} labels`, () => {
    expect(parse(['Populær', 'Ny', 'Stærk', 'Vegetar', 'Kylling']).success).toBe(false)
  })

  it('still refuses an unknown key, so labels cannot smuggle another column in', () => {
    expect(dishDraft.input.safeParse({ labels: ['Ny'], sold_out_on: '2026-08-29' }).success).toBe(
      false,
    )
  })
})
