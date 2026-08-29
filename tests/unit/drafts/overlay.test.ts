import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { mergeDraftValues, overlayDraft } from '@/lib/drafts/overlay'
import { defineDraft } from '@/lib/schemas/define'
import { optionalText, priceOre, requiredText } from '@/lib/schemas/primitives'

/**
 * The draft overlay — technical plan §6.
 *
 * These are the four rules the whole publishing model rests on, tested against the real
 * merge rather than a stand-in. Every entity's preview, every editor form and every
 * draft write goes through this one function, so a mistake here would be a mistake
 * everywhere at once.
 *
 * The fixture is a small entity of its own rather than a real one, so the tests state
 * the rule rather than a fact about the menu that could change for unrelated reasons.
 * The real entities are covered by `tests/unit/schemas/drafts.test.ts`.
 */

const spec = defineDraft({
  name: requiredText(60, 'Navnet').optional(),
  description: optionalText(200, 'Beskrivelsen').optional(),
  price_ore: priceOre('Prisen').optional(),
  labels: z.array(requiredText(20, 'En mærkat')).max(4).optional(),
})

const live = {
  id: 'a3f0d0f9-6c0e-4d1e-9a3c-2f3f52d3e001',
  name: 'Thor',
  description: 'Oksekød, bacon, cheddar.',
  price_ore: 12900,
  labels: ['Populær'],
  sold_out_on: '2026-08-29',
  updated_by: 'ce1b4c7e-1f6a-4a3e-8b95-6d4c5b7a9001',
}

describe('a partial draft changes only what it mentions', () => {
  it('leaves untouched fields exactly as they were', () => {
    const { row } = overlayDraft(live, { price_ore: 13900 }, spec)

    expect(row.price_ore).toBe(13900)
    expect(row.name).toBe('Thor')
    expect(row.description).toBe('Oksekød, bacon, cheddar.')
    expect(row.labels).toEqual(['Populær'])
  })

  it('reports which fields the draft changed, in schema order', () => {
    const { changedFields } = overlayDraft(live, { price_ore: 13900, name: 'Thor 2.0' }, spec)

    expect(changedFields).toEqual(['name', 'price_ore'])
  })

  it('does not mutate the live row it was given', () => {
    const snapshot = { ...live }
    overlayDraft(live, { name: 'Ny' }, spec)

    expect(live).toEqual(snapshot)
  })

  it('treats an empty draft object as no change at all', () => {
    const { row, changedFields } = overlayDraft(live, {}, spec)

    expect(row).toEqual(live)
    expect(changedFields).toEqual([])
  })
})

describe('null in a draft is an edit, not an absence', () => {
  it('clears a nullable field that the draft explicitly sets to null', () => {
    const { row, changedFields } = overlayDraft(live, { description: null }, spec)

    expect(row.description).toBeNull()
    expect(changedFields).toEqual(['description'])
    // and nothing else moved
    expect(row.name).toBe('Thor')
    expect(row.price_ore).toBe(12900)
  })

  it('clears a price the same way', () => {
    const { row } = overlayDraft(live, { price_ore: null }, spec)

    expect(row.price_ore).toBeNull()
  })

  it('distinguishes "set to null" from "not mentioned"', () => {
    const cleared = overlayDraft(live, { description: null }, spec)
    const untouched = overlayDraft(live, { name: 'Thor' }, spec)

    expect(cleared.row.description).toBeNull()
    expect(untouched.row.description).toBe('Oksekød, bacon, cheddar.')
  })
})

describe('unknown draft properties never reach the merged row', () => {
  it('drops a key the schema does not know', () => {
    const { row, changedFields, malformed } = overlayDraft(
      live,
      { price_ore: 13900, saerlig_rabat: true },
      spec,
    )

    expect(malformed).toBe(false)
    expect(changedFields).toEqual(['price_ore'])
    expect(row).not.toHaveProperty('saerlig_rabat')
  })

  it('refuses to carry a server-controlled field even when the value is plausible', () => {
    const { row } = overlayDraft(
      live,
      { updated_by: '00000000-0000-4000-8000-000000000000', sold_out_on: '2026-01-01' },
      spec,
    )

    expect(row.updated_by).toBe(live.updated_by)
    expect(row.sold_out_on).toBe('2026-08-29')
  })
})

describe('a draft that does not parse is not applied at all', () => {
  it('reports malformed and returns the untouched live row', () => {
    const { row, changedFields, malformed } = overlayDraft(
      live,
      { name: 'Gyldigt navn', price_ore: 'ikke et tal' },
      spec,
    )

    expect(malformed).toBe(true)
    expect(changedFields).toEqual([])
    expect(row).toEqual(live)
  })

  it('does not apply the valid half of a half-valid draft', () => {
    const { row } = overlayDraft(live, { name: '', description: 'Ny tekst' }, spec)

    expect(row.name).toBe('Thor')
    expect(row.description).toBe('Oksekød, bacon, cheddar.')
  })

  it('treats a draft that is not an object as malformed', () => {
    for (const value of ['ikke et objekt', 42, true, ['a']]) {
      const result = overlayDraft(live, value, spec)

      expect(result.malformed).toBe(true)
      expect(result.row).toEqual(live)
    }
  })

  it('treats no draft as no change, and not as malformed', () => {
    for (const value of [null, undefined]) {
      const result = overlayDraft(live, value, spec)

      expect(result.malformed).toBe(false)
      expect(result.row).toEqual(live)
    }
  })
})

describe('the same merge builds up a draft as it does a preview', () => {
  it('adds a second edit to an existing draft without losing the first', () => {
    const existing = { name: 'Thor 2.0' }
    const { row } = mergeDraftValues(existing, { price_ore: 13900 }, spec)

    expect(row).toEqual({ name: 'Thor 2.0', price_ore: 13900 })
  })

  it('lets a later edit replace an earlier one', () => {
    const { row } = mergeDraftValues({ name: 'Første' }, { name: 'Anden' }, spec)

    expect(row).toEqual({ name: 'Anden' })
  })

  it('carries an explicit null into the draft rather than dropping the key', () => {
    const { row } = mergeDraftValues({ description: 'Noget' }, { description: null }, spec)

    expect(Object.hasOwn(row, 'description')).toBe(true)
    expect(row.description).toBeNull()
  })

  it('never carries a key outside the allow-list', () => {
    const { row } = mergeDraftValues({}, { name: 'Thor', role: 'owner' }, spec)

    expect(row).toEqual({ name: 'Thor' })
  })
})
