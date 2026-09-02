import { describe, expect, it } from 'vitest'

import {
  applyTakeawaySectionsEdit,
  describeTakeawayCtaPhone,
  describeTakeawayPending,
  describeTakeawayVisibility,
  nextTakeawaySectionId,
  pendingTakeawayCards,
  sameTakeawaySections,
  takeawayCtaWrite,
  takeawaySectionsWrite,
  takeawayTextWrite,
  takeawayValuesOf,
  takeawayVisibility,
  takeawayVisibilityWrite,
  toTakeawayCta,
  toTakeawayText,
  type TakeawaySectionValues,
} from '@/lib/pages/takeaway'
import { takeawayDraft } from '@/lib/schemas/page-documents'

/**
 * The Mad ud af huset document's rules — phase 11B; technical plan §4, §6, §9 (E2E 8).
 *
 * Pure functions, asserted directly: the normalisation the public page and the editor
 * share, the visibility resolved through the draft, the per-key delta, the four
 * section controls, and the sentences the screen says.
 */

const IMAGE = '55555555-5555-4555-8555-555555555555'

const SEEDED = {
  heading: 'Mad til fester og store selskaber',
  intro: 'Vi laver mad ud af huset til fester og større selskaber.',
  cta_label: 'Ring og hør mere',
  sections: [
    { id: 'afsnit-1', heading: 'Overskrift på tekstafsnit', body: 'Placeholder ét.', sort: 1 },
    { id: 'afsnit-2', heading: 'Overskrift på tekstafsnit', body: 'Placeholder to.', sort: 2 },
  ],
}

const seededSections: TakeawaySectionValues[] = [
  { id: 'afsnit-1', heading: 'Overskrift på tekstafsnit', body: 'Placeholder ét.' },
  { id: 'afsnit-2', heading: 'Overskrift på tekstafsnit', body: 'Placeholder to.' },
]

describe('takeawayValuesOf — one normalisation for the page and the editor', () => {
  it('reads the seeded document (no image key) with every key present', () => {
    expect(takeawayValuesOf(SEEDED)).toEqual({
      heading: SEEDED.heading,
      intro: SEEDED.intro,
      image_id: null,
      sections: seededSections,
      cta_label: 'Ring og hør mere',
    })
  })

  it('orders sections by sort, ties by position, and gives an id to a section without one', () => {
    const values = takeawayValuesOf({
      sections: [
        { heading: 'B', body: null, sort: 2 },
        { id: 'afsnit-9', heading: 'A', body: null, sort: 1 },
        { id: 'afsnit-3', heading: 'C', body: null },
      ],
    })

    expect(values.sections.map((section) => section.heading)).toEqual(['A', 'B', 'C'])
    expect(values.sections[1]?.id).toBe('afsnit-1')
  })

  it('reads the image id lower-cased and drops anything that is not a uuid', () => {
    expect(takeawayValuesOf({ image_id: IMAGE.toUpperCase() }).image_id).toBe(IMAGE)
    expect(takeawayValuesOf({ image_id: '../etc/passwd' }).image_id).toBeNull()
    expect(takeawayValuesOf({ image_id: 42 }).image_id).toBeNull()
  })

  it('renders a missing, malformed or empty document as empty keys rather than throwing', () => {
    for (const document of [null, undefined, 'tekst', [], {}, { sections: 'ikke en liste' }]) {
      const values = takeawayValuesOf(document)
      expect(values.heading).toBeNull()
      expect(values.sections).toEqual([])
      expect(values.image_id).toBeNull()
    }
  })

  it('ignores the draft-only is_visible key: it is not a document key', () => {
    expect(Object.keys(takeawayValuesOf({ ...SEEDED, is_visible: false }))).toEqual([
      'heading',
      'intro',
      'image_id',
      'sections',
      'cta_label',
    ])
  })
})

describe('takeawayVisibility — the switch through the draft', () => {
  it('is the live column when there is no draft, or the draft says nothing about it', () => {
    expect(takeawayVisibility(true, null)).toBe(true)
    expect(takeawayVisibility(false, undefined)).toBe(false)
    expect(takeawayVisibility(true, { heading: 'x' })).toBe(true)
  })

  it('is the pending value when the draft carries one', () => {
    expect(takeawayVisibility(true, { is_visible: false })).toBe(false)
    expect(takeawayVisibility(false, { is_visible: true })).toBe(true)
  })

  it('ignores a malformed draft entirely — rule 4 of the overlay', () => {
    expect(takeawayVisibility(true, { is_visible: 'nej' })).toBe(true)
    expect(takeawayVisibility(true, { is_visible: false, sections: 'x' })).toBe(true)
    expect(takeawayVisibility(true, 'ikke et objekt')).toBe(true)
  })
})

describe('the per-key delta (§4)', () => {
  const live = takeawayValuesOf(SEEDED)

  it('the text card writes a changed key and clears an unchanged one', () => {
    expect(takeawayTextWrite({ heading: 'Ny', intro: live.intro }, live)).toEqual({
      values: { heading: 'Ny' },
      clear: ['intro'],
    })
    expect(takeawayTextWrite({ heading: live.heading, intro: live.intro }, live)).toEqual({
      values: {},
      clear: ['heading', 'intro'],
    })
  })

  it('the button label and the switch follow the same rule', () => {
    expect(takeawayCtaWrite('Ring nu', 'Ring og hør mere')).toEqual({ values: { cta_label: 'Ring nu' }, clear: [] })
    expect(takeawayCtaWrite(null, null)).toEqual({ values: {}, clear: ['cta_label'] })
    expect(takeawayVisibilityWrite(false, true)).toEqual({ values: { is_visible: false }, clear: [] })
    expect(takeawayVisibilityWrite(true, true)).toEqual({ values: {}, clear: ['is_visible'] })
  })

  it('the sections are one key, written whole with sort renumbered from 1', () => {
    const reordered = [seededSections[1]!, seededSections[0]!]
    expect(takeawaySectionsWrite(reordered, seededSections)).toEqual({
      values: {
        sections: [
          { ...seededSections[1], sort: 1 },
          { ...seededSections[0], sort: 2 },
        ],
      },
      clear: [],
    })
    expect(takeawaySectionsWrite(seededSections, seededSections)).toEqual({ values: {}, clear: ['sections'] })
  })

  it('every write the delta produces satisfies the strict schema', () => {
    const write = takeawaySectionsWrite(
      [...seededSections, { id: 'afsnit-3', heading: null, body: 'Tre' }],
      seededSections,
    )
    expect(takeawayDraft.input.safeParse(write.values).success).toBe(true)
    expect(takeawayDraft.input.safeParse(takeawayVisibilityWrite(false, true).values).success).toBe(true)
  })

  it('sameTakeawaySections is order-sensitive and id-sensitive', () => {
    expect(sameTakeawaySections(seededSections, [...seededSections])).toBe(true)
    expect(sameTakeawaySections(seededSections, [seededSections[1]!, seededSections[0]!])).toBe(false)
    expect(sameTakeawaySections(seededSections, [{ ...seededSections[0]!, id: 'x' }, seededSections[1]!])).toBe(false)
  })
})

describe('applyTakeawaySectionsEdit — 1aj\'s list controls', () => {
  const typed = (headings: string[], bodies: string[]) => ({ headings, bodies })

  it('save trims what was typed and keeps the server\'s ids', () => {
    const result = applyTakeawaySectionsEdit(seededSections, {
      ...typed(['  Ny overskrift ', ''], ['Tekst', '  ']),
      edit: { kind: 'save' },
    })
    expect(result).toEqual({
      ok: true,
      sections: [
        { id: 'afsnit-1', heading: 'Ny overskrift', body: 'Tekst' },
        { id: 'afsnit-2', heading: null, body: null },
      ],
    })
  })

  it('add appends an empty section with the next free id', () => {
    const result = applyTakeawaySectionsEdit(seededSections, {
      ...typed(['A', 'B'], ['a', 'b']),
      edit: { kind: 'add' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sections).toHaveLength(3)
    expect(result.sections[2]).toEqual({ id: 'afsnit-3', heading: null, body: null })
  })

  it('remove and move keep every other section, exactly once, in order', () => {
    const three = [...seededSections, { id: 'afsnit-3', heading: 'C', body: null }]
    const removed = applyTakeawaySectionsEdit(three, {
      ...typed(['A', 'B', 'C'], ['', '', '']),
      edit: { kind: 'remove', index: 1 },
    })
    expect(removed.ok && removed.sections.map((s) => s.id)).toEqual(['afsnit-1', 'afsnit-3'])

    const moved = applyTakeawaySectionsEdit(three, {
      ...typed(['A', 'B', 'C'], ['', '', '']),
      edit: { kind: 'move', index: 2, direction: 'up' },
    })
    expect(moved.ok && moved.sections.map((s) => s.id)).toEqual(['afsnit-1', 'afsnit-3', 'afsnit-2'])
  })

  it('refuses a submission that does not fit the server\'s list, and an impossible position', () => {
    expect(applyTakeawaySectionsEdit(seededSections, { ...typed(['A'], ['a']), edit: { kind: 'save' } })).toEqual({
      ok: false,
      issues: null,
    })
    expect(
      applyTakeawaySectionsEdit(seededSections, { ...typed(['A', 'B'], ['a', 'b']), edit: { kind: 'remove', index: 2 } }),
    ).toEqual({ ok: false, issues: null })
    expect(
      applyTakeawaySectionsEdit(seededSections, {
        ...typed(['A', 'B'], ['a', 'b']),
        edit: { kind: 'move', index: 0, direction: 'up' },
      }),
    ).toEqual({ ok: false, issues: null })
  })

  it('refuses over-long text with the position, and a list past twenty', () => {
    const result = applyTakeawaySectionsEdit(seededSections, {
      ...typed(['x'.repeat(121), 'ok'], ['ok', 'y'.repeat(2001)]),
      edit: { kind: 'save' },
    })
    expect(result.ok).toBe(false)
    if (result.ok || result.issues === null) return
    expect(result.issues).toEqual([
      { field: 'heading', index: 0, code: 'too_long' },
      { field: 'body', index: 1, code: 'too_long' },
    ])

    const twenty = Array.from({ length: 20 }, (_, index) => ({ id: `afsnit-${index + 1}`, heading: null, body: null }))
    const full = applyTakeawaySectionsEdit(twenty, {
      ...typed(twenty.map(() => ''), twenty.map(() => '')),
      edit: { kind: 'add' },
    })
    expect(full.ok).toBe(false)
    if (full.ok || full.issues === null) return
    expect(full.issues).toEqual([{ field: 'list', code: 'too_many' }])
  })

  it('nextTakeawaySectionId never reuses an id in the list', () => {
    expect(nextTakeawaySectionId([])).toBe('afsnit-1')
    expect(nextTakeawaySectionId(['afsnit-1', 'afsnit-7', 'andet'])).toBe('afsnit-8')
  })
})

describe('the text fields', () => {
  it('toTakeawayText trims, blanks to null, and reports both limits at once', () => {
    expect(toTakeawayText({ heading: ' Ny ', intro: '  ' })).toEqual({
      ok: true,
      values: { heading: 'Ny', intro: null },
    })
    expect(toTakeawayText({ heading: 'x'.repeat(121), intro: 'y'.repeat(401) })).toEqual({
      ok: false,
      issues: ['overskrift:too_long', 'intro:too_long'],
    })
  })

  it('toTakeawayCta trims and caps at sixty', () => {
    expect(toTakeawayCta(' Ring ')).toEqual({ ok: true, value: 'Ring' })
    expect(toTakeawayCta('')).toEqual({ ok: true, value: null })
    expect(toTakeawayCta('x'.repeat(61))).toEqual({ ok: false, issue: 'knaptekst:too_long' })
  })
})

describe('the sentences the screen says', () => {
  it('names the waiting cards once each, in screen order', () => {
    expect(describeTakeawayPending([])).toBeNull()
    expect(describeTakeawayPending(['cta_label'])).toBe('Knap nederst afventer offentliggørelse.')
    expect(describeTakeawayPending(['sections', 'intro', 'heading', 'is_visible'])).toBe(
      'Synligheden, Tekst og Tekstafsnit afventer offentliggørelse.',
    )
    expect(pendingTakeawayCards(['image_id', 'heading'])).toEqual({
      visibility: false,
      text: true,
      image: true,
      sections: false,
      cta: false,
    })
  })

  it('states the consequence of publishing the switch, in all four states', () => {
    expect(describeTakeawayVisibility(true, true)).toContain('vises på hjemmesiden')
    expect(describeTakeawayVisibility(true, false)).toContain('forsvinder både siden og menupunktet')
    expect(describeTakeawayVisibility(false, true)).toContain('vises både siden og menupunktet igen')
    expect(describeTakeawayVisibility(false, false)).toContain('skjult')
  })

  it('names the number the button rings from the contact facts, never from a constant', () => {
    expect(describeTakeawayCtaPhone('+45 63 90 83 00')).toContain('— +45 63 90 83 00.')
    expect(describeTakeawayCtaPhone(null)).toContain('under Kontaktoplysninger')
  })
})
