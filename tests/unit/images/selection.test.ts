import { describe, expect, it } from 'vitest'

import {
  imageDraftWrite,
  readImageSelectionForm,
  CHANGE_IMAGE_LABEL,
  CHOOSE_IMAGE_LABEL,
  IMAGE_SELECT_FORM,
  IMAGE_SLOT_LABEL,
  REMOVE_IMAGE_HINT,
  REMOVE_IMAGE_LABEL,
} from '@/lib/images/selection'

/**
 * Choosing an image in a content editor — the shared pure half (phase 10C-1,
 * brief §3, §6, §8, §10).
 *
 * Four editors submit this one vocabulary, so the whole browser-authority surface
 * of image selection is tested here once: what a picker may say (a version token
 * and an id, or an empty value meaning "no image"), and what a selection means
 * for a draft (the §4 delta rule, reduced to the one field the picker owns).
 */

const VERSION = '2026-09-01T10:00:00.000000+00:00'
const IMAGE_A = '11111111-1111-4111-8111-111111111111'
const IMAGE_B = '22222222-2222-4222-8222-222222222222'

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(entries)) data.append(name, value)
  return data
}

describe('readImageSelectionForm — what a picker may submit (§6 of the brief)', () => {
  it('a chosen image is a version token and a uuid', () => {
    expect(
      readImageSelectionForm(form({ version: VERSION, billede: IMAGE_A })),
    ).toEqual({ expectedUpdatedAt: VERSION, imageId: IMAGE_A })
  })

  it('an empty value is "Fjern billede" — a null selection, never a deletion', () => {
    expect(readImageSelectionForm(form({ version: VERSION, billede: '' }))).toEqual({
      expectedUpdatedAt: VERSION,
      imageId: null,
    })
  })

  it('an absent image field reads as the empty value — the remove button submits none', () => {
    expect(readImageSelectionForm(form({ version: VERSION }))).toEqual({
      expectedUpdatedAt: VERSION,
      imageId: null,
    })
  })

  it.each([
    ['a storage path where the id should be', { version: VERSION, billede: 'a/original.jpg' }],
    ['an almost-uuid', { version: VERSION, billede: `${IMAGE_A}x` }],
    ['a missing version', { billede: IMAGE_A }],
    ['a version that is not a timestamp', { version: 'i går', billede: IMAGE_A }],
  ])('refuses %s outright', (_what, entries) => {
    expect(readImageSelectionForm(form(entries))).toBeNull()
  })

  it('has no field for a path, a derivative, a MIME type or a dimension (§21)', () => {
    // The vocabulary is the whole browser surface: two names, and nothing else to
    // put storage metadata into.
    expect(Object.values(IMAGE_SELECT_FORM).sort()).toEqual(['billede', 'version'])
  })
})

describe('imageDraftWrite — the §4 delta rule for one field', () => {
  it('choosing a new image over none writes the pending selection', () => {
    expect(imageDraftWrite(IMAGE_A, null)).toEqual({
      values: { image_id: IMAGE_A },
      clear: [],
    })
  })

  it('changing selection over a different live image writes the new pending one', () => {
    expect(imageDraftWrite(IMAGE_B, IMAGE_A)).toEqual({
      values: { image_id: IMAGE_B },
      clear: [],
    })
  })

  it('removing over a live image writes an explicit pending null (brief §8)', () => {
    expect(imageDraftWrite(null, IMAGE_A)).toEqual({
      values: { image_id: null },
      clear: [],
    })
  })

  it('choosing the image that is already live takes the field out of the draft', () => {
    expect(imageDraftWrite(IMAGE_A, IMAGE_A)).toEqual({
      values: {},
      clear: ['image_id'],
    })
  })

  it('removing when nothing is live is not a pending change either', () => {
    expect(imageDraftWrite(null, null)).toEqual({ values: {}, clear: ['image_id'] })
  })
})

describe('the slot vocabulary — the frames’ words, and the §10 distinction', () => {
  it('speaks the approved labels', () => {
    expect(IMAGE_SLOT_LABEL).toBe('Billede (valgfrit)')
    expect(CHOOSE_IMAGE_LABEL).toBe('Vælg billede')
    expect(CHANGE_IMAGE_LABEL).toBe('Skift billede')
    expect(REMOVE_IMAGE_LABEL).toBe('Fjern billede')
  })

  it('the removal hint states that the library keeps the asset (§10)', () => {
    expect(REMOVE_IMAGE_HINT).toContain('bliver i billedbiblioteket')
  })
})
