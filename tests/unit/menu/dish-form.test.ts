import { describe, expect, it } from 'vitest'

import {
  decodeDishErrors,
  DISH_ERROR_FIELD,
  DISH_FORM,
  dishFormValues,
  emptyDishForm,
  encodeDishFormEcho,
  errorField,
  readDishForm,
  toDishDraftValues,
  type DishFormValues,
} from '@/app/(admin)/admin/menu/dish-form'
import type { AdminDish } from '@/lib/menu/admin'
import { dishDraft } from '@/lib/schemas/menu'

/**
 * The dish editor's field mapping — design 1r, technical plan §4, §6.
 *
 * The two things this layer must never get wrong: it must produce values the entity's
 * own schema accepts, and it must not change a field the person did not touch.
 */

const BURGERS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WEEKLY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const allowsBurgers = (categoryId: string): boolean => categoryId === BURGERS

function form(overrides: Partial<DishFormValues> = {}): DishFormValues {
  return {
    name: 'Odin',
    price: '89',
    categoryId: BURGERS,
    description: '200 g dry aged bøf, sennepsmayo, bacon, cheddar.',
    secondaryNote: 'Som menu med pommes frites og sodavand 124 kr.',
    standardLabels: [],
    customLabels: [],
    ...overrides,
  }
}

describe('reading the submitted form', () => {
  it('reads every field, including the repeated label controls', () => {
    const data = new FormData()
    data.set(DISH_FORM.name, 'Odin')
    data.set(DISH_FORM.price, '89,50')
    data.set(DISH_FORM.category, BURGERS)
    data.set(DISH_FORM.description, 'Beskrivelse')
    data.set(DISH_FORM.secondaryNote, 'Ekstra linje')
    data.append(DISH_FORM.standardLabel, 'Populær')
    data.append(DISH_FORM.customLabel, 'Pulled pork')
    data.append(DISH_FORM.customLabel, '')

    expect(readDishForm(data)).toEqual({
      name: 'Odin',
      price: '89,50',
      categoryId: BURGERS,
      description: 'Beskrivelse',
      secondaryNote: 'Ekstra linje',
      standardLabels: ['Populær'],
      customLabels: ['Pulled pork', ''],
    })
  })

  it('reads a missing field as empty rather than as undefined', () => {
    expect(readDishForm(new FormData())).toEqual(emptyDishForm(''))
  })
})

describe('mapping the form to draft values', () => {
  it('produces database-cased values the entity’s own schema accepts', () => {
    const mapped = toDishDraftValues(form(), {
      existingLabels: [],
      categoryAllows: allowsBurgers,
    })

    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return

    expect(mapped.values).toEqual({
      category_id: BURGERS,
      name: 'Odin',
      description: '200 g dry aged bøf, sennepsmayo, bacon, cheddar.',
      secondary_note: 'Som menu med pommes frites og sodavand 124 kr.',
      price_ore: 8900,
      labels: [],
    })

    // The strict parse is the one the Server Action performs. If this passes, no
    // unknown key can have crept in, and every value is one the column accepts.
    expect(dishDraft.input.safeParse(mapped.values).success).toBe(true)
  })

  it('turns a blank optional field into null, never into an empty string', () => {
    const mapped = toDishDraftValues(form({ description: '  ', secondaryNote: '' }), {
      existingLabels: [],
      categoryAllows: allowsBurgers,
    })

    expect(mapped.ok && mapped.values.description).toBeNull()
    expect(mapped.ok && mapped.values.secondary_note).toBeNull()
  })

  it('carries the ekstra linje as its own field, not merged into the description', () => {
    const mapped = toDishDraftValues(
      form({ description: 'Beskrivelse', secondaryNote: '1 kg · frost' }),
      { existingLabels: [], categoryAllows: allowsBurgers },
    )

    expect(mapped.ok && mapped.values.description).toBe('Beskrivelse')
    expect(mapped.ok && mapped.values.secondary_note).toBe('1 kg · frost')
  })

  it('reads kroner as øre', () => {
    const mapped = toDishDraftValues(form({ price: '89,50' }), {
      existingLabels: [],
      categoryAllows: allowsBurgers,
    })

    expect(mapped.ok && mapped.values.price_ore).toBe(8950)
  })

  it('accepts an empty price as "no fixed price"', () => {
    const mapped = toDishDraftValues(form({ price: '' }), {
      existingLabels: [],
      categoryAllows: allowsBurgers,
    })

    expect(mapped.ok && mapped.values.price_ore).toBeNull()
  })
})

describe('refusals', () => {
  it('refuses a dish with no name', () => {
    const mapped = toDishDraftValues(form({ name: '   ' }), {
      existingLabels: [],
      categoryAllows: allowsBurgers,
    })

    expect(mapped.ok).toBe(false)
    if (!mapped.ok) expect(mapped.errors).toContain('navn:required')
  })

  it('refuses a malformed price and says why', () => {
    const mapped = toDishDraftValues(form({ price: '89 kr.' }), {
      existingLabels: [],
      categoryAllows: allowsBurgers,
    })

    expect(mapped.ok).toBe(false)
    if (!mapped.ok) expect(mapped.errors).toContain('pris:not_a_number')
  })

  it('refuses a section the menu rules do not allow, whatever the dropdown said', () => {
    const mapped = toDishDraftValues(form({ categoryId: WEEKLY }), {
      existingLabels: [],
      categoryAllows: allowsBurgers,
    })

    expect(mapped.ok).toBe(false)
    if (!mapped.ok) expect(mapped.errors).toContain('sektion:not_allowed')
  })

  it('refuses a section that does not exist at all', () => {
    const mapped = toDishDraftValues(form({ categoryId: 'maanedens-burger' }), {
      existingLabels: [],
      categoryAllows: allowsBurgers,
    })

    expect(mapped.ok).toBe(false)
    if (!mapped.ok) expect(mapped.errors).toContain('sektion:not_allowed')
  })

  it('collects every refusal at once', () => {
    const mapped = toDishDraftValues(
      form({ name: '', price: 'x', categoryId: WEEKLY, customLabels: ['x'.repeat(31)] }),
      { existingLabels: [], categoryAllows: allowsBurgers },
    )

    expect(mapped.ok).toBe(false)
    if (!mapped.ok) {
      expect([...mapped.errors].sort()).toEqual([
        'maerkater:too_long',
        'navn:required',
        'pris:not_a_number',
        'sektion:not_allowed',
      ])
    }
  })

  it('binds each refusal to the field that earned it', () => {
    expect(errorField('pris:not_a_number')).toBe('pris')
    expect(errorField('maerkater:duplicate')).toBe('maerkater')
    expect(errorField('navn:required')).toBe('navn')
  })
})

describe('labels are preserved through an unrelated edit', () => {
  it('keeps "Pulled pork" when only the price changed', () => {
    const glaadeGris: AdminDish = {
      id: 'dish-glade-gris',
      categoryId: BURGERS,
      name: 'Glade Gris',
      description: 'Pulled pork, puffede svær, rødkål, chilimayo, icebergsalat.',
      secondaryNote: 'Som menu med pommes frites og sodavand 124 kr.',
      priceOre: 8900,
      labels: ['Pulled pork'],
      sortOrder: 5,
      liveSortOrder: 5,
      soldOutOn: null,
      isNewDraft: false,
      hasDraft: false,
      draftFields: [],
      updatedAt: '2026-08-29T12:00:00.000000+00:00',
      live: {
        category_id: BURGERS,
        name: 'Glade Gris',
        description: 'Pulled pork, puffede svær, rødkål, chilimayo, icebergsalat.',
        secondary_note: 'Som menu med pommes frites og sodavand 124 kr.',
        price_ore: 8900,
        labels: ['Pulled pork'],
      },
    }

    // Exactly what the editor renders, with one character changed in the price field.
    const rendered = dishFormValues(glaadeGris)
    const submitted = { ...rendered, price: '95' }

    const mapped = toDishDraftValues(submitted, {
      existingLabels: glaadeGris.labels,
      categoryAllows: allowsBurgers,
    })

    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return

    expect(mapped.values.price_ore).toBe(9500)
    expect(mapped.values.labels).toEqual(['Pulled pork'])
  })

  it('renders a stored dish back into the two label controls', () => {
    const values = dishFormValues({
      id: 'dish',
      categoryId: BURGERS,
      name: 'Odin',
      description: null,
      secondaryNote: null,
      priceOre: 8900,
      labels: ['Populær', 'Pulled pork'],
      sortOrder: 1,
      liveSortOrder: 1,
      soldOutOn: null,
      isNewDraft: false,
      hasDraft: false,
      draftFields: [],
      updatedAt: '2026-08-29T12:00:00.000000+00:00',
      live: {
        category_id: BURGERS,
        name: 'Odin',
        description: null,
        secondary_note: null,
        price_ore: 8900,
        labels: ['Populær', 'Pulled pork'],
      },
    })

    expect(values.standardLabels).toEqual(['Populær'])
    expect(values.customLabels).toEqual(['Pulled pork'])
    expect(values.price).toBe('89')
  })
})

describe('round-tripping a refused save', () => {
  it('carries the codes and the typed values back, and reads them with the same parser', () => {
    const submitted = form({ price: '89 kr.', customLabels: ['Pulled pork', ''] })
    const echoed = encodeDishFormEcho(submitted, ['pris:not_a_number'])

    expect(decodeDishErrors(echoed.getAll(DISH_ERROR_FIELD))).toEqual(['pris:not_a_number'])
    expect(readDishForm(echoed)).toEqual(submitted)
  })

  it('ignores a code the application never defined', () => {
    expect(decodeDishErrors(['pris:not_a_number', 'noget:andet', ''])).toEqual([
      'pris:not_a_number',
    ])
  })
})
