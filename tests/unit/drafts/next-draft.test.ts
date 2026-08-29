import { describe, expect, it } from 'vitest'

import { nextDraftValues } from '@/lib/drafts/overlay'
import { dishDraft } from '@/lib/schemas/menu'

/**
 * What a draft column holds after one save — technical plan §4, §6; phase 5E.
 *
 * `nextDraftValues` is the last step of `saveEntityDraft`, and it is where the rule §4
 * states in one sentence — a draft holds *only the changed fields* — either stays true
 * or quietly stops being true. Phase 5E is the first caller that can take a field back
 * out of a draft, so the promise that matters most here is the negative one: **a reorder
 * must not disturb a colleague's pending price or description.**
 *
 * The real `dishDraft` spec is used rather than a fixture, because the allow-list is
 * half of the behaviour: `clear` may only reach names the entity's schema knows.
 */

const spec = dishDraft

describe('a reorder merges into the existing draft rather than replacing it', () => {
  it('adds a position to a draft that already holds somebody else’s price edit', () => {
    const existing = { price_ore: 9700, description: 'Ny beskrivelse afventer' }

    expect(nextDraftValues(existing, { sort_order: 2 }, spec)).toEqual({
      price_ore: 9700,
      description: 'Ny beskrivelse afventer',
      sort_order: 2,
    })
  })

  it('changes a position already in the draft without touching the rest of it', () => {
    const existing = { price_ore: 9700, sort_order: 4 }

    expect(nextDraftValues(existing, { sort_order: 2 }, spec)).toEqual({
      price_ore: 9700,
      sort_order: 2,
    })
  })

  it('creates a draft on a dish that had none', () => {
    expect(nextDraftValues({}, { sort_order: 3 }, spec)).toEqual({ sort_order: 3 })
  })

  it('never mutates the draft it was given', () => {
    const existing = { price_ore: 9700 }
    const before = { ...existing }

    nextDraftValues(existing, { sort_order: 2 }, spec)

    expect(existing).toEqual(before)
  })
})

describe('clearing takes one field out and leaves the others alone', () => {
  it('removes the position while a pending price survives', () => {
    const existing = { price_ore: 9700, sort_order: 4 }

    expect(nextDraftValues(existing, {}, spec, ['sort_order'])).toEqual({ price_ore: 9700 })
  })

  it('removes the whole draft when the position was the only thing pending', () => {
    expect(nextDraftValues({ sort_order: 4 }, {}, spec, ['sort_order'])).toBeNull()
  })

  it('is harmless when the field was not in the draft to begin with', () => {
    expect(nextDraftValues({ price_ore: 9700 }, {}, spec, ['sort_order'])).toEqual({
      price_ore: 9700,
    })
  })

  it('ignores a name the entity’s schema does not know', () => {
    // The same allow-list a write goes through: `clear` can take a field out of a draft
    // and can never reach past `spec.fields`.
    const existing = { price_ore: 9700, sold_out_on: '2026-08-29' } as Record<string, unknown>

    expect(nextDraftValues(existing, {}, spec, ['sold_out_on', 'updated_by'])).toEqual({
      price_ore: 9700,
      sold_out_on: '2026-08-29',
    })
  })

  it('clears a field that is written and cleared in the same save', () => {
    expect(nextDraftValues({ price_ore: 9700 }, { sort_order: 2 }, spec, ['sort_order'])).toEqual({
      price_ore: 9700,
    })
  })
})

describe('an empty draft becomes null, never {}', () => {
  it('reduces a draft with nothing left in it', () => {
    // `pending_changes`, the Kladde badge and the dashboard count all read
    // `draft is not null`, so `{}` would leave a dish pending with nothing to publish.
    expect(nextDraftValues({}, {}, spec)).toBeNull()
  })

  it('keeps a draft that still has one field', () => {
    expect(nextDraftValues({}, { sort_order: 1 }, spec)).toEqual({ sort_order: 1 })
  })
})
