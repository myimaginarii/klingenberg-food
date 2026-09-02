import { describe, expect, it } from 'vitest'

import {
  decodeHomeErrors,
  encodeHomeSectionEcho,
  featuredActionValue,
  HOME_ERROR_MESSAGES,
  HOME_FEATURED_FORM,
  HOME_IMAGE_FORM,
  HOME_SECTION_FORM,
  homeErrorField,
  readHomeFeaturedForm,
  readHomeSectionForm,
  readHomeSectionKey,
  sectionFormValues,
  toHomeSectionSubmission,
} from '@/app/(admin)/admin/forsiden/forms'
import { homeDraft } from '@/lib/schemas/page-documents'

/**
 * The Forsiden screen's form vocabularies — phase 11A; technical plan §8.
 *
 * What the browser may say, and what it may not: the three text cards map two generic
 * field names onto each section's own keys; the featured controls carry a word and a
 * slot in one button value; the image form is the shared picker vocabulary plus the
 * section. Nothing here reaches a database.
 */

const A = '11111111-1111-4111-8111-111111111111'
const VERSION = '2026-09-02T10:00:00.000+00:00'

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

describe('the section key', () => {
  it('accepts exactly the three text sections', () => {
    expect(readHomeSectionKey('hero')).toBe('hero')
    expect(readHomeSectionKey('award')).toBe('award')
    expect(readHomeSectionKey('about_excerpt')).toBe('about_excerpt')
  })

  it('refuses the featured list, an unknown section, and non-strings', () => {
    for (const value of ['featured_dish_ids', 'published', 'is_visible', '', null, 42]) {
      expect(readHomeSectionKey(value)).toBeNull()
    }
  })
})

describe('toHomeSectionSubmission — two words onto the section\'s own keys', () => {
  it('maps hero onto heading/intro, award onto title/text, about onto heading/text', () => {
    const typed = readHomeSectionForm(
      form({ [HOME_SECTION_FORM.heading]: ' Ny overskrift ', [HOME_SECTION_FORM.text]: 'Tekst ' }),
    )

    expect(toHomeSectionSubmission('hero', typed, A)).toEqual({
      ok: true,
      values: { heading: 'Ny overskrift', intro: 'Tekst', image_id: A },
    })
    expect(toHomeSectionSubmission('award', typed, null)).toEqual({
      ok: true,
      values: { title: 'Ny overskrift', text: 'Tekst', image_id: null },
    })
    expect(toHomeSectionSubmission('about_excerpt', typed, null)).toEqual({
      ok: true,
      values: { heading: 'Ny overskrift', text: 'Tekst', image_id: null },
    })
  })

  it('every submission is a whole section the strict schema accepts', () => {
    const typed = readHomeSectionForm(form({ [HOME_SECTION_FORM.heading]: 'x' }))

    for (const section of ['hero', 'award', 'about_excerpt'] as const) {
      const result = toHomeSectionSubmission(section, typed, A)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(homeDraft.input.safeParse({ [section]: result.values }).success).toBe(true)
    }
  })

  it('blank is absent — an empty field saves as null, never as ""', () => {
    const typed = readHomeSectionForm(form({ [HOME_SECTION_FORM.heading]: '   ' }))
    expect(toHomeSectionSubmission('hero', typed, null)).toEqual({
      ok: true,
      values: { heading: null, intro: null, image_id: null },
    })
  })

  it('refuses the two limits, both at once, with codes the screen binds to a field', () => {
    const typed = readHomeSectionForm(
      form({ [HOME_SECTION_FORM.heading]: 'x'.repeat(121), [HOME_SECTION_FORM.text]: 'y'.repeat(401) }),
    )

    const result = toHomeSectionSubmission('hero', typed, null)
    expect(result).toEqual({ ok: false, errors: ['overskrift:too_long', 'tekst:too_long'] })

    expect(homeErrorField('overskrift:too_long')).toBe('overskrift')
    expect(homeErrorField('tekst:too_long')).toBe('tekst')
    expect(HOME_ERROR_MESSAGES['overskrift:too_long']).toBe('Overskriften må højst være 120 tegn.')
    expect(HOME_ERROR_MESSAGES['tekst:too_long']).toBe('Teksten må højst være 400 tegn.')
  })

  it('has no field for an image, an entity, an id or a visibility flag', () => {
    expect(Object.values(HOME_SECTION_FORM).sort()).toEqual(['afsnit', 'overskrift', 'tekst', 'version'])
  })

  it('extra form fields never reach the section — the mapping produces exactly the three keys the strict schema knows', () => {
    // A crafted POST can carry any field names it likes; the reader takes the two it
    // was given and the mapper writes the section's own three keys. So a smuggled
    // `image_id`, `storage_path` or `published` field is not refused here — it is
    // never read — and what does reach the strict section schema is exactly its shape.
    const typed = readHomeSectionForm(
      form({
        [HOME_SECTION_FORM.heading]: 'Ny',
        [HOME_SECTION_FORM.text]: 'Tekst',
        image_id: '55555555-5555-4555-8555-555555555555',
        storage_path: 'x/original.jpg',
        published: '{}',
        unexpected_key: 'x',
      }),
    )

    const EXPECTED_KEYS = {
      hero: ['heading', 'image_id', 'intro'],
      award: ['image_id', 'text', 'title'],
      about_excerpt: ['heading', 'image_id', 'text'],
    } as const

    for (const section of ['hero', 'award', 'about_excerpt'] as const) {
      const result = toHomeSectionSubmission(section, typed, null)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(Object.keys(result.values).sort()).toEqual(EXPECTED_KEYS[section])
      expect(result.values.image_id).toBeNull()
      expect(homeDraft.input.safeParse({ [section]: result.values }).success).toBe(true)
    }
  })
})

describe('the echo round-trips a refusal', () => {
  it('encodes the codes and the typed values, and decodes only known codes', () => {
    const typed = { section: 'award', heading: 'Titel', text: 'Ord' }
    const echo = encodeHomeSectionEcho(typed, ['tekst:too_long'])

    expect(readHomeSectionForm(echo)).toEqual(typed)
    expect(decodeHomeErrors(echo.getAll('fejl'))).toEqual(['tekst:too_long'])
    expect(decodeHomeErrors(['noget:andet', 'role', ''])).toEqual([])
  })

  it('shows the stored section in the card\'s two fields', () => {
    expect(sectionFormValues('hero', { heading: 'H', intro: 'I', image_id: A })).toEqual({
      section: 'hero',
      heading: 'H',
      text: 'I',
    })
    expect(sectionFormValues('award', { title: null, text: 'T', image_id: null })).toEqual({
      section: 'award',
      heading: '',
      text: 'T',
    })
  })
})

describe('readHomeFeaturedForm — one word and a slot per button', () => {
  it('builds the button values the parser reads back', () => {
    expect(featuredActionValue('add')).toBe('tilfoej')
    expect(featuredActionValue('replace', 1)).toBe('skift:1')
    expect(featuredActionValue('remove', 0)).toBe('fjern:0')
    expect(featuredActionValue('up', 2)).toBe('op:2')
    expect(featuredActionValue('down', 0)).toBe('ned:0')
  })

  it('parses every control into its edit', () => {
    const base = { [HOME_FEATURED_FORM.version]: VERSION }

    expect(
      readHomeFeaturedForm(form({ ...base, [HOME_FEATURED_FORM.action]: 'tilfoej', [HOME_FEATURED_FORM.dish]: A })),
    ).toEqual({ expectedUpdatedAt: VERSION, edit: { kind: 'add', dishId: A } })
    expect(
      readHomeFeaturedForm(form({ ...base, [HOME_FEATURED_FORM.action]: 'skift:2', [HOME_FEATURED_FORM.dish]: A })),
    ).toEqual({ expectedUpdatedAt: VERSION, edit: { kind: 'replace', index: 2, dishId: A } })
    expect(readHomeFeaturedForm(form({ ...base, [HOME_FEATURED_FORM.action]: 'fjern:1' }))).toEqual({
      expectedUpdatedAt: VERSION,
      edit: { kind: 'remove', index: 1 },
    })
    expect(readHomeFeaturedForm(form({ ...base, [HOME_FEATURED_FORM.action]: 'op:1' }))).toEqual({
      expectedUpdatedAt: VERSION,
      edit: { kind: 'move', index: 1, direction: 'up' },
    })
    expect(readHomeFeaturedForm(form({ ...base, [HOME_FEATURED_FORM.action]: 'ned:0' }))).toEqual({
      expectedUpdatedAt: VERSION,
      edit: { kind: 'move', index: 0, direction: 'down' },
    })
  })

  it('refuses a malformed version, a non-uuid dish, a slot outside the three, an unknown word, and an add without a dish', () => {
    const cases: Record<string, string>[] = [
      { [HOME_FEATURED_FORM.action]: 'tilfoej', [HOME_FEATURED_FORM.dish]: A, [HOME_FEATURED_FORM.version]: 'i går' },
      { [HOME_FEATURED_FORM.action]: 'tilfoej', [HOME_FEATURED_FORM.dish]: 'Odin', [HOME_FEATURED_FORM.version]: VERSION },
      { [HOME_FEATURED_FORM.action]: 'fjern:3', [HOME_FEATURED_FORM.version]: VERSION },
      { [HOME_FEATURED_FORM.action]: 'slet:0', [HOME_FEATURED_FORM.version]: VERSION },
      { [HOME_FEATURED_FORM.action]: 'tilfoej', [HOME_FEATURED_FORM.version]: VERSION },
      { [HOME_FEATURED_FORM.action]: 'skift:0', [HOME_FEATURED_FORM.version]: VERSION },
    ]

    for (const entries of cases) {
      expect(readHomeFeaturedForm(form(entries)), JSON.stringify(entries)).toBeNull()
    }
  })

  it('reads no name, price or category — a slot is an id and nothing else', () => {
    expect(Object.values(HOME_FEATURED_FORM).sort()).toEqual(['handling', 'ret', 'version'])
  })
})

describe('the image form is the shared picker vocabulary plus the section', () => {
  it('adds exactly one field', () => {
    expect(HOME_IMAGE_FORM).toEqual({ version: 'version', image: 'billede', section: 'afsnit' })
  })
})
