import { describe, expect, it } from 'vitest'

import {
  decodeSectionIssue,
  decodeTakeawayErrors,
  encodeSectionIssue,
  encodeTakeawaySectionsEcho,
  encodeTakeawayTextEcho,
  readTakeawaySectionsEcho,
  readTakeawaySectionsEdit,
  readTakeawaySectionsForm,
  readTakeawayTextForm,
  readTakeawayVisibilityForm,
  TAKEAWAY_CTA_FORM,
  TAKEAWAY_SECTION_ACTION,
  TAKEAWAY_SECTIONS_FORM,
  TAKEAWAY_TEXT_FORM,
  TAKEAWAY_VISIBILITY_FORM,
  takeawaySectionsState,
} from '@/app/(admin)/admin/mad-ud-af-huset/forms'
import { takeawayHref } from '@/app/(admin)/admin/mad-ud-af-huset/routes'

/**
 * The Mad ud af huset screen's form vocabularies — phase 11B; technical plan §8.
 *
 * What the browser may say, and what it may not. Nothing here reaches a database.
 */

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}

describe('the vocabularies', () => {
  it('have no field for an id, an entity, an image detail, a phone number or a price', () => {
    const names = new Set<string>([
      ...Object.values(TAKEAWAY_TEXT_FORM),
      ...Object.values(TAKEAWAY_SECTIONS_FORM),
      ...Object.values(TAKEAWAY_CTA_FORM),
      ...Object.values(TAKEAWAY_VISIBILITY_FORM),
    ])
    for (const forbidden of ['id', 'entity', 'afsnit_id', 'storage_path', 'alt_text', 'telefon', 'pris', 'published']) {
      expect(names.has(forbidden), forbidden).toBe(false)
    }
  })

  it('reads the text and the switch exactly as typed', () => {
    expect(readTakeawayTextForm(form({ overskrift: ' Ny ', intro: 'Tekst' }))).toEqual({
      heading: ' Ny ',
      intro: 'Tekst',
    })
    expect(readTakeawayVisibilityForm(form({ vis_siden: '1' }))).toBe(true)
    expect(readTakeawayVisibilityForm(form({}))).toBe(false)
    expect(readTakeawayVisibilityForm(form({ vis_siden: 'true' }))).toBe(false)
  })
})

describe('the section controls', () => {
  it('parses every button this module writes, and nothing else', () => {
    expect(readTakeawaySectionsEdit(TAKEAWAY_SECTION_ACTION.save)).toEqual({ kind: 'save' })
    expect(readTakeawaySectionsEdit(TAKEAWAY_SECTION_ACTION.add)).toEqual({ kind: 'add' })
    expect(readTakeawaySectionsEdit(TAKEAWAY_SECTION_ACTION.remove(3))).toEqual({ kind: 'remove', index: 3 })
    expect(readTakeawaySectionsEdit(TAKEAWAY_SECTION_ACTION.up(1))).toEqual({ kind: 'move', index: 1, direction: 'up' })
    expect(readTakeawaySectionsEdit(TAKEAWAY_SECTION_ACTION.down(0))).toEqual({
      kind: 'move',
      index: 0,
      direction: 'down',
    })
    for (const value of ['', 'slet:1', 'fjern:', 'fjern:-1', 'fjern:1.5', 'fjern:100', 'op', '<script>']) {
      expect(readTakeawaySectionsEdit(value), value).toBeNull()
    }
  })

  it('reads the headings and texts by position', () => {
    expect(
      readTakeawaySectionsForm(
        form({ afsnit_overskrift: ['A', 'B'], afsnit_tekst: ['a', 'b'], afsnit_handling: 'gem' }),
      ),
    ).toEqual({ headings: ['A', 'B'], bodies: ['a', 'b'], edit: { kind: 'save' } })
  })

  it('round-trips a refused list through the address, with the messages bound by position', () => {
    const echo = encodeTakeawaySectionsEcho(
      [
        { id: 'afsnit-1', heading: 'x'.repeat(121), body: null },
        { id: 'afsnit-2', heading: null, body: 'y'.repeat(2001) },
      ],
      [
        { field: 'heading', index: 0, code: 'too_long' },
        { field: 'body', index: 1, code: 'too_long' },
        { field: 'list', code: 'too_many' },
      ],
    )

    const read = readTakeawaySectionsEcho(echo)
    expect(read?.headings).toEqual(['x'.repeat(121), ''])
    expect(read?.issues).toHaveLength(3)

    const state = takeawaySectionsState([{ id: 'afsnit-1', heading: 'live', body: null }], read)
    expect(state.sections[0]?.id).toBe('afsnit-1')
    expect(state.sections[0]?.headingError).toContain('120 tegn')
    expect(state.sections[1]?.id).toBe('echo-2')
    expect(state.sections[1]?.bodyError).toContain('2000 tegn')
    expect(state.listError).toContain('20 afsnit')
  })

  it('a hand-typed issue that names nothing this module wrote is ignored', () => {
    expect(decodeSectionIssue('afsnit_overskrift:x:too_long')).toBeNull()
    expect(decodeSectionIssue('afsnit_pris:0:too_long')).toBeNull()
    expect(decodeSectionIssue(encodeSectionIssue({ field: 'list', code: 'too_many' }))).toEqual({
      field: 'list',
      code: 'too_many',
    })
    expect(readTakeawaySectionsEcho(new URLSearchParams('fejl=noget'))).toBeNull()
  })

  it('without an echo the state is the server\'s list, verbatim', () => {
    const state = takeawaySectionsState([{ id: 'afsnit-1', heading: 'A', body: null }], null)
    expect(state).toEqual({ sections: [{ id: 'afsnit-1', heading: 'A', body: '' }] })
  })
})

describe('errors and addresses', () => {
  it('decodes only the plain codes this module defined', () => {
    expect(decodeTakeawayErrors(['overskrift:too_long', 'noget:andet', 'knaptekst:too_long'])).toEqual([
      'overskrift:too_long',
      'knaptekst:too_long',
    ])
  })

  it('the text echo carries the codes and what was typed', () => {
    const echo = encodeTakeawayTextEcho({ heading: 'H', intro: 'I' }, ['intro:too_long'])
    expect(echo.getAll('fejl')).toEqual(['intro:too_long'])
    expect(readTakeawayTextForm(echo)).toEqual({ heading: 'H', intro: 'I' })
  })

  it('builds addresses on this screen only, with the picker winning the fragment', () => {
    expect(takeawayHref()).toBe('/admin/mad-ud-af-huset')
    // The focus target travels as a parameter too, so two redirects that differ only
    // by their fragment are still two addresses (a hash-only change never refetches).
    expect(takeawayHref({ status: 'gemt', focus: 'tekst' })).toBe(
      '/admin/mad-ud-af-huset?status=gemt&fokus=tekst#tekst',
    )
    expect(takeawayHref({ chooseImage: true, focus: 'tekst' })).toBe(
      '/admin/mad-ud-af-huset?vaelg_billede=1&fokus=tekst#vaelg-billede-dialog',
    )
  })
})
